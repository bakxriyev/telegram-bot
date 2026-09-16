import { Bot } from 'grammy';
import { requireAdmin } from '../middleware/admin.middleware.js';
import { broadcastService } from '../services/broadcast.service.js';
import { broadcastsRepository } from '../database/repositories/broadcasts.repository.js';
import { broadcastMenuKeyboard, broadcastHistoryPagerKeyboard } from '../keyboards/broadcast.keyboard.js';
import { backKeyboard } from '../keyboards/admin.keyboard.js';
import { setAdminState, getAdminState, resetAdminState } from '../state/adminState.js';
import { detectContentType, extractCaptionOrText, extractFileId, copyToStorage } from '../services/telegram.service.js';
import { parseTashkentDateTime, formatTashkent } from '../utils/schedule.js';
import { env } from '../config/env.js';
import type { BotContext, SessionData, KeyboardButton } from '../types/index.js';
import { logger } from '../utils/logger.js';

const HISTORY_PAGE_SIZE = 5;

function formatBroadcastLine(b: {
  id: string;
  total_users: number;
  success_count: number;
  failed_count: number;
  created_at: string;
  status: string;
}): string {
  const date = new Date(b.created_at).toISOString().slice(0, 10);
  const shortId = b.id.slice(0, 8);
  return [
    `📢 Broadcast #${shortId}`,
    `👥 ${b.total_users}`,
    `✅ ${b.success_count}`,
    `❌ ${b.failed_count}`,
    `📅 ${date}`,
    `${statusIcon(b.status)} ${b.status}`,
  ].join('\n');
}

function statusIcon(status: string): string {
  switch (status) {
    case 'completed': return '🟢';
    case 'processing': return '🟡';
    case 'failed': return '🔴';
    case 'cancelled': return '⚪';
    default: return '⚪';
  }
}

