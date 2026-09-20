import { Bot } from 'grammy';
import { userService } from '../services/user.service.js';
import { startMessageService } from '../services/startMessage.service.js';
import { progrevService } from '../services/progrev.service.js';
import { usersRepository } from '../database/repositories/users.repository.js';
import type { BotContext, UserRow, SourceType } from '../types/index.js';
import { normalizeSource } from '../types/index.js';
import { logger } from '../utils/logger.js';

function extractSourceFromStartPayload(payload: string | undefined): SourceType | null {
  // /start vsl, /start vsl1..vsl10, /start instagram — hammasi qabul qilinadi.
  // vsl1..vsl10 → 'vsl' guruhiga map qilinadi (hammasiga bitta start+progrev).
  return normalizeSource(payload);
}

export function registerStartHandler(bot: Bot<BotContext>): void {
  bot.command('start', async (ctx) => {
    if (!ctx.from) return;
    const from = ctx.from;

    // 0) Source ni aniqlash — 3 holat:
    //  a) linkda vsl/vsl1..vslN bo'lsa → 'vsl' (VSL oqim)
    //  b) linkda instagram bo'lsa → 'instagram' (Instagram oqim)
    //  c) linkda hech narsa bo'lmasa (oddiy /start) → userning ESKI
    //     sourceni bazadan olamiz, VSL user instagramga o'tib ketmasligi uchun.
    //     Yangi user bo'lsa → 'instagram'.
    // 0) Source ni aniqlash — 3 holat:
    //  a) linkda vsl/vsl1..vslN bo'lsa → 'vsl' (VSL oqim, bazaga yoziladi)
    //  b) linkda instagram bo'lsa → 'instagram' (Instagram oqim, bazaga yoziladi)
    //  c) oddiy parametrsiz /start bo'lsa → userning ESKI guruhi saqlanadi:
    //     VSL odam VSLligicha qoladi (instagramga o'tib ketmaydi),
    //     Instagram odam Instagramligicha qoladi.
    //     Faqat mutlaqo yangi odam → 'instagram'.
    // Xom parametr ('vsl1', 'instagram', null) alohida saqlanadi —
    // Excel'da qaysi linkdan kelgani ko'rinadi.
    const rawParam = (ctx.match ?? '').trim().toLowerCase() || null;
    const payloadSource = extractSourceFromStartPayload(ctx.match);
    let finalSource: SourceType;
    if (payloadSource) {
      finalSource = payloadSource;
    } else {
      try {
        const existing = await usersRepository.findByTelegramId(from.id);
        finalSource = normalizeSource(existing?.source) ?? 'instagram';
      } catch (err) {
        logger.warn('Failed to read existing user source, falling back to instagram', {
          telegram_id: from.id,
          error: err instanceof Error ? err.message : String(err),
        });
        finalSource = 'instagram';
      }
    }

    logger.info('/start received', { telegram_id: from.id, source: finalSource, param: rawParam });

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
      source: finalSource,
      start_param: rawParam,
    };
    await startMessageService.deliverActiveStartMessage(bot, previewUser);

    // 2) Bazaga yozuv orqa fonda — javob tezligiga ta'sir qilmaydi.
    // Ichida retry bor, hech qachon throw qilmaydi.
    void userService.registerOrUpdateBackground({
      id: from.id,
      username: from.username,
      first_name: from.first_name,
      last_name: from.last_name,
      source: finalSource,
      startParam: rawParam,
    });

    // 3) Progrev rejasi ham orqa fonda — userning SHU start vaqtidan
    // nisbatan aktiv progrev xabarlar rejalanadi. Ichida throw yo'q.
    void progrevService.scheduleForStart({
      id: from.id,
      username: from.username,
      first_name: from.first_name,
      last_name: from.last_name,
      source: finalSource,
    });
  });
}
