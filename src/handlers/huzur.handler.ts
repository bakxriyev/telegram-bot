import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { huzurRepository } from '../database/repositories/huzur.repository.js';
import { createLeadsWorkbook, addLeadRow, workbookToBuffer } from '../services/excel.service.js';
import { tashkentDateKey, lastTashkentDateKeys, formatTashkent } from '../utils/schedule.js';
import { logger } from '../utils/logger.js';
import type { BotContext } from '../types/index.js';

const LEADS_PAGE_SIZE = 5;
const MAX_MESSAGE_LEN = 3900;

export function huzurMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Statistika', 'admin:huzur:stats')
    .row()
    .text('📥 Lidlar Excel', 'admin:huzur:excel')
    .row()
    .text('🕒 Lidlar ro‘yxati', 'admin:huzur:recent')
    .row()
    .text('⬅️ Orqaga', 'admin:back');
}

export async function buildHuzurEntryText(): Promise<string> {
  const [leads, counters] = await Promise.all([
    huzurRepository.countLeads(),
    huzurRepository.listAllCounters(),
  ]);
  const visits = counters.reduce((s, c) => s + visitValue(c.count), 0);
  return [
    '🌐 Huzur sayti (imanakhmedovna.uz/huzur)',
    '',
    `📝 Jami lidlar: ${leads}`,
    `👁 Jami tashriflar: ${visits}`,
  ].join('\n');
}

