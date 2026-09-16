import { Bot } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { resetAdminState } from '../state/adminState.js';
import {
  MENU_USERS,
  MENU_STATS,
  MENU_START,
  MENU_BROADCAST,
  MENU_HUZUR,
  backKeyboard,
} from '../keyboards/admin.keyboard.js';
import { startMessageMenuKeyboard } from '../keyboards/startMessage.keyboard.js';
import { broadcastMenuKeyboard } from '../keyboards/broadcast.keyboard.js';
import { startMessagesRepository } from '../database/repositories/startMessages.repository.js';
import { usersMenuKeyboard, buildUsersEntryText } from './users.handler.js';
import { buildStatsText } from './statistics.handler.js';
import { huzurMenuKeyboard, buildHuzurEntryText } from './huzur.handler.js';
import { logger } from '../utils/logger.js';
import type { BotContext } from '../types/index.js';

/**
 * Pastki doimiy menyu tugmalari. Har bir bosilganda joriy flow
 * bekor qilinib, tegishli bo'lim yangi xabar bilan ochiladi.
 * Bu handler bot.ts da BIRINCHI ro'yxatdan o'tadi — shuning uchun
 * flow ichida tugma bosilsa ham state tozalanib, bo'lim ochiladi.
 */
export function registerMenuHandler(bot: Bot<BotContext>): void {
  bot.hears(MENU_USERS, requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    try {
      await ctx.reply(await buildUsersEntryText(), { reply_markup: usersMenuKeyboard() });
    } catch (err) {
      logger.error('Menu: failed to open users', { err });
      await ctx.reply('❌ Ma’lumotni olib bo‘lmadi.');
    }
  });

  bot.hears(MENU_STATS, requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    try {
      await ctx.reply(await buildStatsText(), { reply_markup: backKeyboard('admin:back') });
    } catch (err) {
      logger.error('Menu: failed to open stats', { err });
      await ctx.reply('❌ Statistikani hisoblab bo‘lmadi.');
    }
  });

  bot.hears(MENU_START, requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    try {
      const activeMsg = await startMessagesRepository.getActive();
      const activeLine = activeMsg ? `🟢 Aktiv:\n${activeMsg.name}` : '🟢 Aktiv: yo\'q';
      await ctx.reply(`🚀 Start xabar\n\n${activeLine}`, { reply_markup: startMessageMenuKeyboard() });
    } catch (err) {
      logger.error('Menu: failed to open start messages', { err });
      await ctx.reply('❌ Ma’lumotni olib bo‘lmadi.');
    }
  });

  bot.hears(MENU_BROADCAST, requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    await ctx.reply('📢 Broadcast', { reply_markup: broadcastMenuKeyboard() });
  });

  bot.hears(MENU_HUZUR, requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    try {
      await ctx.reply(await buildHuzurEntryText(), { reply_markup: huzurMenuKeyboard() });
    } catch (err) {
      logger.error('Menu: failed to open huzur', { err });
      await ctx.reply('❌ Ma’lumotni olib bo‘lmadi.');
    }
  });
}
