import type { Bot } from 'grammy';
import { progrevRepository } from '../database/repositories/progrev.repository.js';
import { usersRepository } from '../database/repositories/users.repository.js';
import { safeDeliver } from './telegram.service.js';
import { isTashkentQuietHours, skipTashkentQuietForward, tashkentMorning8Ms } from '../utils/schedule.js';
import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { ContentTypeName, ProgrevMessageRow, UserRow, SourceType } from '../types/index.js';
import { normalizeSource } from '../types/index.js';

export const PROGREV_MAX_DAYS = 365;
export const PROGREV_MAX_HOURS = 23;
export const PROGREV_MAX_MINUTES = 59;
export const PROGREV_MIN_TOTAL_MINUTES = 1;
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const SEND_GAP_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Kun/soat/daqiqa → millisekund. */
export function progrevDelayToMs(days: number, hours: number, minutes: number): number {
  return ((days * 24 + hours) * 60 + minutes) * 60 * 1000;
}

/** "1 kun 2 soat 30 daqiqa" ko'rinishida (nollar tashlanadi). */
export function formatProgrevDelay(days: number, hours: number, minutes: number): string {
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} kun`);
  if (hours > 0) parts.push(`${hours} soat`);
  if (minutes > 0) parts.push(`${minutes} daqiqa`);
  return parts.length > 0 ? parts.join(' ') : '0 daqiqa';
}

/** Admin kiritgan butun sonni tekshirish: 0..max oralig'ida bo'lishi shart. */
export function parseDelayPart(text: string, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 0 || n > max) return null;
  return n;
}

function isUniqueViolation(err: unknown): boolean {
  if (err instanceof DatabaseError) {
    const cause = err.cause as { code?: unknown } | undefined;
    return cause?.code === '23505';
  }
  return false;
}

/**
 * Tunda to'plangan zanjirni yoyish (burst oldini olish).
 * `due` — shu tick'da due bo'lganlar (limit bilan kesilgan bo'lishi mumkin).
 * Har bir user uchun DB dagi BARCHA pending'lar olinadi va:
 * - birinchisi (navbati kelgani) hozir (`nowMs`) qoldiriladi,
 * - qolganlari original intervallar saqlangan holda suriladi,
 * - hech biri 22:00–08:00 ga tushmaydi (tushsa keyingi 08:00 ga).
 *
 * Qaytaradi: shu tick'da yuborilmasligi kerak bo'lgan (kelajakka surilgan)
 * send id'lar to'plami. Bu bazada eski to'planib qolganlarga ham ishlaydi —
 * keyingi kunduzgi tick'da avtomatik to'g'rilanadi.
 */
async function reflowQuietBlockedChains(
  due: { id: string; user_id: string; scheduled_at: string }[],
  nowMs: number,
): Promise<Set<string>> {
  const pushedToFuture = new Set<string>();
  if (due.length === 0) return pushedToFuture;

  const morning8Ms = tashkentMorning8Ms(nowMs);
  const userIds = [...new Set(due.map((s) => s.user_id))];

  for (const userId of userIds) {
    let allSends;
    try {
      allSends = await progrevRepository.listSendsByUser(userId);
    } catch (err) {
      logger.error('Reflow: failed to list sends by user', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const pending = allSends
      .filter((s) => s.status === 'pending')
      .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

    if (pending.length <= 1) continue;

    const dueForUser = pending.filter((s) => new Date(s.scheduled_at).getTime() <= nowMs);
    if (dueForUser.length === 0) continue;

    const earliestMs = new Date(dueForUser[0].scheduled_at).getTime();

    // Reflow kerakmi?
    // - 2+ ta due to'planib qolgan → burst bo'lmasligi uchun shart.
    // - bitta due tunda qolgan (bugungi 08:00 dan oldin) + kelajak bor →
    //   interval saqlanishi uchun kelajakni surish kerak.
    const needsReflow = dueForUser.length > 1 || earliestMs < morning8Ms;
    if (!needsReflow) continue;

    const shiftMs = nowMs - earliestMs;
    if (shiftMs <= 0) continue;

    let prevOldMs: number | null = null;
    let prevNewMs: number | null = null;
    let shiftedCount = 0;

    for (const send of pending) {
      const oldMs = new Date(send.scheduled_at).getTime();
      let candidate = oldMs + shiftMs;
      if (prevOldMs !== null && prevNewMs !== null) {
        const minByGap = prevNewMs + (oldMs - prevOldMs);
        if (candidate < minByGap) candidate = minByGap;
      }
      candidate = skipTashkentQuietForward(candidate);

      if (candidate !== oldMs) {
        try {
          await progrevRepository.rescheduleSend(send.id, new Date(candidate).toISOString());
          shiftedCount++;
        } catch (err) {
          logger.error('Reflow: failed to reschedule send', {
            sendId: send.id,
            error: err instanceof Error ? err.message : String(err),
          });
          // Xatolikda zanjir buzilmasligi uchun prev ni eski qiymatda qoldiramiz
          prevOldMs = oldMs;
          prevNewMs = oldMs;
          continue;
        }
      }

      if (candidate > nowMs) pushedToFuture.add(send.id);

      prevOldMs = oldMs;
      prevNewMs = candidate;
    }

    if (shiftedCount > 0) {
      logger.info('Progrev reflowed after quiet hours', { userId, shifted: shiftedCount });
    }
  }

  return pushedToFuture;
}

export const progrevService = {
  /**
   * /start bosilganda chaqiriladi — userning O'Z anchor vaqtidan
   * boshlab barcha AKTIV progrev xabarlarni rejalaydi.
   * Hech qachon throw qilmaydi (start oqimini buzmasligi shart).
   *
   * Qayta /start: yuborilganlar qayta yuborilmaydi, kutilayotganlar
   * yangi vaqtga ko'chiriladi (ketma-ketlik boshidan boshlanadi).
   */
  async scheduleForStart(from: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    source?: SourceType | null;
  }): Promise<void> {
    try {
      const user = await usersRepository.upsertByTelegramId({
        telegram_id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        last_name: from.last_name ?? null,
        source: from.source ?? null,
      });

      const source = from.source ?? 'instagram';
      const [activeMessages, existingSends] = await Promise.all([
        progrevRepository.listActiveBySource(source),
        progrevRepository.listSendsByUser(user.id),
      ]);

      // MUHIM: boshqa source dan qolgan pendinglar aralashib ketmasligi uchun —
      // hozirgi source zanjiriga kirmaydigan pendinglarni bekor qilamiz.
      try {
        const keepIds = activeMessages.map((m) => m.id);
        await progrevRepository.cancelPendingByUserExcept(user.id, keepIds);
      } catch (err) {
        logger.warn('Failed to cancel stale progrev sends on source switch', {
          telegram_id: from.id,
          source,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (activeMessages.length === 0) return;

      const anchorMs = Date.now();
      const existingByProgrev = new Map(existingSends.map((s) => [s.progrev_id, s]));

      // Zanjir tartibida (delay o'sishi bo'yicha — listActive allaqachon
      // shunday saralaydi): har bir keyingi xabar oldingisidan kamida
      // original interval (delay farqi) keyin bo'lishi shart va hech biri
      // 22:00–08:00 jimjitlikka tushmasligi shart.
      // Masalan start 22:00, delaylar 3s/6s/9s bo'lsa:
      // naive 01:00/04:00/07:00 (hammasi quiet) →
      // 08:00 / 11:00 / 14:00 bo'ladi, burst bo'lmaydi.
      let prevDelayMs: number | null = null;
      let prevScheduledMs: number | null = null;

      for (const msg of activeMessages) {
        const delayMs = progrevDelayToMs(msg.delay_days, msg.delay_hours, msg.delay_minutes);
        let scheduledMs = anchorMs + delayMs;
        if (prevScheduledMs !== null && prevDelayMs !== null) {
          const minByGap = prevScheduledMs + (delayMs - prevDelayMs);
          if (scheduledMs < minByGap) scheduledMs = minByGap;
        }
        scheduledMs = skipTashkentQuietForward(scheduledMs);
        // Gap tufayli oldinga surilganda quiet'ga tushib qolsa (masalan
        // 08:00 + 20s = 04:00 ertasi kuni) — yana 08:00 ga suramiz.
        // skipTashkentQuietForward idempotent, bir marta yetadi.

        const scheduledAt = new Date(scheduledMs).toISOString();
        const existing = existingByProgrev.get(msg.id);
        try {
          if (!existing) {
            await progrevRepository.insertSend({
              progrev_id: msg.id,
              user_id: user.id,
              scheduled_at: scheduledAt,
            });
          } else if (existing.status === 'pending') {
            await progrevRepository.rescheduleSend(existing.id, scheduledAt);
          }
          // sent/failed/cancelled — tegilmaydi (qayta yuborilmaydi)
        } catch (err) {
          // Poyga holati (ikki /start bir vaqtda): dublikatni e'tiborsiz qoldiramiz
          if (!isUniqueViolation(err)) throw err;
        }

        prevDelayMs = delayMs;
        prevScheduledMs = scheduledMs;
      }

      logger.info('Progrev scheduled for user', {
        telegram_id: from.id,
        source,
        messages: activeMessages.length,
      });
    } catch (err) {
      logger.error('Failed to schedule progrev for user', {
        telegram_id: from.id,
        source: from.source,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /**
   * Yangi progrev qo'shilganda — barcha AKTIV userlarga shu progrev uchun
   * reja yaratadi. Har bir user uchun: started_at + delay hisoblanadi.
   * Agar vaqt o'tib ketgan bo'lsa (started_at + delay < now) → hozir yuboriladi.
   * Ichida throw yo'q — xatolik log qilinadi.
   */
  async scheduleForAllActiveUsers(progrevId: string): Promise<{ scheduled: number }> {
    let scheduled = 0;
    try {
      const msg = await progrevRepository.getById(progrevId);
      if (!msg || !msg.is_active) return { scheduled: 0 };

      // Filter users by the progrev's source
      const activeUsers = await usersRepository.listAllActiveUsersForSchedule();
      if (activeUsers.length === 0) return { scheduled: 0 };

      const sourceUsers = activeUsers.filter(u => u.source === msg.source);
      if (sourceUsers.length === 0) return { scheduled: 0 };

      const existingSends = await progrevRepository.listSendsByProgrev(progrevId);
      const existingByUser = new Map(existingSends.map((s) => [s.user_id, s]));

      const delayMs = progrevDelayToMs(msg.delay_days, msg.delay_hours, msg.delay_minutes);
      const nowMs = Date.now();

      for (const user of sourceUsers) {
        const existing = existingByUser.get(user.id);
        try {
          // Har bir user uchun: started_at + delay
          const userStartedMs = new Date(user.started_at).getTime();
          let scheduledMs = userStartedMs + delayMs;

          // Agar vaqt o'tib ketgan bo'lsa → hozir + 1 daqiqa (tez orada yuborilishi uchun)
          if (scheduledMs <= nowMs) {
            scheduledMs = nowMs + 60 * 1000;
          }

          // Tunda tushsa — ertangi 08:00 ga suramiz (bitta xabar, zanjir yo'q).
          scheduledMs = skipTashkentQuietForward(scheduledMs);

          const scheduledAt = new Date(scheduledMs).toISOString();

          if (!existing) {
            await progrevRepository.insertSend({
              progrev_id: progrevId,
              user_id: user.id,
              scheduled_at: scheduledAt,
            });
            scheduled++;
          } else if (existing.status === 'pending') {
            await progrevRepository.rescheduleSend(existing.id, scheduledAt);
            scheduled++;
          }
          // sent/failed/cancelled — tegilmaydi
        } catch (err) {
          if (!isUniqueViolation(err)) throw err;
        }
      }

      logger.info('Progrev scheduled for all active users', {
        progrevId,
        source: msg.source,
        activeUsers: sourceUsers.length,
        scheduled,
      });
    } catch (err) {
      logger.error('Failed to schedule progrev for all active users', {
        progrevId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { scheduled };
  },

  /**
   * Vaqti kelgan progrev'larni yuboradi. Scheduler har tick'da chaqiradi.
   * Bot restart bo'lsa ham o'tkazib yuborilganlar keyingi tick'da ketadi.
   *
   * QOIDA: 22:00–08:00 (Toshkent) jimjitlik — bu vaqtda hech narsa
   * yuborilmaydi. Tunda to'planganlar 08:00 da BURST bo'lib ketmaydi:
   * navbati kelgani (eng erta due) hozir yuboriladi, qolganlari original
   * intervallar saqlangan holda 08:00 dan hisoblab suriladi.
   * Masalan delaylar 3s/6s/9s bo'lsa → 08:00 / 11:00 / 14:00.
   * Bu bazada oldindan to'planib qolganlarga ham ishlaydi (keyingi
   * kunduzgi tick'da avtomatik reflow).
   */
  async processDue(
    bot: Bot,
    limit = 50,
  ): Promise<{ sent: number; failed: number; cancelled: number; held: number }> {
    const result = { sent: 0, failed: 0, cancelled: 0, held: 0 };

    if (isTashkentQuietHours()) {
      try {
        const pending = await progrevRepository.countPending();
        if (pending > 0) {
          logger.info('Progrev quiet hours — holding sends until 08:00', { pending });
          result.held = pending;
        }
      } catch (err) {
        logger.error('Failed to count pending progrev sends', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return result;
    }

    const nowMs = Date.now();

    let due;
    try {
      due = await progrevRepository.listDueSends(limit);
    } catch (err) {
      logger.error('Failed to list due progrev sends', {
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
    }

    // Tunda to'plangan zanjirlarni yoyish (burst oldini olish).
    // Har bir user uchun: birinchisi hozir, qolganlari interval bilan.
    try {
      const pushedToFuture = await reflowQuietBlockedChains(due, nowMs);
      if (pushedToFuture.size > 0) {
        due = due.filter((s) => !pushedToFuture.has(s.id));
      }
    } catch (err) {
      logger.error('Progrev reflow failed (sending without reflow)', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    for (const send of due) {
      try {
        // Xabar o'chirilgan bo'lsa — join bo'lmaydi; himoya uchun tekshiramiz
        const msg: ProgrevMessageRow | undefined = send.progrev;
        if (!msg) {
          await progrevRepository.markCancelled(send.id, 'progrev message not found');
          result.cancelled++;
          continue;
        }
        if (!msg.is_active) {
          await progrevRepository.markCancelled(send.id, 'progrev deactivated');
          result.cancelled++;
          continue;
        }
        if (!send.user || !send.user.is_active) {
          await progrevRepository.markFailed(send.id, 'user inactive');
          await progrevRepository.incrementCounters(msg.id, 0, 1);
          result.failed++;
          continue;
        }
        // Source mos kelmasa yubormaymiz (aralashib ketmasligi uchun).
        // Masalan: instagram userda qolib ketgan VSL reja bekor qilinadi.
        // Legacy 'vsl1..vsl10' qiymatlar 'vsl' deb hisoblanadi.
        {
          const userSrc = normalizeSource(send.user.source) ?? 'instagram';
          const msgSrc = normalizeSource(msg.source) ?? 'instagram';
          if (userSrc !== msgSrc) {
            await progrevRepository.markCancelled(
              send.id,
              `source mismatch: progrev=${msg.source} user=${send.user.source}`,
            );
            result.cancelled++;
            continue;
          }
        }

        const userRow: UserRow = {
          id: send.user.id,
          telegram_id: send.user.telegram_id,
          username: send.user.username,
          first_name: send.user.first_name,
          last_name: send.user.last_name,
          is_active: send.user.is_active,
          started_at: send.user.started_at,
          updated_at: send.user.updated_at,
          created_at: send.user.created_at,
          source: send.user.source,
          start_param: send.user.start_param ?? null,
        };

        const outcome = await safeDeliver(bot, {
          toTelegramId: send.user.telegram_id,
          fromChannelId: msg.channel_id,
          fromMessageId: msg.message_id,
          capturedCaption: msg.caption_text,
          capturedContentType: (msg.content_type ?? undefined) as ContentTypeName | undefined,
          capturedFileId: msg.file_id ?? undefined,
          capturedKeyboardButtons: msg.keyboard_buttons,
          user: userRow,
        });

        if (outcome.ok) {
          await progrevRepository.markSent(send.id);
          await progrevRepository.incrementCounters(msg.id, 1, 0);
          result.sent++;
        } else if (outcome.permanent) {
          // Bloklagan/o'chirilgan user — boshqa bezovta qilmaymiz
          await progrevRepository.markFailed(send.id, outcome.errorMessage ?? 'permanent failure');
          await usersRepository.setActive(send.user.id, false);
          await progrevRepository.incrementCounters(msg.id, 0, 1);
          result.failed++;
        } else {
          const attempts = (send.attempts ?? 0) + 1;
          if (attempts >= MAX_ATTEMPTS) {
            await progrevRepository.markFailed(
              send.id,
              outcome.errorMessage ?? `failed after ${MAX_ATTEMPTS} attempts`,
            );
            await progrevRepository.incrementCounters(msg.id, 0, 1);
            result.failed++;
          } else {
            await progrevRepository.markRetryOrFailed(
              send.id,
              attempts,
              outcome.errorMessage ?? 'transient failure',
              new Date(Date.now() + RETRY_DELAY_MS).toISOString(),
            );
          }
        }
      } catch (err) {
        logger.error('Failed to process progrev send', {
          sendId: send.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (SEND_GAP_MS > 0) await sleep(SEND_GAP_MS);
    }

    if (result.sent > 0 || result.failed > 0 || result.cancelled > 0) {
      logger.info('Progrev tick processed', result);
    }
    return result;
  },

  /**
   * Progrev intervalini yangilash + kutilayotgan rejalarni yangi
   * intervalga ko'chirish. Yuborilganlarga tegilmaydi.
   * Qaytaradi: ko'chirilgan kutilayotgan rejalar soni.
   */
  async updateDelayAndReschedule(
    progrevId: string,
    delay: { days: number; hours: number; minutes: number },
  ): Promise<{ shifted: number }> {
    const msg = await progrevRepository.getById(progrevId);
    if (!msg) throw new Error(`Progrev message not found: ${progrevId}`);

    const oldMs = progrevDelayToMs(msg.delay_days, msg.delay_hours, msg.delay_minutes);
    const newMs = progrevDelayToMs(delay.days, delay.hours, delay.minutes);

    await progrevRepository.updateDelay(progrevId, delay);

    let shifted = 0;
    if (newMs !== oldMs) {
      shifted = await progrevRepository.shiftPendingSchedule(progrevId, newMs - oldMs);
    }

    logger.info('Progrev delay updated', { progrevId, delay, shifted });
    return { shifted };
  },
};
