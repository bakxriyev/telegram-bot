import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { userService } from '../services/user.service.js';
import { usersRepository } from '../database/repositories/users.repository.js';
import { createUsersWorkbook, addUserRow, workbookToBuffer } from '../services/excel.service.js';
import { tashkentDateKey, lastTashkentDateKeys } from '../utils/schedule.js';
import { logger } from '../utils/logger.js';
import type { BotContext } from '../types/index.js';

function usersMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Kunlik statistika', 'admin:users:stats')
    .row()
    .text('📥 Excel yuklab olish', 'admin:users:excel')
    .row()
    .text('⬅️ Orqaga', 'admin:back');
}

export { usersMenuKeyboard };

export async function buildUsersEntryText(): Promise<string> {
  const { total, active, inactive } = await userService.getStats();
  return `👥 Userlar\n\nJami: ${total}\n🟢 Aktiv: ${active}\n🔴 Bloklagan: ${inactive}`;
}

export function registerUsersHandler(bot: Bot<BotContext>): void {
  // Bo'limga kirish — menyu
  bot.callbackQuery('admin:users', requireAdmin, async (ctx) => {
    await ctx.editMessageText(await buildUsersEntryText(), { reply_markup: usersMenuKeyboard() });
    await ctx.answerCallbackQuery();
  });

  // Kunlik statistika (Toshkent vaqti bilan)
  bot.callbackQuery('admin:users:stats', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Hisoblanmoqda...' });
    try {
      const { total, active, inactive } = await userService.getStats();
      const dates = await usersRepository.listAllCreatedAt();

      const byDay = new Map<string, number>();
      for (const d of dates) {
        const key = tashkentDateKey(d);
        byDay.set(key, (byDay.get(key) ?? 0) + 1);
      }

      const keys = lastTashkentDateKeys(7);
      const [todayKey, yesterdayKey] = keys;
      const today = byDay.get(todayKey) ?? 0;
      const yesterday = byDay.get(yesterdayKey) ?? 0;

      const lines = [
        '📊 Userlar statistikasi (Toshkent vaqti)',
        '',
        `👥 Jami userlar: ${total}`,
        `🟢 Aktiv: ${active}`,
        `🔴 Bloklagan: ${inactive}`,
        '',
        `📅 Bugun (${todayKey}): +${today}`,
        `📅 Kecha (${yesterdayKey}): +${yesterday}`,
        '',
        'So‘nggi 7 kun:',
        ...keys.map((k) => `${k}: +${byDay.get(k) ?? 0}`),
      ];

      await ctx.editMessageText(lines.join('\n'), { reply_markup: usersMenuKeyboard() });
    } catch (err) {
      logger.error('Failed to build users stats', { err });
      await ctx.editMessageText('❌ Statistikani hisoblab bo‘lmadi.', { reply_markup: usersMenuKeyboard() });
    }
  });

  // Excel eksport
  bot.callbackQuery('admin:users:excel', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Excel tayyorlanmoqda...' });
    try {
      const { workbook, sheet } = createUsersWorkbook();
      let n = 0;
      for await (const page of usersRepository.iterateAll()) {
        for (const u of page) {
          n += 1;
          addUserRow(sheet, n, u);
        }
      }
      const buffer = await workbookToBuffer(workbook);
      const fileName = `userlar_${lastTashkentDateKeys(1)[0]}.xlsx`;
      await ctx.replyWithDocument(new InputFile(buffer, fileName), {
        caption: `👥 Userlar ro‘yxati\n\nJami: ${n} ta`,
      });
    } catch (err) {
      logger.error('Failed to export users excel', { err });
      await ctx.reply('❌ Excel yaratib bo‘lmadi.');
    }
  });
}
