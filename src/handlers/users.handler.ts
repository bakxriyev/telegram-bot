import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { userService, buildSourceStats, groupLabel } from '../services/user.service.js';
import { usersRepository } from '../database/repositories/users.repository.js';
import { createUsersWorkbook, addUserRow, workbookToBuffer } from '../services/excel.service.js';
import { lastTashkentDateKeys } from '../utils/schedule.js';
import { logger } from '../utils/logger.js';
import { safeEditMessageText } from '../utils/safeEdit.js';
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

  // Kunlik statistika (Toshkent vaqti bilan) — source bo'yicha ajratilgan
  bot.callbackQuery('admin:users:stats', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Hisoblanmoqda...' });
    try {
      const rows = await usersRepository.listAllForStats();
      const stats = buildSourceStats(rows);

      const keys = lastTashkentDateKeys(7);
      const [todayKey, yesterdayKey] = keys;
      const dayRec = (k: string) => stats.byDay.get(k) ?? { vsl: 0, instagram: 0, unknown: 0 };
      const t = dayRec(todayKey);
      const y = dayRec(yesterdayKey);
      const dayTotal = (k: string) => {
        const r = dayRec(k);
        return r.vsl + r.instagram + r.unknown;
      };

      const srcLine = (g: 'vsl' | 'instagram' | 'unknown') => {
        const s = stats.bySource[g];
        return `${groupLabel(g)}: ${s.total} (🟢 ${s.active} / 🔴 ${s.inactive})`;
      };

      const lines = [
        '📊 Userlar statistikasi (Toshkent vaqti)',
        '',
        `👥 Jami: ${stats.total} (🟢 ${stats.active} / 🔴 ${stats.inactive})`,
        srcLine('vsl'),
        srcLine('instagram'),
        srcLine('unknown'),
        '',
        `📅 Bugun (${todayKey}): +${dayTotal(todayKey)}`,
        `   🎬 VSL: +${t.vsl} | 📸 Instagram: +${t.instagram} | ❓: +${t.unknown}`,
        `📅 Kecha (${yesterdayKey}): +${dayTotal(yesterdayKey)}`,
        `   🎬 VSL: +${y.vsl} | 📸 Instagram: +${y.instagram} | ❓: +${y.unknown}`,
        '',
        'So‘nggi 7 kun (VSL / Instagram / ❓):',
        ...keys.map((k) => {
          const r = dayRec(k);
          return `${k}: +${r.vsl + r.instagram + r.unknown} (${r.vsl} / ${r.instagram} / ${r.unknown})`;
        }),
      ];

      await safeEditMessageText(ctx, lines.join('\n'), { reply_markup: usersMenuKeyboard() });
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
