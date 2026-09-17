import type { Bot } from 'grammy';
import { progrevRepository } from '../database/repositories/progrev.repository.js';
import { usersRepository } from '../database/repositories/users.repository.js';
import { safeDeliver } from './telegram.service.js';
import { isTashkentQuietHours } from '../utils/schedule.js';
import { DatabaseError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import type { ContentTypeName, ProgrevMessageRow, UserRow } from '../types/index.js';

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
  }): Promise<void> {
    try {
      const user = await usersRepository.upsertByTelegramId({
        telegram_id: from.id,
        username: from.username ?? null,
        first_name: from.first_name ?? null,
        last_name: from.last_name ?? null,
      });

      const [activeMessages, existingSends] = await Promise.all([
        progrevRepository.listActive(),
        progrevRepository.listSendsByUser(user.id),
      ]);

      if (activeMessages.length === 0) return;

      const anchorMs = Date.now();
      const existingByProgrev = new Map(existingSends.map((s) => [s.progrev_id, s]));

      for (const msg of activeMessages) {
        const scheduledAt = new Date(
          anchorMs + progrevDelayToMs(msg.delay_days, msg.delay_hours, msg.delay_minutes),
        ).toISOString();
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
      }

      logger.info('Progrev scheduled for user', {
        telegram_id: from.id,
        messages: activeMessages.length,
      });
    } catch (err) {
      logger.error('Failed to schedule progrev for user', {
        telegram_id: from.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  /**
   * Vaqti kelgan progrev'larni yuboradi. Scheduler har tick'da chaqiradi.
   * Bot restart bo'lsa ham o'tkazib yuborilganlar keyingi tick'da ketadi.
   *
   * QOIDA: 22:00–08:00 (Toshkent) jimjitlik — bu vaqtda hech narsa
   * yuborilmaydi, to'planganlar 08:00 bo'lishi bilan ketadi.
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

    let due;
    try {
      due = await progrevRepository.listDueSends(limit);
    } catch (err) {
      logger.error('Failed to list due progrev sends', {
        error: err instanceof Error ? err.message : String(err),
      });
      return result;
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