/** counter.count (text) ni songa aylantirish — bo'sh/noto'g'ri = 1 tashrif. */
export function visitValue(count: string | null): number {
  if (!count) return 1;
  const n = Number(count);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/** Birinchi kundan bugungacha barcha Toshkent kun kalitlari. */
function fullDateRange(firstKey: string, todayKey: string): string[] {
  const keys: string[] = [];
  const [y, m, d] = firstKey.split('-').map(Number);
  let cur = Date.UTC(y, m - 1, d);
  const end = Date.UTC(
    Number(todayKey.slice(0, 4)),
    Number(todayKey.slice(5, 7)) - 1,
    Number(todayKey.slice(8, 10)),
  );
  while (cur <= end) {
    const t = new Date(cur);
    const yy = t.getUTCFullYear();
    const mm = String(t.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(t.getUTCDate()).padStart(2, '0');
    keys.push(`${yy}-${mm}-${dd}`);
    cur += 24 * 60 * 60 * 1000;
  }
  return keys;
}

function chunkLines(lines: string[]): string[] {
  const chunks: string[] = [];
  let cur = '';
  for (const line of lines) {
    if ((cur + '\n' + line).length > MAX_MESSAGE_LEN) {
      chunks.push(cur);
      cur = line;
    } else {
      cur = cur ? cur + '\n' + line : line;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

export function registerHuzurHandler(bot: Bot<BotContext>): void {
  // Bo'limga kirish
  bot.callbackQuery('admin:huzur', requireAdmin, async (ctx) => {
    try {
      await ctx.editMessageText(await buildHuzurEntryText(), { reply_markup: huzurMenuKeyboard() });
    } catch (err) {
      logger.error('Failed to open huzur section', { err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: huzurMenuKeyboard() });
    }
    await ctx.answerCallbackQuery();
  });

  // Statistika: birinchi kundan boshlab to'liq kunlik (Toshkent vaqti)
  bot.callbackQuery('admin:huzur:stats', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Hisoblanmoqda...' });
    try {
      const [leadDates, counters] = await Promise.all([
        huzurRepository.listAllLeadDates(),
        huzurRepository.listAllCounters(),
      ]);

      const leadsByDay = new Map<string, number>();
      for (const d of leadDates) {
        const key = tashkentDateKey(d);
        leadsByDay.set(key, (leadsByDay.get(key) ?? 0) + 1);
      }

      const visitsByDay = new Map<string, number>();
      for (const c of counters) {
        const key = tashkentDateKey(c.created_at);
        visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + visitValue(c.count));
      }

      const todayKey = lastTashkentDateKeys(1)[0];
      const allKeys = [...leadsByDay.keys(), ...visitsByDay.keys()].sort();
      const firstKey = allKeys.length > 0 ? allKeys[0] : todayKey;
      const dayKeys = fullDateRange(firstKey, todayKey);

      const totalVisits = [...visitsByDay.values()].reduce((s, v) => s + v, 0);

      const lines = [
        '🌐 Huzur statistikasi (Toshkent vaqti)',
        '',
        `📝 Jami lidlar: ${leadDates.length}`,
        `👁 Jami tashriflar: ${totalVisits}`,
        '',
        `📅 Birinchi kun: ${firstKey}`,
        '',
        'Kunlik (lid / tashrif):',
        ...dayKeys.map((k) => `${k}: ${leadsByDay.get(k) ?? 0} / ${visitsByDay.get(k) ?? 0}`),
      ];

      const chunks = chunkLines(lines);
      await ctx.editMessageText(chunks[0], {
        reply_markup: chunks.length === 1 ? huzurMenuKeyboard() : undefined,
      });
      for (let i = 1; i < chunks.length; i++) {
        await ctx.reply(chunks[i], {
          reply_markup: i === chunks.length - 1 ? huzurMenuKeyboard() : undefined,
        });
      }
    } catch (err) {
      logger.error('Failed to build huzur stats', { err });
      await ctx.editMessageText('❌ Statistikani hisoblab bo‘lmadi.', { reply_markup: huzurMenuKeyboard() });
    }
  });

  // Lidlar Excel
  bot.callbackQuery('admin:huzur:excel', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Excel tayyorlanmoqda...' });
    try {
      const { workbook, sheet } = createLeadsWorkbook();
      let n = 0;
      for await (const page of huzurRepository.iterateLeads()) {
        for (const lead of page) {
          n += 1;
          addLeadRow(sheet, n, lead);
        }
      }
      const buffer = await workbookToBuffer(workbook);
      const fileName = `huzur_lidlar_${lastTashkentDateKeys(1)[0]}.xlsx`;
      await ctx.replyWithDocument(new InputFile(buffer, fileName), {
        caption: `📝 Huzur lidlari\n\nJami: ${n} ta`,
      });
    } catch (err) {
      logger.error('Failed to export huzur leads excel', { err });
      await ctx.reply('❌ Excel yaratib bo‘lmadi.');
    }
  });

  // Lidlar ro'yxati — pagination
  bot.callbackQuery('admin:huzur:recent', requireAdmin, async (ctx) => {
    await sendLeadsPage(ctx, 0);
  });

  bot.callbackQuery(/^admin:huzur:recent:page:(\d+)$/, requireAdmin, async (ctx) => {
    await sendLeadsPage(ctx, Number(ctx.match[1]));
  });

  async function sendLeadsPage(
    ctx: { editMessageText: Function; answerCallbackQuery: Function },
    page: number,
  ) {
    try {
      const { rows, total } = await huzurRepository.listLeadsPage(page, LEADS_PAGE_SIZE);
      const totalPages = Math.max(Math.ceil(total / LEADS_PAGE_SIZE), 1);
      const safePage = Math.min(Math.max(page, 0), totalPages - 1);

      if (rows.length === 0 || total === 0) {
        await ctx.editMessageText('📝 Hali lidlar yo‘q.', { reply_markup: huzurMenuKeyboard() });
        await ctx.answerCallbackQuery();
        return;
      }

      // Sahifa chegaradan chiqib ketsa — to'g'rilab qayta
      if (safePage !== page) {
        await sendLeadsPage(ctx, safePage);
        return;
      }

      const lines = [`🕒 Lidlar (sahifa ${safePage + 1}/${totalPages}, jami ${total}):`, ''];
      rows.forEach((l, i) => {
        const n = safePage * LEADS_PAGE_SIZE + i + 1;
        lines.push(`${n}. 👤 ${l.full_name ?? '—'}\n   📞 ${l.phone_number ?? '—'}\n   🕒 ${formatTashkent(l.created_at)}\n`);
      });

      const kb = new InlineKeyboard();
      if (safePage > 0) kb.text('⬅️ Oldingi', `admin:huzur:recent:page:${safePage - 1}`);
      kb.text(`${safePage + 1}/${totalPages}`, 'noop');
      if (safePage < totalPages - 1) kb.text('Keyingi ➡️', `admin:huzur:recent:page:${safePage + 1}`);
      kb.row().text('⬅️ Huzur menyusi', 'admin:huzur');

      await ctx.editMessageText(lines.join('\n'), { reply_markup: kb });
    } catch (err) {
      logger.error('Failed to list huzur leads page', { err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: huzurMenuKeyboard() });
    }
    await ctx.answerCallbackQuery();
  }
}
