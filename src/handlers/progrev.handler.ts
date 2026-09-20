import { Bot } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { progrevRepository } from '../database/repositories/progrev.repository.js';
import {
  progrevService,
  formatProgrevDelay,
  parseDelayPart,
  PROGREV_MAX_DAYS,
  PROGREV_MAX_HOURS,
  PROGREV_MAX_MINUTES,
  PROGREV_MIN_TOTAL_MINUTES,
} from '../services/progrev.service.js';
import {
  progrevMenuKeyboard,
  progrevListKeyboard,
  progrevItemKeyboard,
  progrevEditKeyboard,
  progrevDeleteConfirmKeyboard,
  progrevKbEditKeyboard,
  formatKbList,
  progrevKeyboardAskKeyboard,
  sourceSelectionKeyboard,
} from '../keyboards/progrev.keyboard.js';
import { backKeyboard } from '../keyboards/admin.keyboard.js';
import { getAdminState, setAdminState, resetAdminState } from '../state/adminState.js';
import { detectContentType, extractCaptionOrText, extractFileId, copyToStorage, deliverStorageMessage } from '../services/telegram.service.js';
import { env } from '../config/env.js';
import type { BotContext, SessionData, KeyboardButton, ProgrevMessageRow, ContentTypeName } from '../types/index.js';
import { normalizeSource, sourceDisplayName } from '../types/index.js';
import { logger } from '../utils/logger.js';

function progrevItemText(msg: ProgrevMessageRow): string {
  return [
    `🔥 ${msg.name}`,
    `📋 Source: ${sourceDisplayName(msg.source)}`,
    '',
    `⏳ Interval: ${formatProgrevDelay(msg.delay_days, msg.delay_hours, msg.delay_minutes)}`,
    `   (start bosgandan keyin)`,
    `${msg.is_active ? '🟢 Aktiv' : '⚪ O‘chiq'}`,
    `✅ Yuborilgan: ${msg.sent_count ?? 0}`,
    `❌ Xatolik: ${msg.failed_count ?? 0}`,
  ].join('\n');
}

