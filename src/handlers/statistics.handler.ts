import { Bot } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { userService } from '../services/user.service.js';
import { usersRepository } from '../database/repositories/users.repository.js';
import { startMessageService } from '../services/startMessage.service.js';
import { broadcastsRepository } from '../database/repositories/broadcasts.repository.js';
import { huzurRepository } from '../database/repositories/huzur.repository.js';
import { tashkentDateKey, lastTashkentDateKeys } from '../utils/schedule.js';
import { backKeyboard } from '../keyboards/admin.keyboard.js';
import { logger } from '../utils/logger.js';
import type { BotContext } from '../types/index.js';

export async function buildStatsText(): Promise<string> {
  const [{ total, active, inactive }, startMessagesCount, broadcastsCount, userDates, leadDates, counters] =
    await Promise.all([
      userService.getStats(),
      startMessageService.count(),
      broadcastsRepository.count(),
      usersRepository.listAllCreatedAt(),
      huzurRepository.listAllLeadDates(),
      huzurRepository.listAllCounters(),
    ]);

  const usersByDay = new Map<string, number>();
  for (const d of userDates) {
    const key = tashkentDateKey(d);
    usersByDay.set(key, (usersByDay.get(key) ?? 0) + 1);
  }

  const leadsByDay = new Map<string, number>();
  for (const d of leadDates) {
    const key = tashkentDateKey(d);
    leadsByDay.set(key, (leadsByDay.get(key) ?? 0) + 1);
  }

  let totalVisits = 0;
  const visitsByDay = new Map<string, number>();
  for (const c of counters) {
    const n = c.count ? Number(c.count) : NaN;
    const v = Number.isFinite(n) && (n as number) > 0 ? Math.floor(n as number) : 1;
    totalVisits += v;
    const key = tashkentDateKey(c.created_at);
    visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + v);
  }

  const [todayKey, yesterdayKey] = lastTashkentDateKeys(2);

  return [
    '📊 Statistika (Toshkent vaqti)',
    '',
    '👥 Bot userlari:',
    `   Jami: ${total} (🟢 ${active} / 🔴 ${inactive})`,
    `   Bugun: +${usersByDay.get(todayKey) ?? 0}`,
    `   Kecha: +${usersByDay.get(yesterdayKey) ?? 0}`,
    '',
    '🌐 Huzur sayti:',
    `   📝 Jami lidlar: ${leadDates.length}`,
    `   📝 Bugun: +${leadsByDay.get(todayKey) ?? 0}`,
    `   📝 Kecha: +${leadsByDay.get(yesterdayKey) ?? 0}`,
    `   👁 Jami tashriflar: ${totalVisits}`,
    `   👁 Bugun: +${visitsByDay.get(todayKey) ?? 0}`,
    `   👁 Kecha: +${visitsByDay.get(yesterdayKey) ?? 0}`,
    '',
    `🚀 Start xabarlar: ${startMessagesCount}`,
    `📢 Broadcastlar: ${broadcastsCount}`,
  ].join('\n');
}

export function registerStatisticsHandler(bot: Bot<BotContext>): void {
  bot.callbackQuery('admin:stats', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Hisoblanmoqda...' });
    try {
      await ctx.editMessageText(await buildStatsText(), { reply_markup: backKeyboard('admin:back') });
    } catch (err) {
      logger.error('Failed to build stats', { err });
      await ctx.editMessageText('❌ Statistikani hisoblab bo‘lmadi.', { reply_markup: backKeyboard('admin:back') });
    }
  });
}
