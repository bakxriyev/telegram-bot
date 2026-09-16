import { usersRepository } from '../database/repositories/users.repository.js';
import type { UserRow } from '../types/index.js';
import { logger } from '../utils/logger.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const userService = {
  async registerOrUpdate(from: {
    id: number;
    username?: string;
    first_name?: string;
    last_name?: string;
  }): Promise<UserRow> {
    const user = await usersRepository.upsertByTelegramId({
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
    });
    logger.info('User registered/updated', { telegram_id: from.id });
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

  async getStats() {
    const [total, active, inactive] = await Promise.all([
      usersRepository.countAll(),
      usersRepository.countActive(),
      usersRepository.countInactive(),
    ]);
    return { total, active, inactive };
  },
};
