import { Bot } from 'grammy';
import { userService } from '../services/user.service.js';
import { startMessageService } from '../services/startMessage.service.js';
import type { BotContext, UserRow } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function registerStartHandler(bot: Bot<BotContext>): void {
  bot.command('start', async (ctx) => {
    if (!ctx.from) return;
    const from = ctx.from;

    logger.info('/start received', { telegram_id: from.id });

    // 1) DB yozuvini KUTMASDAN — darhol start xabarni yuboramiz.
    // Shaxsiylashtirish ({name}) uchun Telegram'dan kelgan ma'lumot yetadi.
    const now = new Date().toISOString();
    const previewUser: UserRow = {
      id: '',
      telegram_id: from.id,
      username: from.username ?? null,
      first_name: from.first_name ?? null,
      last_name: from.last_name ?? null,
      is_active: true,
      started_at: now,
      updated_at: now,
      created_at: now,
    };
    await startMessageService.deliverActiveStartMessage(bot, previewUser);

    // 2) Bazaga yozuv orqa fonda — javob tezligiga ta'sir qilmaydi.
    // Ichida retry bor, hech qachon throw qilmaydi.
    void userService.registerOrUpdateBackground({
      id: from.id,
      username: from.username,
      first_name: from.first_name,
      last_name: from.last_name,
    });
  });
}
