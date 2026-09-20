import { Bot, InlineKeyboard } from 'grammy';
import { startMessagesRepository } from '../database/repositories/startMessages.repository.js';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { startMessageService } from '../services/startMessage.service.js';
import { broadcastService } from '../services/broadcast.service.js';
import {
  startMessageMenuKeyboard,
  startMessageListKeyboard,
  confirmDeleteKeyboard,
  confirmActivateKeyboard,
  sourceSelectionKeyboard,
  SOURCES,
  sourceDisplayName,
} from '../keyboards/startMessage.keyboard.js';
import { backKeyboard } from '../keyboards/admin.keyboard.js';
import { getAdminState, setAdminState, resetAdminState } from '../state/adminState.js';
import { detectContentType, extractCaptionOrText, extractFileId, copyToStorage } from '../services/telegram.service.js';
import { env } from '../config/env.js';
import type { BotContext, SessionData, SourceType } from '../types/index.js';
import { normalizeSource } from '../types/index.js';
import { logger } from '../utils/logger.js';

function keyboardAskKeyboard(id: string) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ha', callback_data: `admin:start:kb:yes:${id}` },
        { text: '❌ Yo\'q', callback_data: `admin:start:kb:no:${id}` },
      ],
    ],
  };
}

export function registerStartMessagesHandler(bot: Bot<BotContext>): void {
  // === MENU ===
  bot.callbackQuery('admin:start', requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    try {
      const counts = await startMessagesRepository.countActiveBySource();
      const activeLine =
        counts.length === 0
          ? "🟢 Aktiv: yo'q"
          : '🟢 Aktiv (source bo‘yicha):\n' + counts.map((c) => `• ${sourceDisplayName(c.source)}: ${c.count} ta`).join('\n');
      await ctx.editMessageText(`🚀 Start xabar\n\n${activeLine}\n\n⚠️ Atigi 2 xil start xabar bo'ladi:\n🎬 VSL (hamma vsl linklar uchun bitta)\n📸 Instagram (alohida)`, {
        reply_markup: startMessageMenuKeyboard(),
      });
    } catch {
      await ctx.editMessageText(`🚀 Start xabar`, { reply_markup: startMessageMenuKeyboard() });
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:start:add', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    setAdminState(ctx.from.id, { step: 'waiting_for_start_source' });
    await ctx.editMessageText(
      '📋 Qaysi manba uchun start xabar yaratmoqchisiz?\n\n🎬 VSL (hamma vsl linklar uchun bitta) yoki 📸 Instagram:',
      { reply_markup: sourceSelectionKeyboard('admin:start:source') },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:source:(.+)$/, requireAdmin, async (ctx, next) => {
    // source:set:... edit callbacklari bilan to'qnashmasligi uchun
    if (ctx.match[1].startsWith('set:')) return next();
    if (!ctx.from) return;
    const source = ctx.match[1] as SourceType;
    if (!SOURCES.includes(source)) {
      await ctx.answerCallbackQuery({ text: 'Noto\'g\'ri manba', show_alert: true });
      return;
    }
    setAdminState(ctx.from.id, { step: 'waiting_for_start_message', pendingSource: source });
    await ctx.editMessageText(
      `✅ Manba tanlandi: ${sourceDisplayName(source)}\n\n📩 Botga start xabarni yuboring yoki forward qiling.`,
      { reply_markup: backKeyboard('admin:start') },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:start:list', requireAdmin, async (ctx) => {
    const messages = await startMessageService.listAll();
    if (messages.length === 0) {
      await ctx.editMessageText('📋 Start xabarlar mavjud emas.', { reply_markup: backKeyboard('admin:start') });
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.editMessageText('📋 Start xabarlar\n\nAktivlashtirish uchun birini tanlang:', {
      reply_markup: startMessageListKeyboard(messages, 'admin:start:activate:ask'),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:start:edit', requireAdmin, async (ctx) => {
    const messages = await startMessageService.listAll();
    if (messages.length === 0) {
      await ctx.editMessageText('✏️ Hozircha start xabarlar yo\'q.', { reply_markup: backKeyboard('admin:start') });
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.editMessageText('✏️ Qaysi start xabarni o\'zgartirmoqchisiz?', {
      reply_markup: startMessageListKeyboard(messages, 'admin:start:edit:pick'),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:edit:pick:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const id = ctx.match[1];
    const msg = await startMessageService.getById(id);
    if (!msg) {
      await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
      return;
    }
    setAdminState(ctx.from.id, { step: 'idle', editingStartMessageId: id });
    const kb = new InlineKeyboard()
      .text('📩 Kontent', `admin:start:edit:content:${id}`)
      .row()
      .text('📋 Source', `admin:start:edit:source:${id}`)
      .row()
      .text('⬅️ Orqaga', 'admin:start');
    await ctx.editMessageText(
      `✏️ "${msg.name}"\n📋 Hozirgi source: ${sourceDisplayName(msg.source)}\n\nNimani o‘zgartirasiz?`,
      { reply_markup: kb },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:edit:content:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    setAdminState(ctx.from.id, { step: 'waiting_for_start_rename_message', editingStartMessageId: ctx.match[1] });
    await ctx.editMessageText('📩 Yangi kontentni botga yuboring yoki forward qiling.', { reply_markup: backKeyboard('admin:start') });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:edit:source:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const id = ctx.match[1];
    setAdminState(ctx.from.id, { step: 'waiting_for_start_source_edit', editingStartMessageId: id });
    await ctx.editMessageText('📋 Yangi sourceni tanlang:', {
      reply_markup: sourceSelectionKeyboard(`admin:start:source:set:${id}`),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:source:set:(.+):(.+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    const source = normalizeSource(ctx.match[2]);
    if (!source) {
      await ctx.answerCallbackQuery({ text: 'Noto‘g‘ri manba', show_alert: true });
      return;
    }
    try {
      await startMessagesRepository.updateSource(id, source);
      if (ctx.from) resetAdminState(ctx.from.id);
      await ctx.editMessageText(`✅ Source yangilandi: ${sourceDisplayName(source)}`, {
        reply_markup: backKeyboard('admin:start'),
      });
    } catch (err) {
      logger.error('Failed to update start message source', { id, err });
      await ctx.answerCallbackQuery({ text: 'Xatolik', show_alert: true });
    }
  });

  bot.callbackQuery('admin:start:delete', requireAdmin, async (ctx) => {
    const messages = await startMessageService.listAll();
    if (messages.length === 0) {
      await ctx.editMessageText('🗑 Hozircha start xabarlar yo\'q.', { reply_markup: backKeyboard('admin:start') });
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.editMessageText('🗑 Qaysi start xabarni o\'chirmoqchisiz?', {
      reply_markup: startMessageListKeyboard(messages, 'admin:start:delete:pick'),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:delete:pick:(.+)$/, requireAdmin, async (ctx) => {
    const id = ctx.match[1];
    const msg = await startMessageService.getById(id);
    if (!msg) { await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true }); return; }
    if (msg.is_active) {
      await ctx.editMessageText('⚠️ Bu aktiv start xabar.\n\nO\'chirmoqchimisiz?', { reply_markup: confirmDeleteKeyboard(id) });
    } else {
      await startMessageService.delete(id);
      await ctx.editMessageText('✅ O\'chirildi.', { reply_markup: backKeyboard('admin:start') });
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:delete:yes:(.+)$/, requireAdmin, async (ctx) => {
    await startMessageService.delete(ctx.match[1]);
    await ctx.editMessageText('✅ O\'chirildi.', { reply_markup: backKeyboard('admin:start') });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:activate:ask:(.+)$/, requireAdmin, async (ctx) => {
    await ctx.editMessageText('Ushbu xabarni aktiv qilmoqchimisiz?', {
      reply_markup: confirmActivateKeyboard(ctx.match[1]),
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:activate:yes:(.+)$/, requireAdmin, async (ctx) => {
    await startMessageService.activate(ctx.match[1]);
    await ctx.editMessageText('✅ Aktivlashtirildi.', { reply_markup: backKeyboard('admin:start') });
    await ctx.answerCallbackQuery();
  });

  // === KEYBOARD ASK ===
  bot.callbackQuery(/^admin:start:kb:yes:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const id = ctx.match[1];
    setAdminState(ctx.from.id, {
      step: 'waiting_for_start_keyboard_name',
      editingStartMessageId: id,
      pendingKeyboardButtons: [],
    });
    await ctx.editMessageText('🔗 Tugma nomini kiriting (masalan: Kanalga obuna):');
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^admin:start:kb:no:(.+)$/, requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const id = ctx.match[1];
    resetAdminState(ctx.from.id);
    await ctx.editMessageText(
      '✅ Start xabar tayyor (keyboard olmadan)!\n\nUni hozir aktivlashtirasizmi?',
      { reply_markup: confirmActivateKeyboard(id) },
    );
    await ctx.answerCallbackQuery();
  });

  // === FORWARD (kanaldan) ===
  bot.on(':forward_origin', requireAdmin, async (ctx, next) => {
    if (!ctx.from) return next();
    if (!ctx.message) return next();
    const state = getAdminState(ctx.from.id) as SessionData & { pendingSource?: SourceType };
    const forward = ctx.message.forward_origin;
    if (!forward || forward.type !== 'channel') return next();

    if (state.step === 'waiting_for_start_message') {
      await acceptNewContent(ctx, forward.chat.id, forward.message_id, state.pendingSource);
      return;
    }

    if (state.step === 'waiting_for_start_rename_message' && state.editingStartMessageId) {
      await acceptEditedContent(ctx, state.editingStartMessageId, forward.chat.id, forward.message_id);
      return;
    }

    return next();
  });

  // === TO'G'RIDAN-TO'G'RI XABAR (forward emas) — storage kanalga nusxalanadi ===
  bot.on('message', requireAdmin, async (ctx, next) => {
    if (!ctx.from) return next();
    if (!ctx.message) return next();
    if (ctx.message.forward_origin) return next();
    const maybeText = (ctx.message as { text?: string }).text;
    if (maybeText?.startsWith('/')) return next();

    const state = getAdminState(ctx.from.id) as SessionData & { pendingSource?: SourceType };
    if (state.step !== 'waiting_for_start_message' && state.step !== 'waiting_for_start_rename_message') return next();

    const contentType = detectContentType(ctx.message);
    if (contentType === 'unsupported') {
      await ctx.reply('❌ Bu turdagi xabarni qo\'llab-quvvatlamaymiz.');
      return;
    }

    try {
      const stored = await copyToStorage(bot, ctx.from.id, ctx.message.message_id, env.STORAGE_CHANNEL_ID);
      if (state.step === 'waiting_for_start_message') {
        await acceptNewContent(ctx, stored.channelId, stored.messageId, state.pendingSource);
      } else if (state.editingStartMessageId) {
        await acceptEditedContent(ctx, state.editingStartMessageId, stored.channelId, stored.messageId);
      }
    } catch (err) {
      logger.error('Failed to copy start message to storage', { err });
      await ctx.reply(
        '❌ Xabarni saqlab bo\'lmadi. Bot storage kanalda admin ekanini tekshiring ' +
        'yoki xabarni kanaldan forward qiling.',
      );
    }
  });

  // === TEXT HANDLER ===
  bot.on('message:text', requireAdmin, async (ctx, next) => {
    if (!ctx.from) return next();
    const state = getAdminState(ctx.from.id) as SessionData & { pendingSource?: SourceType };
    const step = state.step as string;
    const text = ctx.message.text.trim();

    // Yangi start xabar — manba tanlangandan keyin nom kiritish
    if (step === 'waiting_for_start_name' && state.pendingChannelMessage) {
      if (!text) { await ctx.reply('❌ Nom bo\'sh bo\'lishi mumkin emas.'); return; }
      try {
        const pending = state.pendingChannelMessage;
        const src = normalizeSource(state.pendingSource) ?? 'instagram';
        const created = await broadcastService.createStartMessageWithKeyboard(
          text, pending.channelId, pending.messageId,
          { captionText: pending.text, contentType: pending.contentType, fileId: pending.fileId },
          src,
        );
        setAdminState(ctx.from.id, {
          step: 'idle',
          editingStartMessageId: created.id,
          pendingKeyboardButtons: [],
        });
        await ctx.reply(`✅ "${text}" yaratildi! (Manba: ${sourceDisplayName(src)})\n\n🔗 Inline keyboard qo'shasizmi?`, {
          reply_markup: keyboardAskKeyboard(created.id),
        });
      } catch (err) {
        logger.error('Failed to create start message', { err });
        await ctx.reply('❌ Xatolik yuz berdi.');
      }
      return;
    }

    // Mavjud start xabar — nomni o'zgartirish (skip = o'zgarishsiz)
    if (step === 'waiting_for_start_rename_name' && state.editingStartMessageId) {
      const id = state.editingStartMessageId;
      try {
        if (text.toLowerCase() !== 'skip' && text.length > 0) {
          await startMessagesRepository.updateName(id, text);
          await ctx.reply(`✅ Nom yangilandi: "${text}"`);
        }
        setAdminState(ctx.from.id, { step: 'idle', editingStartMessageId: id, pendingKeyboardButtons: [] });
        const existing = await startMessageService.getById(id);
        const kbCount = existing?.keyboard_buttons?.length ?? 0;
        const kbLine = kbCount > 0 ? `\n(Hozir ${kbCount} ta tugma bor — yangilari eskisini almashtiradi)` : '';
        await ctx.reply(`🔗 Inline keyboardni o'zgartirasizmi?${kbLine}`, {
          reply_markup: keyboardAskKeyboard(id),
        });
      } catch (err) {
        logger.error('Failed to rename start message', { err });
        await ctx.reply('❌ Xatolik yuz berdi.');
      }
      return;
    }

    // Keyboard — tugma nomi ("Tayyor" = tugatish)
    if (step === 'waiting_for_start_keyboard_name') {
      if (!text) { await ctx.reply('❌ Nom bo\'sh bo\'lishi mumkin emas.'); return; }
      if (text.toLowerCase() === 'tayyor') {
        const id = state.editingStartMessageId;
        const buttons = state.pendingKeyboardButtons ?? [];
        try {
          if (id && buttons.length > 0) {
            await startMessageService.updateKeyboardButtons(id, buttons);
          }
        } catch (err) {
          logger.error('Failed to save start message keyboard', { err });
          await ctx.reply('❌ Tugmalarni saqlab bo\'lmadi.');
          return;
        }
        resetAdminState(ctx.from.id);
        if (id) {
          const kbInfo = buttons.length > 0 ? `\n🔗 Tugmalar: ${buttons.length} ta` : '';
          await ctx.reply(`✅ Start xabar tayyor${kbInfo}!\n\nUni hozir aktivlashtirasizmi?`, {
            reply_markup: confirmActivateKeyboard(id),
          });
        }
        return;
      }
      setAdminState(ctx.from.id, {
        step: 'waiting_for_start_keyboard_url',
        pendingButtonName: text,
        editingStartMessageId: state.editingStartMessageId,
        pendingKeyboardButtons: state.pendingKeyboardButtons,
      });
      await ctx.reply(`✅ "${text}"\n\n🔗 URL linkni kiriting (https://...):`);
      return;
    }

    // Keyboard — URL
    if (step === 'waiting_for_start_keyboard_url') {
      if (!text.startsWith('http://') && !text.startsWith('https://')) {
        await ctx.reply('❌ URL http:// yoki https:// bilan boshlanishi kerak.');
        return;
      }
      const buttonName = state.pendingButtonName ?? 'Link';
      const buttons = state.pendingKeyboardButtons ?? [];
      buttons.push({ text: buttonName, url: text });
      setAdminState(ctx.from.id, {
        step: 'waiting_for_start_keyboard_name',
        editingStartMessageId: state.editingStartMessageId,
        pendingKeyboardButtons: buttons,
        pendingButtonName: undefined,
      });
      await ctx.reply(
        `✅ "${buttonName}" qo'shildi. Jami: ${buttons.length} ta tugma.\n\n` +
        'Yana tugma qo\'shing yoki "Tayyor" deb yozing.',
      );
      return;
    }

    return next();
  });

  // === HELPERS ===
  async function acceptNewContent(
    ctx: { reply: Function; from?: { id: number }; message?: any },
    channelId: number,
    messageId: number,
    source?: SourceType,
  ) {
    const msg = ctx.message!;
    const contentType = detectContentType(msg);
    const text = extractCaptionOrText(msg);
    const fileId = extractFileId(msg) ?? null;
    setAdminState(ctx.from!.id, {
      step: 'waiting_for_start_name',
      pendingChannelMessage: {
        channelId,
        messageId,
        text,
        fileId,
        hasPlaceholder: !!text && /\{name\}|\{username\}/.test(text),
        contentType,
      },
      pendingSource: source,
    });
    await ctx.reply('✅ Xabar qabul qilindi.\n\n✏️ Start xabar nomini kiriting:');
  }

  async function acceptEditedContent(
    ctx: { reply: Function; from?: { id: number }; message?: any },
    id: string,
    channelId: number,
    messageId: number,
  ) {
    const msg = ctx.message!;
    const contentType = detectContentType(msg);
    const text = extractCaptionOrText(msg);
    const fileId = extractFileId(msg) ?? null;
    try {
      await startMessagesRepository.updateMessageRef(id, channelId, messageId, {
        captionText: text,
        contentType,
        fileId,
      });
      const existing = await startMessageService.getById(id);
      setAdminState(ctx.from!.id, { step: 'waiting_for_start_rename_name', editingStartMessageId: id });
      await ctx.reply(
        '✅ Kontent yangilandi.\n\n' +
        `✏️ Yangi nom kiriting (hozirgi: "${existing?.name ?? ''}") ` +
        'yoki o\'zgartirmaslik uchun "skip" deb yozing:',
      );
    } catch (err) {
      logger.error('Failed to update start message', { err });
      await ctx.reply('❌ Xatolik yuz berdi.');
    }
  }
}
