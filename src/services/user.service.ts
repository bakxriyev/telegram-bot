import { usersRepository } from '../database/repositories/users.repository.js';
import type { UserRow, SourceType } from '../types/index.js';
import { normalizeSource } from '../types/index.js';
import { tashkentDateKey } from '../utils/schedule.js';
import { logger } from '../utils/logger.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Statistika guruhi: atigi 3 ta — vsl, instagram, noma'lum (source yozilmagan eskilar). */
export type SourceGroup = 'vsl' | 'instagram' | 'unknown';

export function groupSource(raw: string | null | undefined): SourceGroup {
  const n = normalizeSource(raw);
  if (n === 'vsl') return 'vsl';
  if (n === 'instagram') return 'instagram';
  return 'unknown';
}

export function groupLabel(g: SourceGroup): string {
  if (g === 'vsl') return '🎬 VSL';
  if (g === 'instagram') return '📸 Instagram';
  return '❓ Nomaʼlum';
}



export interface SourceStats {
  total: number;
  active: number;
  inactive: number;
  bySource: Record<SourceGroup, { total: number; active: number; inactive: number }>;
  /** Sana (YYYY-MM-DD) → guruh → o'sha kuni qo'shilganlar soni */
  byDay: Map<string, Record<SourceGroup, number>>;
}

/** Bitta skanerlash bilan hamma statistika: umumiy + source bo'yicha + kunlik. */
export function buildSourceStats(
  rows: { created_at: string; source: string | null; is_active: boolean }[],
): SourceStats {
  const empty = () => ({ total: 0, active: 0, inactive: 0 });
  const bySource: SourceStats['bySource'] = { vsl: empty(), instagram: empty(), unknown: empty() };
  const byDay = new Map<string, Record<SourceGroup, number>>();
  let total = 0;
  let active = 0;
  for (const r of rows) {
    total++;
    const g = groupSource(r.source);
    const cell = bySource[g];
    cell.total++;
    if (r.is_active) {
      active++;
      cell.active++;
    } else {
      cell.inactive++;
    }
    const day = tashkentDateKey(r.created_at);
    let rec = byDay.get(day);
    if (!rec) {
      rec = { vsl: 0, instagram: 0, unknown: 0 };
      byDay.set(day, rec);
    }
    rec[g]++;
  }
  return { total, active, inactive: total - active, bySource, byDay };
}

export const userService = {
  async registerOrUpdate(from: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    source?: SourceType | null;
    startParam?: string | null;
  }): Promise<UserRow> {
    const user = await usersRepository.upsertByTelegramId({
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      source: from.source ?? null,
      startParam: from.startParam,
    });
    logger.info('User registered/updated', { telegram_id: from.id, source: from.source });
    return user;
  },

  /**
   * /start dan keyin orqa fonda chaqiriladi — hech qachon throw qilmaydi.
   * Vaqtinchalik uzilishlarda 3 marta qayta urinadi (darhol, 2s, 5s keyin).
   * Oxirgi chora: user keyingi /start da qayta yoziladi (upsert — dublikat yo'q).
   */
  async registerOrUpdateBackground(from: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
    source?: SourceType | null;
    startParam?: string | null;
  }): Promise<void> {
    const delays = [0, 2000, 5000];
    for (let attempt = 0; attempt < delays.length; attempt++) {
      if (delays[attempt] > 0) await sleep(delays[attempt]);
      try {
        await usersRepository.upsertByTelegramId({
          telegram_id: from.id,
          username: from.username ?? null,
          first_name: from.first_name ?? null,
          last_name: from.last_name ?? null,
          source: from.source ?? null,
          startParam: from.startParam,
        });
        if (attempt > 0) {
          logger.info('Background user upsert succeeded on retry', {
            telegram_id: from.id,
            attempt: attempt + 1,
          });
        }
        return;
      } catch (err) {
        logger.warn('Background user upsert attempt failed', {
          telegram_id: from.id,
          attempt: attempt + 1,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    logger.error('Background user upsert failed after all retries', { telegram_id: from.id });
  },

  async updateUserSource(telegramId: number, source: SourceType): Promise<void> {
    const user = await usersRepository.findByTelegramId(telegramId);
    if (user) {
      await usersRepository.updateSource(user.id, source);
      logger.info('User source updated', { telegram_id: telegramId, source });
    }
  },

  async getStats() {
    const [total, active, inactive] = await Promise.all([
      usersRepository.countAll(),
      usersRepository.countActive(),
      usersRepository.countInactive(),
    ]);
    return { total, active, inactive };
  },
};