export function registerProgrevHandler(bot: Bot<BotContext>): void {
  // === MENU ===
  bot.callbackQuery('admin:progrev', requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    try {
      const [all, pending] = await Promise.all([
        progrevRepository.listAll(),
        progrevRepository.countPending(),
      ]);
      const active = all.filter((m) => m.is_active).length;
      await ctx.editMessageText(
        `🔥 Progrev xabarlar\n\n` +
          `📋 Jami: ${all.length} ta (🟢 ${active} aktiv)\n` +
          `⏳ Kutilmoqda: ${pending} ta yuborish\n\n` +
          `Har bir user O'ZINING /start vaqtidan nisbatan oladi.\n` +
          `🌙 Qoida: 22:00–08:00 da yuborilmaydi, to'planganlari 08:00 da ketadi.`,
        { reply_markup: progrevMenuKeyboard() },
      );
    } catch (err) {
      logger.error('Failed to open progrev menu', { err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: backKeyboard('admin:broadcast') });
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:progrev:add', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    setAdminState(ctx.from.id, { step: 'waiting_for_progrev_source' });
    await ctx.editMessageText(
      '📋 Qaysi manba uchun progrev yaratmoqchisiz?\n\n🎬 VSL (vsl1..vsl10 linklarning HAMMASI uchun bitta) yoki 📸 Instagram — ikkisi alohida saqlanadi:',
      { reply_markup: sourceSelectionKeyboard('admin:progrev:source') },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:progrev:source:(.+)$/, requireAdmin, async (ctx, next) => {
    // source:set:... edit callbacklari bilan to'qnashmasligi uchun
    if (ctx.match[1].startsWith('set:')) return next();
    if (!ctx.from) return;
    const source = normalizeSource(ctx.match[1]);
    if (!source) {
      await ctx.answerCallbackQuery({ text: 'Noto‘g‘ri manba', show_alert: true });
      return;
    }
    setAdminState(ctx.from.id, { step: 'waiting_for_progrev_message', pendingSource: source });
    await ctx.editMessageText(
      `✅ Manba tanlandi: ${sourceDisplayName(source)}\n\n📩 Progrev xabarni botga yuboring yoki kanaldan forward qiling.`,
      { reply_markup: backKeyboard('admin:progrev') },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:progrev:list', requireAdmin, async (ctx) => {
    await sendProgrevList(ctx);
  });

  bot.callbackQuery(/^admin:progrev:pick:(.+)$/, requireAdmin, async (ctx) => {
    await showProgrevItem(ctx, ctx.match[1], true);
  });

  // Progrev asl postini ko'rish (userga qanday bor bo'lsa shunday)
  bot.callbackQuery(/^admin:progrev:view:(.+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    await ctx.answerCallbackQuery({ text: 'Ochilmoqda...' });
    if (!ctx.from) return;
    try {
      const msg = await progrevRepository.getById(id);
      if (!msg) {
        await ctx.reply('❌ Progrev topilmadi.');
        return;
      }
      const now = new Date().toISOString();
      await ctx.reply(
        `👁 Ko‘rinish: "${msg.name}" [${sourceDisplayName(msg.source)}]\n⏳ ${formatProgrevDelay(msg.delay_days, msg.delay_hours, msg.delay_minutes)} (startdan keyin)`,
      );
      await deliverStorageMessage({
        api: bot.api,
        toTelegramId: ctx.from.id,
        fromChannelId: msg.channel_id,
        fromMessageId: msg.message_id,
        capturedCaption: msg.caption_text,
        capturedContentType: (msg.content_type ?? undefined) as ContentTypeName | undefined,
        capturedFileId: msg.file_id ?? undefined,
        capturedKeyboardButtons: msg.keyboard_buttons,
        user: {
          id: '',
          telegram_id: ctx.from.id,
          username: ctx.from.username ?? null,
          first_name: ctx.from.first_name ?? null,
          last_name: ctx.from.last_name ?? null,
          is_active: true,
          started_at: now,
          updated_at: now,
          created_at: now,
          source: msg.source,
        },
      });
    } catch (err) {
      logger.error('Failed to preview progrev message', { id, err });
      await ctx
        .reply('❌ Ko‘rib bo‘lmadi. Kontent storage kanaldan o‘chgan bo‘lishi mumkin.')
        .catch(() => undefined);
    }
  });

  bot.callbackQuery(/^admin:progrev:toggle:(.+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    try {
      const msg = await progrevRepository.getById(id);
      if (!msg) {
        await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
        return;
      }
      const newActive = !msg.is_active;
      await progrevRepository.setActive(id, newActive);

      await ctx.answerCallbackQuery({ text: newActive ? '✅ Yoqildi' : '⏸ O\'chirildi' });
      // Yoqilganda — barcha active userlarga reja yaratish FONDA ketadi.
      // Ko'p user bo'lsa kutib qolmasligi uchun javob darhol qaytariladi,
      // soni tayyor bo'lganda alohida xabar bilan aytiladi.
      const scheduledInfo = newActive ? '\n⏳ Userlarga reja fonda yaratilmoqda...' : '';
      await showProgrevItem(ctx, id, true, scheduledInfo);
      if (newActive) {
        void progrevService
          .scheduleForAllActiveUsers(id)
          .then(({ scheduled }) =>
            ctx.reply(`👥 "${msg.name}": ${scheduled} ta userga reja yaratildi.`).catch(() => undefined),
          );
      }
    } catch (err) {
      logger.error('Failed to toggle progrev message', { id, err });
      await ctx.answerCallbackQuery({ text: 'Xatolik', show_alert: true });
    }
  });

  bot.callbackQuery(/^admin:progrev:delete:ask:(.+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    const msg = await progrevRepository.getById(id);
    if (!msg) {
      await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
      return;
    }
    await ctx.editMessageText(`🗑 "${msg.name}" o‘chirilsinmi?\n\nKutilayotgan yuborishlar ham bekor qilinadi.`, {
      reply_markup: progrevDeleteConfirmKeyboard(id),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:progrev:delete:yes:(.+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    try {
      await progrevRepository.cancelPendingByProgrev(id);
      await progrevRepository.delete(id);
      await ctx.answerCallbackQuery({ text: '✅ O‘chirildi' });
      await sendProgrevList(ctx);
    } catch (err) {
      logger.error('Failed to delete progrev message', { id, err });
      await ctx.answerCallbackQuery({ text: 'Xatolik', show_alert: true });
    }
  });

  // === O'ZGARTIRISH ===
  bot.callbackQuery(/^admin:progrev:edit:([^:]+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    try {
      const msg = await progrevRepository.getById(id);
      if (!msg) {
        await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
        return;
      }
      if (ctx.from) resetAdminState(ctx.from.id);
      await ctx.editMessageText(
        `✏️ O‘zgartirish: "${msg.name}"\n\n` +
          `📋 Source: ${sourceDisplayName(msg.source)}\n` +
          `⏳ Hozir: ${formatProgrevDelay(msg.delay_days, msg.delay_hours, msg.delay_minutes)}\n` +
          `${msg.is_active ? '🟢 Aktiv' : '⚪ O‘chiq'}\n\n` +
          `Nimani o‘zgartiramiz?`,
        { reply_markup: progrevEditKeyboard(id) },
      );
    } catch (err) {
      logger.error('Failed to open progrev edit menu', { id, err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: backKeyboard('admin:progrev') });
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:progrev:edit:source:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const id = ctx.match[1];
    setAdminState(ctx.from.id, { step: 'waiting_for_progrev_source_edit', editingProgrevId: id });
    await ctx.editMessageText('📋 Yangi sourceni tanlang (qaysi linkdan kelganlarga yuboriladi?):', {
      reply_markup: sourceSelectionKeyboard(`admin:progrev:source:set:${id}`),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:progrev:source:set:(.+):(.+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    const source = normalizeSource(ctx.match[2]);
    if (!source) {
      await ctx.answerCallbackQuery({ text: 'Noto‘g‘ri manba', show_alert: true });
      return;
    }
    try {
      await progrevRepository.updateSource(id, source);
      if (ctx.from) resetAdminState(ctx.from.id);
      await ctx.answerCallbackQuery({ text: `✅ ${sourceDisplayName(source)}` });
      await showProgrevItem(ctx, id, true, `\n📋 Source: ${sourceDisplayName(source)} ga o‘zgartirildi`);
    } catch (err) {
      logger.error('Failed to update progrev source', { id, err });
      await ctx.answerCallbackQuery({ text: 'Xatolik', show_alert: true });
    }
  });

  bot.callbackQuery(/^admin:progrev:edit:name:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    setAdminState(ctx.from.id, { step: 'waiting_for_progrev_edit_name', editingProgrevId: ctx.match[1] });
    await ctx.editMessageText('📝 Yangi nomni kiriting (1–80 belgi):', {
      reply_markup: backKeyboard(`admin:progrev:edit:${ctx.match[1]}`),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:progrev:edit:delay:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    setAdminState(ctx.from.id, { step: 'waiting_for_progrev_edit_days', editingProgrevId: ctx.match[1] });
    await ctx.editMessageText(
      `📅 Yangi interval — necha KUN o‘tib yuborilsin?\n\nFaqat son (0–${PROGREV_MAX_DAYS}).`,
      { reply_markup: backKeyboard(`admin:progrev:edit:${ctx.match[1]}`) },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:progrev:edit:msg:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    setAdminState(ctx.from.id, { step: 'waiting_for_progrev_edit_message', editingProgrevId: ctx.match[1] });
    await ctx.editMessageText('📩 Yangi kontentni yuboring yoki kanaldan forward qiling.', {
      reply_markup: backKeyboard(`admin:progrev:edit:${ctx.match[1]}`),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:progrev:edit:kb:(.+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    try {
      const msg = await progrevRepository.getById(id);
      if (!msg) {
        await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
        return;
      }
      await ctx.editMessageText(`🔗 Hozirgi tugmalar:\n${formatKbList(msg.keyboard_buttons)}`, {
        reply_markup: progrevKbEditKeyboard(id),
      });
    } catch (err) {
      logger.error('Failed to open progrev keyboard edit', { id, err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: backKeyboard('admin:progrev') });
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:progrev:kb:add:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const id = ctx.match[1];
    const msg = await progrevRepository.getById(id);
    if (!msg) {
      await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
      return;
    }
    setAdminState(ctx.from.id, {
      step: 'waiting_for_progrev_keyboard_name',
      editingProgrevId: id,
      pendingKeyboardButtons: [...msg.keyboard_buttons],
    });
    await ctx.editMessageText('🔗 Tugma nomini kiriting (masalan: Kanalga obuna):');
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:progrev:kb:clear:(.+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    try {
      await progrevRepository.updateKeyboardButtons(id, []);
      await ctx.answerCallbackQuery({ text: '✅ Tozalandi' });
      await showProgrevItem(ctx, id, true);
    } catch (err) {
      logger.error('Failed to clear progrev keyboard', { id, err });
      await ctx.answerCallbackQuery({ text: 'Xatolik', show_alert: true });
    }
  });

  // === KEYBOARD (inline tugmalar) ===
  bot.callbackQuery('admin:progrev:kb:yes', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const state = getAdminState(ctx.from.id) as SessionData;
    setAdminState(ctx.from.id, {
      step: 'waiting_for_progrev_keyboard_name',
      pendingChannelMessage: state.pendingChannelMessage,
      pendingProgrevName: state.pendingProgrevName,
      pendingSource: state.pendingSource,
      pendingProgrevDelay: state.pendingProgrevDelay,
      pendingKeyboardButtons: [],
    });
    await ctx.editMessageText('🔗 Tugma nomini kiriting (masalan: Kanalga obuna):');
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:progrev:kb:no', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    await finishProgrevCreation(ctx, []);
    await ctx.answerCallbackQuery();
  });

  // === FORWARD (kanaldan) ===
  bot.on(':forward_origin', requireAdmin, async (ctx, next) => {
    if (!ctx.from) return next();
    if (!ctx.message) return next();
    const state = getAdminState(ctx.from.id) as SessionData;

    if (state.step === 'waiting_for_progrev_message') {
      const forward = ctx.message.forward_origin;
      if (!forward || forward.type !== 'channel') {
        await ctx.reply('❌ Iltimos, kanaldan forward qiling yoki xabarni to‘g‘ridan-to‘g‘ri yuboring.');
        return;
      }
      await handleProgrevContent(ctx, forward.chat.id, forward.message_id);
      return;
    }

    if (state.step === 'waiting_for_progrev_edit_message') {
      const forward = ctx.message.forward_origin;
      if (!forward || forward.type !== 'channel') {
        await ctx.reply('❌ Iltimos, kanaldan forward qiling yoki xabarni to‘g‘ridan-to‘g‘ri yuboring.');
        return;
      }
      await handleProgrevContentEdit(ctx, forward.chat.id, forward.message_id);
      return;
    }

    return next();
  });

  // === TO'G'RIDAN-TO'G'RI XABAR — storage kanalga nusxalanadi ===
  bot.on('message', requireAdmin, async (ctx, next) => {
    if (!ctx.from) return next();
    if (!ctx.message) return next();
    if (ctx.message.forward_origin) return next();
    const maybeText = (ctx.message as { text?: string }).text;
    if (maybeText?.startsWith('/')) return next();

    const state = getAdminState(ctx.from.id) as SessionData;
    if (state.step !== 'waiting_for_progrev_message' && state.step !== 'waiting_for_progrev_edit_message') {
      return next();
    }

    const contentType = detectContentType(ctx.message);
    if (contentType === 'unsupported') {
      await ctx.reply('❌ Bu turdagi xabarni qo‘llab-quvvatlamaymiz.');
      return;
    }

    try {
      const stored = await copyToStorage(bot, ctx.from.id, ctx.message.message_id, env.STORAGE_CHANNEL_ID);
      if (state.step === 'waiting_for_progrev_edit_message') {
        await handleProgrevContentEdit(ctx, stored.channelId, stored.messageId);
      } else {
        await handleProgrevContent(ctx, stored.channelId, stored.messageId);
      }
    } catch (err) {
      logger.error('Failed to copy progrev message to storage', { err });
      await ctx.reply(
        '❌ Xabarni saqlab bo‘lmadi. Bot storage kanalda admin ekanini tekshiring ' +
          'yoki xabarni kanaldan forward qiling.',
      );
    }
  });

  // === TEXT QADAMLAR ===
  bot.on('message:text', requireAdmin, async (ctx, next) => {
    if (!ctx.from) return next();
    const state = getAdminState(ctx.from.id) as SessionData;
    const step = state.step as string;
    const text = ctx.message.text.trim();

    // Nom kiritish
    if (step === 'waiting_for_progrev_name') {
      if (!text || text.length > 80) {
        await ctx.reply('❌ Nom 1–80 belgi oralig‘ida bo‘lishi kerak.');
        return;
      }
      setAdminState(ctx.from.id, {
        step: 'waiting_for_progrev_delay_days',
        pendingChannelMessage: state.pendingChannelMessage,
        pendingProgrevName: text,
        pendingSource: state.pendingSource,
      });
      await ctx.reply(
        `✅ Nom: "${text}"\n\n📅 Start bosgandan keyin necha KUN o‘tib yuborilsin?\n\n` +
          `Faqat son kiriting (0–${PROGREV_MAX_DAYS}). Masalan: 1`,
      );
      return;
    }

    // Kun kiritish
    if (step === 'waiting_for_progrev_delay_days') {
      const days = parseDelayPart(text, PROGREV_MAX_DAYS);
      if (days == null) {
        await ctx.reply(`❌ Noto‘g‘ri. 0–${PROGREV_MAX_DAYS} oralig‘ida butun son kiriting.`);
        return;
      }
      setAdminState(ctx.from.id, {
        step: 'waiting_for_progrev_delay_hours',
        pendingChannelMessage: state.pendingChannelMessage,
        pendingProgrevName: state.pendingProgrevName,
        pendingSource: state.pendingSource,
        pendingProgrevDelay: { days, hours: 0, minutes: 0 },
      });
      await ctx.reply(`✅ Kun: ${days}\n\n🕐 Necha SOAT o‘tib yuborilsin?\n\nFaqat son (0–${PROGREV_MAX_HOURS}). Masalan: 2`);
      return;
    }

    // Soat kiritish
    if (step === 'waiting_for_progrev_delay_hours') {
      const hours = parseDelayPart(text, PROGREV_MAX_HOURS);
      if (hours == null) {
        await ctx.reply(`❌ Noto‘g‘ri. 0–${PROGREV_MAX_HOURS} oralig‘ida butun son kiriting.`);
        return;
      }
      const prev = state.pendingProgrevDelay ?? { days: 0, hours: 0, minutes: 0 };
      setAdminState(ctx.from.id, {
        step: 'waiting_for_progrev_delay_minutes',
        pendingChannelMessage: state.pendingChannelMessage,
        pendingProgrevName: state.pendingProgrevName,
        pendingSource: state.pendingSource,
        pendingProgrevDelay: { days: prev.days, hours, minutes: 0 },
      });
      await ctx.reply(
        `✅ Soat: ${hours}\n\n⏱ Necha DAQIQA o‘tib yuborilsin?\n\nFaqat son (0–${PROGREV_MAX_MINUTES}). Masalan: 30`,
      );
      return;
    }

    // Daqiqa kiritish → yakuniy tasdiq (tugma so'rash)
    if (step === 'waiting_for_progrev_delay_minutes') {
      const minutes = parseDelayPart(text, PROGREV_MAX_MINUTES);
      if (minutes == null) {
        await ctx.reply(`❌ Noto‘g‘ri. 0–${PROGREV_MAX_MINUTES} oralig‘ida butun son kiriting.`);
        return;
      }
      const prev = state.pendingProgrevDelay ?? { days: 0, hours: 0, minutes: 0 };
      const delay = { days: prev.days, hours: prev.hours, minutes };
      const totalMinutes = delay.days * 24 * 60 + delay.hours * 60 + delay.minutes;
      if (totalMinutes < PROGREV_MIN_TOTAL_MINUTES) {
        await ctx.reply('❌ Jami interval kamida 1 daqiqa bo‘lishi kerak. Daqiqani qayta kiriting.');
        return;
      }
      setAdminState(ctx.from.id, {
        step: 'waiting_for_progrev_keyboard_ask',
        pendingChannelMessage: state.pendingChannelMessage,
        pendingProgrevName: state.pendingProgrevName,
        pendingSource: state.pendingSource,
        pendingProgrevDelay: delay,
        pendingKeyboardButtons: [],
      });
      await ctx.reply(
        `✅ Interval: ${formatProgrevDelay(delay.days, delay.hours, delay.minutes)}\n\n🔗 Inline tugma qo‘shasizmi?`,
        { reply_markup: progrevKeyboardAskKeyboard() },
      );
      return;
    }

    // === PROGREV TAHRIRLASH ===
    // Nom tahriri
    if (step === 'waiting_for_progrev_edit_name') {
      const id = state.editingProgrevId;
      if (!id) return next();
      if (!text || text.length > 80) {
        await ctx.reply('❌ Nom 1–80 belgi oralig‘ida bo‘lishi kerak.');
        return;
      }
      try {
        await progrevRepository.updateName(id, text);
        resetAdminState(ctx.from.id);
        await ctx.reply(`✅ Nom yangilandi: "${text}"`);
        await showProgrevItem(ctx, id, false);
      } catch (err) {
        logger.error('Failed to rename progrev message', { id, err });
        resetAdminState(ctx.from.id);
        await ctx.reply('❌ Saqlab bo‘lmadi, texnik xatolik.');
      }
      return;
    }

    // Interval tahriri — kun
    if (step === 'waiting_for_progrev_edit_days') {
      const id = state.editingProgrevId;
      if (!id) return next();
      const days = parseDelayPart(text, PROGREV_MAX_DAYS);
      if (days == null) {
        await ctx.reply(`❌ Noto‘g‘ri. 0–${PROGREV_MAX_DAYS} oralig‘ida butun son kiriting.`);
        return;
      }
      setAdminState(ctx.from.id, {
        step: 'waiting_for_progrev_edit_hours',
        editingProgrevId: id,
        pendingProgrevDelay: { days, hours: 0, minutes: 0 },
      });
      await ctx.reply(`✅ Kun: ${days}\n\n🕐 Yangi SOATni kiriting (0–${PROGREV_MAX_HOURS}):`);
      return;
    }

    // Interval tahriri — soat
    if (step === 'waiting_for_progrev_edit_hours') {
      const id = state.editingProgrevId;
      if (!id) return next();
      const hours = parseDelayPart(text, PROGREV_MAX_HOURS);
      if (hours == null) {
        await ctx.reply(`❌ Noto‘g‘ri. 0–${PROGREV_MAX_HOURS} oralig‘ida butun son kiriting.`);
        return;
      }
      const prev = state.pendingProgrevDelay ?? { days: 0, hours: 0, minutes: 0 };
      setAdminState(ctx.from.id, {
        step: 'waiting_for_progrev_edit_minutes',
        editingProgrevId: id,
        pendingProgrevDelay: { days: prev.days, hours, minutes: 0 },
      });
      await ctx.reply(`✅ Soat: ${hours}\n\n⏱ Yangi DAQIQAnni kiriting (0–${PROGREV_MAX_MINUTES}):`);
      return;
    }

    // Interval tahriri — daqiqa → saqlash + kutilayotganlarni ko'chirish
    if (step === 'waiting_for_progrev_edit_minutes') {
      const id = state.editingProgrevId;
      if (!id) return next();
      const minutes = parseDelayPart(text, PROGREV_MAX_MINUTES);
      if (minutes == null) {
        await ctx.reply(`❌ Noto‘g‘ri. 0–${PROGREV_MAX_MINUTES} oralig‘ida butun son kiriting.`);
        return;
      }
      const prev = state.pendingProgrevDelay ?? { days: 0, hours: 0, minutes: 0 };
      const delay = { days: prev.days, hours: prev.hours, minutes };
      const totalMinutes = delay.days * 24 * 60 + delay.hours * 60 + delay.minutes;
      if (totalMinutes < PROGREV_MIN_TOTAL_MINUTES) {
        await ctx.reply('❌ Jami interval kamida 1 daqiqa bo‘lishi kerak. Daqiqani qayta kiriting.');
        return;
      }
      try {
        const { shifted } = await progrevService.updateDelayAndReschedule(id, delay);
        resetAdminState(ctx.from.id);
        await ctx.reply(
          `✅ Interval yangilandi: ${formatProgrevDelay(delay.days, delay.hours, delay.minutes)}\n` +
            `⏳ Kutilayotgan ${shifted} ta reja yangi vaqtga ko‘chirildi.`,
        );
        await showProgrevItem(ctx, id, false);
      } catch (err) {
        logger.error('Failed to update progrev delay', { id, err });
        resetAdminState(ctx.from.id);
        await ctx.reply('❌ Saqlab bo‘lmadi, texnik xatolik.');
      }
      return;
    }

    // Tugma nomi
    if (step === 'waiting_for_progrev_keyboard_name') {
      if (!text) {
        await ctx.reply('❌ Nom bo‘sh bo‘lishi mumkin emas.');
        return;
      }
      if (text.toLowerCase() === 'tayyor') {
        const editingId = state.editingProgrevId;
        const buttons = state.pendingKeyboardButtons ?? [];
        if (editingId) {
          try {
            await progrevRepository.updateKeyboardButtons(editingId, buttons);
            resetAdminState(ctx.from.id);
            await ctx.reply(`✅ Tugmalar yangilandi. Jami: ${buttons.length} ta.`);
            await showProgrevItem(ctx, editingId, false);
          } catch (err) {
            logger.error('Failed to update progrev keyboard', { id: editingId, err });
            resetAdminState(ctx.from.id);
            await ctx.reply('❌ Saqlab bo‘lmadi, texnik xatolik.');
          }
        } else {
          await finishProgrevCreation(ctx, buttons);
        }
        return;
      }
      setAdminState(ctx.from.id, {
        step: 'waiting_for_progrev_keyboard_url',
        pendingChannelMessage: state.pendingChannelMessage,
        pendingProgrevName: state.pendingProgrevName,
        pendingSource: state.pendingSource,
        pendingProgrevDelay: state.pendingProgrevDelay,
        pendingKeyboardButtons: state.pendingKeyboardButtons,
        pendingButtonName: text,
      });
      await ctx.reply(`✅ "${text}"\n\n🔗 URL linkni kiriting (https://...):`);
      return;
    }

    // Tugma URL
    if (step === 'waiting_for_progrev_keyboard_url') {
      if (!text.startsWith('http://') && !text.startsWith('https://')) {
        await ctx.reply('❌ URL http:// yoki https:// bilan boshlanishi kerak.');
        return;
      }
      const buttonName = state.pendingButtonName ?? 'Link';
      const buttons = state.pendingKeyboardButtons ?? [];
      buttons.push({ text: buttonName, url: text });
      setAdminState(ctx.from.id, {
        step: 'waiting_for_progrev_keyboard_name',
        pendingChannelMessage: state.pendingChannelMessage,
        pendingProgrevName: state.pendingProgrevName,
        pendingSource: state.pendingSource,
        pendingProgrevDelay: state.pendingProgrevDelay,
        pendingKeyboardButtons: buttons,
        pendingButtonName: undefined,
      });
      await ctx.reply(
        `✅ "${buttonName}" qo‘shildi. Jami: ${buttons.length} ta tugma.\n\n` +
          'Yana tugma qo‘shing yoki "Tayyor" deb yozing.',
      );
      return;
    }

    return next();
  });

  // === HELPERLAR ===
  async function handleProgrevContent(ctx: BotContext, channelId: number, messageId: number): Promise<void> {
    try {
      const msg = ctx.message;
      if (!msg || !ctx.from) return;
      const text = extractCaptionOrText(msg);
      const fileId = extractFileId(msg) ?? null;
      const contentType = detectContentType(msg);
      const prevSource = (getAdminState(ctx.from.id) as SessionData).pendingSource;

      setAdminState(ctx.from.id, {
        step: 'waiting_for_progrev_name',
        pendingChannelMessage: {
          channelId,
          messageId,
          text,
          fileId,
          hasPlaceholder: !!text && /\{name\}|\{username\}/.test(text),
          contentType,
        },
        pendingSource: prevSource,
      });
      await ctx.reply(
        `✅ Xabar qabul qilindi! (Source: ${sourceDisplayName(prevSource)})\n\n📝 Endi progrev nomini kiriting (ro‘yxatda ko‘rinadi):`,
      );
    } catch (err) {
      logger.error('Failed to handle progrev message', { err });
      await ctx.reply('❌ Texnik xatolik yuz berdi.').catch(() => undefined);
    }
  }

  async function handleProgrevContentEdit(ctx: BotContext, channelId: number, messageId: number): Promise<void> {
    if (!ctx.from || !ctx.message) return;
    const id = (getAdminState(ctx.from.id) as SessionData).editingProgrevId;
    if (!id) {
      resetAdminState(ctx.from.id);
      await ctx.reply('❌ Sessiya topilmadi, boshidan boshlang.');
      return;
    }
    try {
      const msg = ctx.message;
      await progrevRepository.updateContent(id, {
        channel_id: channelId,
        message_id: messageId,
        caption_text: extractCaptionOrText(msg),
        content_type: detectContentType(msg),
        file_id: extractFileId(msg) ?? null,
      });
      resetAdminState(ctx.from.id);
      await ctx.reply('✅ Kontent yangilandi!');
      await showProgrevItem(ctx, id, false);
    } catch (err) {
      logger.error('Failed to update progrev content', { id, err });
      resetAdminState(ctx.from.id);
      await ctx.reply('❌ Saqlab bo‘lmadi, texnik xatolik.');
    }
  }

  async function finishProgrevCreation(ctx: BotContext, buttons: KeyboardButton[]): Promise<void> {
    if (!ctx.from) return;
    const state = getAdminState(ctx.from.id) as SessionData;
    const stored = state.pendingChannelMessage;
    const name = (state.pendingProgrevName ?? '').trim();
    const delay = state.pendingProgrevDelay;
    const source = normalizeSource(state.pendingSource) ?? 'instagram';

    if (!stored || !name || !delay) {
      resetAdminState(ctx.from.id);
      if (ctx.callbackQuery) {
        await ctx.editMessageText('❌ Ma’lumot topilmadi, boshidan boshlang.', {
          reply_markup: backKeyboard('admin:progrev'),
        });
      } else {
        await ctx.reply('❌ Ma’lumot topilmadi, boshidan boshlang.');
      }
      return;
    }

    try {
      const created = await progrevRepository.create({
        name,
        channel_id: stored.channelId,
        message_id: stored.messageId,
        delay_days: delay.days,
        delay_hours: delay.hours,
        delay_minutes: delay.minutes,
        keyboard_buttons: buttons,
        caption_text: stored.text,
        content_type: stored.contentType,
        file_id: stored.fileId,
        source,
      });
      resetAdminState(ctx.from.id);

      // Yangi progrev — faqat SHU source dagi active userlarga reja yaratish.
      // User ko'p bo'lsa sekin bo'lishi mumkin, shuning uchun FONDA ketadi:
      // javob darhol chiqadi, soni tayyor bo'lganda alohida xabar keladi.
      // (Oldin shu yerda kutilgani uchun "qotib qolgan"dek ko'ringan.)
      const text =
        `✅ Progrev saqlandi!\n\n` +
        `🔥 ${created.name}\n` +
        `📋 Source: ${sourceDisplayName(source)}\n` +
        `⏳ ${formatProgrevDelay(delay.days, delay.hours, delay.minutes)} (startdan keyin)\n` +
        `🟢 Aktiv\n\n` +
        `⏳ Userlarga reja fonda yaratilmoqda...`;
      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { reply_markup: progrevItemKeyboard(created) });
      } else {
        await ctx.reply(text, { reply_markup: progrevItemKeyboard(created) });
      }
      void progrevService
        .scheduleForAllActiveUsers(created.id)
        .then(({ scheduled }) =>
          ctx
            .reply(`👥 "${created.name}": ${scheduled} ta active userga reja yaratildi.`)
            .catch(() => undefined),
        );
    } catch (err) {
      logger.error('Failed to create progrev message', { err });
      resetAdminState(ctx.from.id);
      const text = '❌ Saqlab bo‘lmadi, texnik xatolik. Qayta urinib ko‘ring.';
      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { reply_markup: backKeyboard('admin:progrev') });
      } else {
        await ctx.reply(text);
      }
    }
  }

  async function sendProgrevList(ctx: BotContext): Promise<void> {
    try {
      const messages = await progrevRepository.listAll();
      if (messages.length === 0) {
        await ctx.editMessageText('📋 Hozircha progrev xabarlar yo‘q.\n\n➕ Yangi progrev qo‘shing.', {
          reply_markup: progrevMenuKeyboard(),
        });
      } else {
        const active = messages.filter((m) => m.is_active).length;
        await ctx.editMessageText(`📋 Progrev ro‘yxati (🟢 ${active}/${messages.length} aktiv):`, {
          reply_markup: progrevListKeyboard(messages),
        });
      }
    } catch (err) {
      logger.error('Failed to list progrev messages', { err });
      await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: backKeyboard('admin:progrev') });
    }
    await ctx.answerCallbackQuery();
  }

  async function showProgrevItem(ctx: BotContext, id: string, viaEdit: boolean, scheduledInfo = ''): Promise<void> {
    try {
      const msg = await progrevRepository.getById(id);
      if (!msg) {
        await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
        return;
      }
      const text = progrevItemText(msg) + scheduledInfo;
      if (viaEdit) {
        await ctx.editMessageText(text, { reply_markup: progrevItemKeyboard(msg) });
      } else {
        await ctx.reply(text, { reply_markup: progrevItemKeyboard(msg) });
      }
    } catch (err) {
      logger.error('Failed to show progrev message', { id, err });
      if (viaEdit) {
        await ctx.editMessageText('❌ Ma’lumotni olib bo‘lmadi.', { reply_markup: backKeyboard('admin:progrev') });
      } else {
        await ctx.reply('❌ Ma’lumotni olib bo‘lmadi.');
      }
    }
    await ctx.answerCallbackQuery();
  }
}
