import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { ichkiKuchRepository } from '../database/repositories/ichkiKuch.repository.js';
import {
  createIchkiKuchLeadsWorkbook,
  addIchkiKuchLeadRow,
  workbookToBuffer,
} from '../services/excel.service.js';
import { tashkentDateKey, lastTashkentDateKeys, formatTashkent } from '../utils/schedule.js';
import { displaySource, safeFilePart } from './huzur.handler.js';
import { logger } from '../utils/logger.js';
import type { BotContext } from '../types/index.js';

const LEADS_PAGE_SIZE = 5;
const MAX_MESSAGE_LEN = 3900;

export function ichkiKuchMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📊 Statistika', 'admin:ichkikuch:stats')
    .row()
    .text('📥 Lidlar Excel', 'admin:ichkikuch:excel')
    .row()
    .text('🕒 Lidlar ro‘yxati', 'admin:ichkikuch:recent')
    .row()
    .text('⬅️ Orqaga', 'admin:back');
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

/** Tarif bo'yicha lidlar sonini hisoblash (VIP / Premium). */
function countByTarif(rows: { tarif: string }[]): { tarif: string; count: number }[] {
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.tarif, (map.get(r.tarif) ?? 0) + 1);
  return [...map.entries()]
    .map(([tarif, count]) => ({ tarif, count }))
    .sort((a, b) => a.tarif.localeCompare(b.tarif));
}

export async function buildIchkiKuchEntryText(): Promise<string> {
  const leadRows = await ichkiKuchRepository.listAllLeadDatesWithSource();
  const bySource = countBySource(leadRows);
  const byTarif = countByTarif(leadRows);
  const lines = ['💪 Ichki kuch sayti', '', `📝 Jami lidlar: ${leadRows.length}`];
  if (byTarif.length > 0) {
    lines.push('', '🏷 Tarif bo‘yicha:');
    for (const { tarif, count } of byTarif) lines.push(`   • ${tarif}: ${count}`);
  }
  if (bySource.length > 0) {
    lines.push('', '🔗 Manbalar bo‘yicha:');
    for (const { source, count } of bySource) lines.push(`   • ${displaySource(source)}: ${count}`);
  }
  return lines.join('\n');
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
  const kb = new InlineKeyboard().text('📥 Barchasi (hammasi birga)', 'admin:ichkikuch:excel:all').row();
  sources.forEach((s, i) => {
    kb.text(`📥 ${displaySource(s)}`, `admin:ichkikuch:excel:src:${i}`).row();
  });
  kb.text('⬅️ Ichki kuch menyusi', 'admin:ichkikuch');
  return kb;
}

