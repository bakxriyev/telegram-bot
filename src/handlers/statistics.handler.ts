import { Bot } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { buildSourceStats } from '../services/user.service.js';
import { usersRepository } from '../database/repositories/users.repository.js';
import { startMessageService } from '../services/startMessage.service.js';
import { broadcastsRepository } from '../database/repositories/broadcasts.repository.js';
import { huzurRepository } from '../database/repositories/huzur.repository.js';
import { tashkentDateKey, lastTashkentDateKeys } from '../utils/schedule.js';
import { backKeyboard } from '../keyboards/admin.keyboard.js';
import { logger } from '../utils/logger.js';
import { safeEditMessageText } from '../utils/safeEdit.js';
import type { BotContext } from '../types/index.js';

export async function buildStatsText(): Promise<string> {
  const [userRows, startMessagesCount, broadcastsCount, leadDates, counters] = await Promise.all([
    usersRepository.listAllForStats(),
    startMessageService.count(),
    broadcastsRepository.count(),
    huzurRepository.listAllLeadDates(),
    huzurRepository.listAllCounters(),
  ]);

  const ustats = buildSourceStats(userRows);
  const usersByDay = new Map<string, number>();
  const vslByDay = new Map<string, number>();
  const instaByDay = new Map<string, number>();
  for (const [day, rec] of ustats.byDay) {
    usersByDay.set(day, rec.vsl + rec.instagram + rec.unknown);
    vslByDay.set(day, rec.vsl);
    instaByDay.set(day, rec.instagram);
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

  const v = ustats.bySource.vsl;
  const ig = ustats.bySource.instagram;
  const un = ustats.bySource.unknown;

  return [
    '📊 Statistika (Toshkent vaqti)',
    '',
    '👥 Bot userlari:',
    `   Jami: ${ustats.total} (🟢 ${ustats.active} / 🔴 ${ustats.inactive})`,
    `   🎬 VSL: ${v.total} (🟢 ${v.active} / 🔴 ${v.inactive})`,
    `   📸 Instagram: ${ig.total} (🟢 ${ig.active} / 🔴 ${ig.inactive})`,
    ...(un.total > 0 ? [`   ❓ Nomaʼlum: ${un.total} (🟢 ${un.active} / 🔴 ${un.inactive})`] : []),
    `   Bugun: +${usersByDay.get(todayKey) ?? 0} (🎬 +${vslByDay.get(todayKey) ?? 0} / 📸 +${instaByDay.get(todayKey) ?? 0})`,
    `   Kecha: +${usersByDay.get(yesterdayKey) ?? 0} (🎬 +${vslByDay.get(yesterdayKey) ?? 0} / 📸 +${instaByDay.get(yesterdayKey) ?? 0})`,
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
      await safeEditMessageText(ctx, await buildStatsText(), { reply_markup: backKeyboard('admin:back') });
    } catch (err) {
      logger.error('Failed to build stats', { err });
      await ctx.editMessageText('❌ Statistikani hisoblab bo‘lmadi.', { reply_markup: backKeyboard('admin:back') });
    }
  });
}
