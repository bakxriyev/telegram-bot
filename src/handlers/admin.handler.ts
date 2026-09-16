import { Bot } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { adminMainKeyboard, mainReplyKeyboard } from '../keyboards/admin.keyboard.js';
import { resetAdminState } from '../state/adminState.js';
import type { BotContext } from '../types/index.js';

export function registerAdminHandler(bot: Bot<BotContext>): void {
  bot.command('admin', requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    await ctx.reply('🛠 Admin panel', { reply_markup: adminMainKeyboard() });
    // Pastki doimiy menyuni o'rnatish (bir marta o'rnatilsa saqlanib qoladi)
    await ctx.reply('⬇️ Pastdagi tugmalar orqali bo‘lim tanlang', {
      reply_markup: mainReplyKeyboard(),
    });
  });

  bot.callbackQuery('admin:back', requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    await ctx.editMessageText('🛠 Admin panel', { reply_markup: adminMainKeyboard() });
    await ctx.answerCallbackQuery();
  });

  // No-op button used for page indicators, etc.
  bot.callbackQuery('noop', async (ctx) => {
    await ctx.answerCallbackQuery();
  });
}
