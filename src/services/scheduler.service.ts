import type { Bot } from 'grammy';
import { broadcastsRepository } from '../database/repositories/broadcasts.repository.js';
import { broadcastService } from './broadcast.service.js';
import { env } from '../config/env.js';
import { formatTashkent } from '../utils/schedule.js';
import { logger } from '../utils/logger.js';
import type { BotContext } from '../types/index.js';

const POLL_MS = 30_000;

let timer: ReturnType<typeof setInterval> | null = null;
let tickRunning = false;

async function notifyAdmins(bot: Bot<BotContext>, text: string): Promise<void> {
  for (const adminId of env.ADMIN_IDS) {
    try {
      await bot.api.sendMessage(adminId, text);
    } catch (err) {
      logger.error('Failed to notify admin about scheduled broadcast', { adminId, err });
    }
  }
}

async function tick(bot: Bot<BotContext>): Promise<void> {
  if (tickRunning) return;
  tickRunning = true;
  try {
    const due = await broadcastsRepository.listDueScheduled(10);
    for (const b of due) {
      logger.info('Running scheduled broadcast', { broadcastId: b.id, scheduled_at: b.scheduled_at });
      try {
        await broadcastService.run(bot, b.id);
        const finished = await broadcastsRepository.getById(b.id);
        await notifyAdmins(
          bot,
          `⏰ Rejalashtirilgan broadcast yuborildi` +
            (b.scheduled_at ? ` (${formatTashkent(b.scheduled_at)})` : '') +
            `\n\n👥 Jami: ${finished?.total_users ?? 0}` +
            `\n✅ Yuborildi: ${finished?.success_count ?? 0}` +
            `\n❌ Xatolik: ${finished?.failed_count ?? 0}`,
        );
      } catch (err) {
        logger.error('Scheduled broadcast run failed', { broadcastId: b.id, err });
      }
    }
  } catch (err) {
    logger.error('Scheduler tick failed', { err });
  } finally {
    tickRunning = false;
  }
}

/**
 * Har 30 soniyada vaqti kelgan rejalashtirilgan broadcastlarni tekshirib
 * avtomatik yuboradi. Bot qayta ishga tushsa ham o'tkazib yuborilganlar
 * keyingi tick'da yuboriladi (scheduled_at o'tgan + status pending).
 */
export function startScheduler(bot: Bot<BotContext>): void {
  if (timer) return;
  // Startdan ~10s o'tib birinchi tekshiruv (DB tayyor bo'lishi uchun)
  setTimeout(() => void tick(bot), 10_000);
  timer = setInterval(() => void tick(bot), POLL_MS);
  logger.info('Scheduler started', { poll_ms: POLL_MS });
}

export function stopScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
