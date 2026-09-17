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

/** Manbani chiroyli ko'rinishda: bo'sh/null → (noma'lum). */
export function displaySource(source: string | null): string {
  const t = (source ?? '').trim();
  return t ? t : '(noma’lum)';
}

/** Manba nomini fayl nomida ishlatish uchun xavfsiz shaklga keltirish. */
export function safeFilePart(source: string | null): string {
  const t = (source ?? '').trim().replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '');
  return (t || 'manba').slice(0, 40);
}

/** Manba bo'yicha lidlar sonini hisoblash (tartiblangan ro'yxat). */
function countBySource(rows: { source: string | null }[]): { source: string | null; count: number }[] {
  const map = new Map<string | null, number>();
  for (const r of rows) {
    const s = (r.source ?? '').trim() ? r.source!.trim() : null;
    map.set(s, (map.get(s) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => {
      if (a.source == null) return 1;
      if (b.source == null) return -1;
      return a.source.localeCompare(b.source);
    });
}

export async function buildHuzurEntryText(): Promise<string> {
  const [leadRows, counters] = await Promise.all([
    huzurRepository.listAllLeadDatesWithSource(),
    huzurRepository.listAllCounters(),
  ]);
  const visits = counters.reduce((s, c) => s + visitValue(c.count), 0);
  const bySource = countBySource(leadRows);
  const lines = [
    '🌐 Huzur sayti (imanakhmedovna.uz/huzur)',
    '',
    `📝 Jami lidlar: ${leadRows.length}`,
    `👁 Jami tashriflar: ${visits}`,
  ];
  if (bySource.length > 0) {
    lines.push('', '🔗 Manbalar bo‘yicha:');
    for (const { source, count } of bySource) {
      lines.push(`   • ${displaySource(source)}: ${count}`);
    }
  }
  return lines.join('\n');
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

/** Excel uchun manba tanlash klaviaturasi (indekslar — callback hajmi chegarasi uchun). */
function excelSourceKeyboard(sources: Array<string | null>): InlineKeyboard {
  const kb = new InlineKeyboard().text('📥 Barchasi (hammasi birga)', 'admin:huzur:excel:all').row();
  sources.forEach((s, i) => {
    kb.text(`📥 ${displaySource(s)}`, `admin:huzur:excel:src:${i}`).row();
  });
  kb.text('⬅️ Huzur menyusi', 'admin:huzur');
  return kb;
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

  // Statistika: birinchi LID tushgan kundan boshlab to'liq kunlik (Toshkent vaqti)
  bot.callbackQuery('admin:huzur:stats', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Hisoblanmoqda...' });
    try {
      const [leadRows, counters] = await Promise.all([
        huzurRepository.listAllLeadDatesWithSource(),
        huzurRepository.listAllCounters(),
      ]);

      const leadsByDay = new Map<string, number>();
      const leadsByDaySource = new Map<string, Map<string | null, number>>();
      for (const r of leadRows) {
        const key = tashkentDateKey(r.created_at);
        const s = (r.source ?? '').trim() ? r.source!.trim() : null;
        leadsByDay.set(key, (leadsByDay.get(key) ?? 0) + 1);
        let m = leadsByDaySource.get(key);
        if (!m) {
          m = new Map();
          leadsByDaySource.set(key, m);
        }
        m.set(s, (m.get(s) ?? 0) + 1);
      }

      const visitsByDay = new Map<string, number>();
      for (const c of counters) {
        const key = tashkentDateKey(c.created_at);
        visitsByDay.set(key, (visitsByDay.get(key) ?? 0) + visitValue(c.count));
      }

      const todayKey = lastTashkentDateKeys(1)[0];
      const leadKeys = [...leadsByDay.keys()].sort();
      // Lidlar birinchi lid tushgan kundan hisoblanadi
      const firstKey =
        leadKeys.length > 0
          ? leadKeys[0]
          : [...visitsByDay.keys()].sort()[0] ?? todayKey;
      const dayKeys = fullDateRange(firstKey, todayKey);

      const totalVisits = [...visitsByDay.values()].reduce((s, v) => s + v, 0);
      const bySource = countBySource(leadRows);

      const lines = [
        '🌐 Huzur statistikasi (Toshkent vaqti)',
        '',
        `📝 Jami lidlar: ${leadRows.length}`,
        `👁 Jami tashriflar: ${totalVisits}`,
        '',
        `📅 Birinchi kun: ${firstKey}`,
      ];
      if (bySource.length > 0) {
        lines.push('', '🔗 Manbalar bo‘yicha:');
        for (const { source, count } of bySource) {
          lines.push(`   • ${displaySource(source)}: ${count}`);
        }
      }
      lines.push('', 'Kunlik (lid / tashrif):');
      lines.push(...dayKeys.map((k) => `${k}: ${leadsByDay.get(k) ?? 0} / ${visitsByDay.get(k) ?? 0}`));

      const daySourceLines: string[] = [];
      for (const k of dayKeys) {
        const m = leadsByDaySource.get(k);
        if (!m || m.size === 0) continue;
        const parts = [...m.entries()]
          .sort((a, b) => {
            if (a[0] == null) return 1;
            if (b[0] == null) return -1;
            return a[0].localeCompare(b[0]);
          })
          .map(([s, c]) => `${displaySource(s)} ${c}`)
          .join(', ');
        daySourceLines.push(`${k}: ${parts}`);
      }
      if (daySourceLines.length > 0) {
        lines.push('', 'Kunlik manba bo‘yicha:');
        lines.push(...daySourceLines);
      }

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

  // Lidlar Excel — manba tanlash menyusi
  bot.callbackQuery('admin:huzur:excel', requireAdmin, async (ctx) => {
    try {
      const [sources, total] = await Promise.all([
        huzurRepository.listDistinctSources(),
        huzurRepository.countLeads(),
      ]);
      if (total === 0) {
        await ctx.editMessageText('📝 Hali lidlar yo‘q.', { reply_markup: huzurMenuKeyboard() });
      } else if (sources.length === 0) {
        await sendLeadsExcel(ctx, null);
      } else {
        await ctx.editMessageText(`📥 Qaysi manbani yuklab olamiz?\n\nJami lidlar: ${total} ta`, {
          reply_markup: excelSourceKeyboard(sources),
        });
      }
    } catch (err) {
      logger.error('Failed to open huzur excel menu', { err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: huzurMenuKeyboard() });
    }
    await ctx.answerCallbackQuery();
  });

  // Lidlar Excel — barchasi birga
  bot.callbackQuery('admin:huzur:excel:all', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Excel tayyorlanmoqda...' });
    try {
      await sendLeadsExcel(ctx, undefined);
    } catch (err) {
      logger.error('Failed to export huzur leads excel', { err });
      await ctx.reply('❌ Excel yaratib bo‘lmadi.');
    }
  });

  // Lidlar Excel — bitta manba alohida
  bot.callbackQuery(/^admin:huzur:excel:src:(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Excel tayyorlanmoqda...' });
    try {
      const sources = await huzurRepository.listDistinctSources();
      const idx = Number(ctx.match[1]);
      const source = sources[idx];
      if (idx < 0 || idx >= sources.length || source === undefined) {
        await ctx.reply('❌ Manba topilmadi. Ro‘yxatni yangilab qayta urinib ko‘ring.');
        return;
      }
      await sendLeadsExcel(ctx, source);
    } catch (err) {
      logger.error('Failed to export huzur leads excel by source', { err });
      await ctx.reply('❌ Excel yaratib bo‘lmadi.');
    }
  });

  async function sendLeadsExcel(ctx: BotContext, source: string | null | undefined): Promise<void> {
    const { workbook, sheet } = createLeadsWorkbook();
    let n = 0;
    const pages =
      source === undefined ? huzurRepository.iterateLeads() : huzurRepository.iterateLeadsBySource(source);
    for await (const page of pages) {
      for (const lead of page) {
        n += 1;
        addLeadRow(sheet, n, lead);
      }
    }
    const buffer = await workbookToBuffer(workbook);
    const today = lastTashkentDateKeys(1)[0];
    const fileName =
      source === undefined
        ? `huzur_lidlar_${today}.xlsx`
        : `huzur_lidlar_${safeFilePart(source)}_${today}.xlsx`;
    const caption =
      source === undefined
        ? `📝 Huzur lidlari (barchasi)\n\nJami: ${n} ta`
        : `📝 Huzur lidlari\n🔗 Manba: ${displaySource(source)}\n\nJami: ${n} ta`;
    await ctx.replyWithDocument(new InputFile(buffer, fileName), { caption });
  }

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
        lines.push(
          `${n}. 👤 ${l.full_name ?? '—'}\n   📞 ${l.phone_number ?? '—'}\n   🔗 ${displaySource(l.source)}\n   🕒 ${formatTashkent(l.created_at)}\n`,
        );
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