export function registerBroadcastsHandler(bot: Bot<BotContext>): void {
  // === MENU ===
  bot.callbackQuery('admin:broadcast', requireAdmin, async (ctx) => {
    if (ctx.from) resetAdminState(ctx.from.id);
    await ctx.editMessageText('📢 Broadcast', { reply_markup: broadcastMenuKeyboard() });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:broadcast:add', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    setAdminState(ctx.from.id, { step: 'waiting_for_broadcast_message' });
    await ctx.editMessageText(
      '📩 Broadcast uchun xabarni botga yuboring yoki forward qiling.',
      { reply_markup: backKeyboard('admin:broadcast') },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:broadcast:list', requireAdmin, async (ctx) => {
    await sendHistoryPage(ctx, 0);
  });

  bot.callbackQuery(/^admin:broadcast:list:page:(\d+)$/, requireAdmin, async (ctx) => {
    await sendHistoryPage(ctx, Number(ctx.match[1]));
  });

  // === TASDIQLASH ===
  bot.callbackQuery('admin:broadcast:confirm:yes', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const state = getAdminState(ctx.from.id) as SessionData;
    const broadcastId = state.pendingBroadcastId;
    resetAdminState(ctx.from.id);
    if (!broadcastId) {
      await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
      return;
    }
    await ctx.editMessageText('🚀 Broadcast boshlandi...');
    await ctx.answerCallbackQuery();
    broadcastService.run(bot, broadcastId).then(async () => {
      const finished = await broadcastsRepository.getById(broadcastId);
      if (!finished || !ctx.from) return;
      await bot.api.sendMessage(ctx.from.id,
        `📢 Broadcast yakunlandi\n\n👥 Jami: ${finished.total_users}\n✅ Yuborildi: ${finished.success_count}\n❌ Xatolik: ${finished.failed_count}`);
    }).catch((err) => logger.error('Broadcast run crashed', { broadcastId, err }));
  });

  bot.callbackQuery('admin:broadcast:confirm:no', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const state = getAdminState(ctx.from.id) as SessionData;
    const broadcastId = state.pendingBroadcastId;
    resetAdminState(ctx.from.id);
    if (broadcastId) {
      await broadcastsRepository.updateStatus(broadcastId, 'cancelled', { finished_at: new Date().toISOString() });
    }
    await ctx.editMessageText('❌ Bekor qilindi.', { reply_markup: backKeyboard('admin:broadcast') });
    await ctx.answerCallbackQuery();
  });

  // === KEYBOARD ===
  bot.callbackQuery('admin:broadcast:kb:yes', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const state = getAdminState(ctx.from.id) as SessionData;
    setAdminState(ctx.from.id, {
      step: 'waiting_for_broadcast_keyboard_name',
      pendingBroadcastId: state.pendingBroadcastId,
      pendingKeyboardButtons: [],
    });
    await ctx.editMessageText('🔗 Tugma nomini kiriting (masalan: Kanalga obuna):');
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:broadcast:kb:no', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const state = getAdminState(ctx.from.id) as SessionData;
    if (!state.pendingBroadcastId) { await ctx.answerCallbackQuery(); return; }
    await showBroadcastConfirm(ctx, state.pendingBroadcastId, []);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery('admin:broadcast:kb:save', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const state = getAdminState(ctx.from.id) as SessionData;
    const buttons = state.pendingKeyboardButtons ?? [];
    const broadcastId = state.pendingBroadcastId;
    if (!broadcastId) { await ctx.answerCallbackQuery(); return; }

    if (buttons.length > 0) {
      await broadcastsRepository.updateKeyboardButtons(broadcastId, buttons);
    }
    await showBroadcastConfirm(ctx, broadcastId, buttons);
    await ctx.answerCallbackQuery();
  });

  // "Hozir jo'natish" tugmasi
  bot.callbackQuery('admin:broadcast:send:now', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const state = getAdminState(ctx.from.id) as SessionData;
    const broadcastId = state.pendingBroadcastId;
    resetAdminState(ctx.from.id);
    if (!broadcastId) {
      await ctx.answerCallbackQuery({ text: 'Topilmadi', show_alert: true });
      return;
    }
    await ctx.editMessageText('🚀 Broadcast boshlandi...');
    await ctx.answerCallbackQuery();
    broadcastService.run(bot, broadcastId).then(async () => {
      const finished = await broadcastsRepository.getById(broadcastId);
      if (!finished || !ctx.from) return;
      await bot.api.sendMessage(ctx.from.id,
        `📢 Broadcast yakunlandi\n\n👥 Jami: ${finished.total_users}\n✅ Yuborildi: ${finished.success_count}\n❌ Xatolik: ${finished.failed_count}`);
    }).catch((err) => logger.error('Broadcast run crashed', { broadcastId, err }));
  });

  // "Keyinroq" — vaqt so'rash
  bot.callbackQuery('admin:broadcast:send:later', requireAdmin, async (ctx) => {
    if (!ctx.from) return;
    const state = getAdminState(ctx.from.id) as SessionData;
    setAdminState(ctx.from.id, {
      ...state,
      step: 'waiting_for_broadcast_confirmation',
    });
    await ctx.editMessageText(
      '⏰ Qachon yuborish kerak?\n\n' +
      'Format: 14:00 yoki 2025-01-15 14:00\n' +
      '(O\'zbekiston vaqti bilan)',
    );
    await ctx.answerCallbackQuery();
  });

  // === FORWARD (kanaldan) ===
  bot.on(':forward_origin', requireAdmin, async (ctx, next) => {
    if (!ctx.from) return next();
    if (!ctx.message) return next();
    const state = getAdminState(ctx.from.id) as SessionData;

    if (state.step === 'waiting_for_broadcast_message') {
      const forward = ctx.message.forward_origin;
      if (!forward || forward.type !== 'channel') {
        await ctx.reply('❌ Iltimos, kanaldan forward qiling yoki xabarni to\'g\'ridan-to\'g\'ri yuboring.');
        return;
      }
      await handleBroadcastMessage(ctx, forward.chat.id, forward.message_id);
      return;
    }

    return next();
  });

  // === TO'G'RIDAN-TO'G'RI XABAR (forward emas) — storage kanalga nusxalanadi ===
  bot.on('message', requireAdmin, async (ctx, next) => {
    if (!ctx.from) return next();
    if (!ctx.message) return next();
    if (ctx.message.forward_origin) return next();
    // Komandalar boshqa handlerlarga tegishli
    const maybeText = (ctx.message as { text?: string }).text;
    if (maybeText?.startsWith('/')) return next();

    const state = getAdminState(ctx.from.id) as SessionData;
    if (state.step !== 'waiting_for_broadcast_message') return next();

    const contentType = detectContentType(ctx.message);
    if (contentType === 'unsupported') {
      await ctx.reply('❌ Bu turdagi xabarni qo\'llab-quvvatlamaymiz.');
      return;
    }

    try {
      const stored = await copyToStorage(bot, ctx.from.id, ctx.message.message_id, env.STORAGE_CHANNEL_ID);
      await handleBroadcastMessage(ctx, stored.channelId, stored.messageId);
    } catch (err) {
      logger.error('Failed to copy broadcast message to storage', { err });
      await ctx.reply(
        '❌ Xabarni saqlab bo\'lmadi. Bot storage kanalda admin ekanini tekshiring ' +
        'yoki xabarni kanaldan forward qiling.',
      );
    }
  });

  // === TEXT HANDLER (faqat broadcast) ===
  bot.on('message:text', requireAdmin, async (ctx, next) => {
    if (!ctx.from) return next();
    const state = getAdminState(ctx.from.id) as SessionData;
    const step = state.step as string;
    const text = ctx.message.text.trim();

    // Broadcast — keyboard nom kiritish
    if (step === 'waiting_for_broadcast_keyboard_name') {
      if (!text) {
        await ctx.reply('❌ Nom bo\'sh bo\'lishi mumkin emas.');
        return;
      }
      // "Tayyor" deb yozsa — tugatish
      if (text.toLowerCase() === 'tayyor') {
        const broadcastId = state.pendingBroadcastId;
        const buttons = state.pendingKeyboardButtons ?? [];
        if (!broadcastId) return next();
        if (buttons.length > 0) {
          await broadcastsRepository.updateKeyboardButtons(broadcastId, buttons);
        }
        await showBroadcastConfirm(ctx, broadcastId, buttons);
        return;
      }
      setAdminState(ctx.from.id, {
        step: 'waiting_for_broadcast_keyboard_url',
        pendingButtonName: text,
        pendingBroadcastId: state.pendingBroadcastId,
        pendingKeyboardButtons: state.pendingKeyboardButtons,
      });
      await ctx.reply(`✅ "${text}"\n\n🔗 URL linkni kiriting (https://...):`);
      return;
    }

    // Broadcast — keyboard URL kiritish
    if (step === 'waiting_for_broadcast_keyboard_url') {
      if (!text.startsWith('http://') && !text.startsWith('https://')) {
        await ctx.reply('❌ URL http:// yoki https:// bilan boshlanishi kerak.');
        return;
      }
      const buttonName = state.pendingButtonName ?? 'Link';
      const buttons = state.pendingKeyboardButtons ?? [];
      buttons.push({ text: buttonName, url: text });
      setAdminState(ctx.from.id, {
        step: 'waiting_for_broadcast_keyboard_name',
        pendingBroadcastId: state.pendingBroadcastId,
        pendingKeyboardButtons: buttons,
        pendingButtonName: undefined,
      });
      await ctx.reply(
        `✅ "${buttonName}" qo'shildi. Jami: ${buttons.length} ta tugma.\n\n` +
        'Yana tugma qo\'shing yoki "Tayyor" deb yozing.',
      );
      return;
    }

    // Broadcast — tasdiqlash (keyinroq uchun vaqt kiritish)
    if (step === 'waiting_for_broadcast_confirmation') {
      const broadcastId = state.pendingBroadcastId;
      if (!broadcastId) return next();

      const scheduledAt = parseTashkentDateTime(text);
      if (!scheduledAt) {
        await ctx.reply('❌ Noto\'g\'ri format. Masalan: 14:00 yoki 2025-01-15 14:00');
        return;
      }

      if (scheduledAt.getTime() <= Date.now()) {
        await ctx.reply('❌ Bu vaqt o\'tib ketgan. Kelajakdagi vaqt kiriting.');
        return;
      }

      try {
        await broadcastsRepository.schedule(broadcastId, scheduledAt.toISOString());
      } catch (err) {
        logger.error('Failed to schedule broadcast', { broadcastId, err });
        await ctx.reply('❌ Rejalab bo\'lmadi, texnik xatolik.');
        return;
      }

      resetAdminState(ctx.from.id);
      await ctx.reply(
        `✅ Broadcast rejalashtirildi: ${formatTashkent(scheduledAt)} (Toshkent vaqti).\n\n` +
        '⏰ Vaqti kelganda avtomatik yuboriladi. Bot o\'chiq bo\'lsa — yoqilganda yuboriladi.',
        { reply_markup: backKeyboard('admin:broadcast') },
      );
      return;
    }

    return next();
  });

  // === HELPER ===
  async function showBroadcastConfirm(ctx: BotContext, broadcastId: string, buttons: KeyboardButton[]) {
    const recipientsCount = await broadcastService.countEligibleRecipients();
    if (ctx.from) {
      resetAdminState(ctx.from.id);
      setAdminState(ctx.from.id, {
        step: 'waiting_for_broadcast_confirmation',
        pendingBroadcastId: broadcastId,
      });
    }
    const kbInfo = buttons.length > 0 ? `\n🔗 Tugmalar: ${buttons.length} ta` : '';
    const text =
      `📢 Broadcast tayyor${kbInfo}\n\n👥 Qabul qiluvchilar: ${recipientsCount}\n\nQachon jo'natamiz?`;
    const reply_markup = {
      inline_keyboard: [
        [{ text: '✅ Hozir jo\'natish', callback_data: 'admin:broadcast:send:now' }],
        [{ text: '⏰ Keyinroq', callback_data: 'admin:broadcast:send:later' }],
        [{ text: '❌ Bekor', callback_data: 'admin:broadcast:confirm:no' }],
      ],
    };
    // Callback ichidan bo'lsa — o'sha xabarni tahrirlaymiz,
    // oddiy matn ("Tayyor") dan bo'lsa — yangi xabar yuboramiz
    // (foydalanuvchi xabarini edit qilib bo'lmaydi).
    if (ctx.callbackQuery) {
      await ctx.editMessageText(text, { reply_markup });
    } else {
      await ctx.reply(text, { reply_markup });
    }
  }

  async function handleBroadcastMessage(ctx: { reply: Function; from?: { id: number }; message?: any }, channelId: number, messageId: number) {
    try {
      const msg = ctx.message!;
      const contentType = detectContentType(msg);
      const text = extractCaptionOrText(msg);
      const fileId = extractFileId(msg) ?? null;

      const draft = await broadcastService.createDraft({
        channelId,
        messageId,
        captionText: text,
        contentType,
        fileId,
      });

      setAdminState(ctx.from!.id, {
        step: 'waiting_for_broadcast_keyboard_ask',
        pendingBroadcastId: draft.id,
        pendingKeyboardButtons: [],
      });

      await ctx.reply('✅ Xabar qabul qilindi!');
      await ctx.reply('🔗 Inline keyboard qo\'shasizmi?', {
        reply_markup: {
          inline_keyboard: [
            [{ text: '✅ Ha', callback_data: 'admin:broadcast:kb:yes' }, { text: '❌ Yo\'q', callback_data: 'admin:broadcast:kb:no' }],
          ],
        },
      });
    } catch (err) {
      logger.error('Failed to handle broadcast message', { err });
      await ctx.reply('❌ Texnik xatolik yuz berdi.');
    }
  }

  async function sendHistoryPage(ctx: { editMessageText: Function; answerCallbackQuery: Function }, page: number) {
    const { rows, total } = await broadcastsRepository.listPage(page, HISTORY_PAGE_SIZE);
    const totalPages = Math.max(Math.ceil(total / HISTORY_PAGE_SIZE), 1);
    if (rows.length === 0) {
      await ctx.editMessageText('📋 Broadcastlar tarixi bo\'sh.', { reply_markup: backKeyboard('admin:broadcast') });
      await ctx.answerCallbackQuery();
      return;
    }
    const text = rows.map(formatBroadcastLine).join('\n\n');
    await ctx.editMessageText(`📋 Broadcast tarixi\n\n${text}`, {
      reply_markup: broadcastHistoryPagerKeyboard(page, totalPages),
    });
    await ctx.answerCallbackQuery();
  }
}
