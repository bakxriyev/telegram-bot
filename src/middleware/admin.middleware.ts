import type { NextFunction } from 'grammy';
import { env } from '../config/env.js';
import type { BotContext } from '../types/index.js';

/**
 * Returns true if the given Telegram user id is an admin, per ADMIN_IDS.
 * No database table is used for admin management — the .env list is the
 * single source of truth, checked on every single admin action.
 */
export function isAdmin(telegramId: number | undefined): boolean {
  if (!telegramId) return false;
  return env.ADMIN_IDS.includes(telegramId);
}

/**
 * Middleware guard: attach to every admin-only handler (commands AND
 * callback queries). This is intentionally re-checked everywhere per the
 * spec — a user cannot bypass admin checks via crafted callback_data
 * because every handler re-validates against ADMIN_IDS itself.
 */
export async function requireAdmin(ctx: BotContext, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!isAdmin(userId)) {
    if (ctx.callbackQuery) {
      await ctx.answerCallbackQuery({ text: '⛔ Sizda ruxsat yo‘q.', show_alert: true });
    } else {
      await ctx.reply('⛔ Sizda ruxsat yo‘q.');
    }
    return;
  }
  await next();
}