export function registerIchkiKuchHandler(bot: Bot<BotContext>): void {
  // Bo'limga kirish
  bot.callbackQuery('admin:ichkikuch', requireAdmin, async (ctx) => {
    try {
      await ctx.editMessageText(await buildIchkiKuchEntryText(), { reply_markup: ichkiKuchMenuKeyboard() });
    } catch (err) {
      logger.error('Failed to open ichki kuch section', { err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: ichkiKuchMenuKeyboard() });
    }
    await ctx.answerCallbackQuery();
  });

  // Statistika: birinchi LID tushgan kundan boshlab to'liq kunlik (Toshkent vaqti)
  bot.callbackQuery('admin:ichkikuch:stats', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Hisoblanmoqda...' });
    try {
      const leadRows = await ichkiKuchRepository.listAllLeadDatesWithSource();

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

      const todayKey = lastTashkentDateKeys(1)[0];
      const leadKeys = [...leadsByDay.keys()].sort();
      const firstKey = leadKeys.length > 0 ? leadKeys[0] : todayKey;
      const dayKeys = fullDateRange(firstKey, todayKey);

      const bySource = countBySource(leadRows);
      const byTarif = countByTarif(leadRows);

      const lines = [
        '💪 Ichki kuch statistikasi (Toshkent vaqti)',
        '',
        `📝 Jami lidlar: ${leadRows.length}`,
        '',
        `📅 Birinchi kun: ${firstKey}`,
      ];
      if (byTarif.length > 0) {
        lines.push('', '🏷 Tarif bo‘yicha:');
        for (const { tarif, count } of byTarif) lines.push(`   • ${tarif}: ${count}`);
      }
      if (bySource.length > 0) {
        lines.push('', '🔗 Manbalar bo‘yicha:');
        for (const { source, count } of bySource) lines.push(`   • ${displaySource(source)}: ${count}`);
      }
      lines.push('', 'Kunlik lidlar:');
      lines.push(...dayKeys.map((k) => `${k}: ${leadsByDay.get(k) ?? 0}`));

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
        reply_markup: chunks.length === 1 ? ichkiKuchMenuKeyboard() : undefined,
      });
      for (let i = 1; i < chunks.length; i++) {
        await ctx.reply(chunks[i], {
          reply_markup: i === chunks.length - 1 ? ichkiKuchMenuKeyboard() : undefined,
        });
      }
    } catch (err) {
      logger.error('Failed to build ichki kuch stats', { err });
      await ctx.editMessageText('❌ Statistikani hisoblab bo‘lmadi.', { reply_markup: ichkiKuchMenuKeyboard() });
    }
  });

  // Lidlar Excel — manba tanlash menyusi
  bot.callbackQuery('admin:ichkikuch:excel', requireAdmin, async (ctx) => {
    try {
      const [sources, total] = await Promise.all([
        ichkiKuchRepository.listDistinctSources(),
        ichkiKuchRepository.countLeads(),
      ]);
      if (total === 0) {
        await ctx.editMessageText('📝 Hali lidlar yo‘q.', { reply_markup: ichkiKuchMenuKeyboard() });
      } else if (sources.length === 0) {
        await sendLeadsExcel(ctx, null);
      } else {
        await ctx.editMessageText(`📥 Qaysi manbani yuklab olamiz?\n\nJami lidlar: ${total} ta`, {
          reply_markup: excelSourceKeyboard(sources),
        });
      }
    } catch (err) {
      logger.error('Failed to open ichki kuch excel menu', { err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: ichkiKuchMenuKeyboard() });
    }
    await ctx.answerCallbackQuery();
  });

  // Lidlar Excel — barchasi birga
  bot.callbackQuery('admin:ichkikuch:excel:all', requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Excel tayyorlanmoqda...' });
    try {
      await sendLeadsExcel(ctx, undefined);
    } catch (err) {
      logger.error('Failed to export ichki kuch leads excel', { err });
      await ctx.reply('❌ Excel yaratib bo‘lmadi.');
    }
  });

  // Lidlar Excel — bitta manba alohida
  bot.callbackQuery(/^admin:ichkikuch:excel:src:(\d+)$/, requireAdmin, async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Excel tayyorlanmoqda...' });
    try {
      const sources = await ichkiKuchRepository.listDistinctSources();
      const idx = Number(ctx.match[1]);
      const source = sources[idx];
      if (idx < 0 || idx >= sources.length || source === undefined) {
        await ctx.reply('❌ Manba topilmadi. Ro‘yxatni yangilab qayta urinib ko‘ring.');
        return;
      }
      await sendLeadsExcel(ctx, source);
    } catch (err) {
      logger.error('Failed to export ichki kuch leads excel by source', { err });
      await ctx.reply('❌ Excel yaratib bo‘lmadi.');
    }
  });

  async function sendLeadsExcel(ctx: BotContext, source: string | null | undefined): Promise<void> {
    const { workbook, sheet } = createIchkiKuchLeadsWorkbook();
    let n = 0;
    const pages =
      source === undefined
        ? ichkiKuchRepository.iterateLeads()
        : ichkiKuchRepository.iterateLeadsBySource(source);
    for await (const page of pages) {
      for (const lead of page) {
        n += 1;
        addIchkiKuchLeadRow(sheet, n, lead);
      }
    }
    const buffer = await workbookToBuffer(workbook);
    const today = lastTashkentDateKeys(1)[0];
    const fileName =
      source === undefined
        ? `ichki_kuch_lidlar_${today}.xlsx`
        : `ichki_kuch_lidlar_${safeFilePart(source)}_${today}.xlsx`;
    const caption =
      source === undefined
        ? `📝 Ichki kuch lidlari (barchasi)\n\nJami: ${n} ta`
        : `📝 Ichki kuch lidlari\n🔗 Manba: ${displaySource(source)}\n\nJami: ${n} ta`;
    await ctx.replyWithDocument(new InputFile(buffer, fileName), { caption });
  }

  // Lidlar ro'yxati — pagination
  bot.callbackQuery('admin:ichkikuch:recent', requireAdmin, async (ctx) => {
    await sendLeadsPage(ctx, 0);
  });

  bot.callbackQuery(/^admin:ichkikuch:recent:page:(\d+)$/, requireAdmin, async (ctx) => {
    await sendLeadsPage(ctx, Number(ctx.match[1]));
  });

  async function sendLeadsPage(
    ctx: { editMessageText: Function; answerCallbackQuery: Function },
    page: number,
  ) {
    try {
      const { rows, total } = await ichkiKuchRepository.listLeadsPage(page, LEADS_PAGE_SIZE);
      const totalPages = Math.max(Math.ceil(total / LEADS_PAGE_SIZE), 1);
      const safePage = Math.min(Math.max(page, 0), totalPages - 1);

      if (rows.length === 0 || total === 0) {
        await ctx.editMessageText('📝 Hali lidlar yo‘q.', { reply_markup: ichkiKuchMenuKeyboard() });
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
          `${n}. 👤 ${l.full_name ?? '—'}\n   📞 ${l.phone_number ?? '—'}\n   🏷 ${l.tarif ?? '—'}\n   🔗 ${displaySource(l.source)}\n   🕒 ${formatTashkent(l.created_at)}\n`,
        );
      });

      const kb = new InlineKeyboard();
      if (safePage > 0) kb.text('⬅️ Oldingi', `admin:ichkikuch:recent:page:${safePage - 1}`);
      kb.text(`${safePage + 1}/${totalPages}`, 'noop');
      if (safePage < totalPages - 1) kb.text('Keyingi ➡️', `admin:ichkikuch:recent:page:${safePage + 1}`);
      kb.row().text('⬅️ Ichki kuch menyusi', 'admin:ichkikuch');

      await ctx.editMessageText(lines.join('\n'), { reply_markup: kb });
    } catch (err) {
      logger.error('Failed to list ichki kuch leads page', { err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: ichkiKuchMenuKeyboard() });
    }
    await ctx.answerCallbackQuery();
  }
}
