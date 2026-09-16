import { Bot } from 'grammy';
import { env } from '../config/env.js';
import { detectContentType, extractCaptionOrText, extractFileId } from '../services/telegram.service.js';
import { startMessagesRepository } from '../database/repositories/startMessages.repository.js';
import { broadcastService } from '../services/broadcast.service.js';
import { getAdminState, setAdminState, findAdminsInStep } from '../state/adminState.js';
import type { BotContext, PendingChannelMessage } from '../types/index.js';
import { logger } from '../utils/logger.js';

export function registerStorageCaptureHandler(bot: Bot<BotContext>): void {
  bot.on('channel_post', async (ctx) => {
    const post = ctx.channelPost;
    if (!post) return;
    if (post.chat.id !== env.STORAGE_CHANNEL_ID) return; // ignore any other channel

    const contentType = detectContentType(post);
    if (contentType === 'unsupported') return;

    const text = extractCaptionOrText(post);
    const fileId = extractFileId(post) ?? null;
    const pending: PendingChannelMessage = {
      channelId: post.chat.id,
      messageId: post.message_id,
      text,
      fileId,
      hasPlaceholder: !!text && /\{name\}|\{username\}/.test(text),
      contentType,
    };

    // --- Start message: initial add flow ---
    for (const adminId of findAdminsInStep('waiting_for_start_message')) {
      setAdminState(adminId, { step: 'waiting_for_start_name', pendingChannelMessage: pending });
      await bot.api
        .sendMessage(adminId, '✅ Xabar qabul qilindi.\n\n✏️ Endi bu start xabar uchun nom kiriting (masalan: Asosiy start):')
        .catch((err) => logger.error('Failed to prompt admin for start name', { adminId, err }));
    }

    // --- Start message: replace content of an existing entry ---
    for (const adminId of findAdminsInStep('waiting_for_start_rename_message')) {
      const state = getAdminState(adminId);
      const id = state.editingStartMessageId;
      if (!id) continue;
      try {
        await startMessagesRepository.updateMessageRef(id, pending.channelId, pending.messageId, {
          captionText: pending.text,
          contentType: pending.contentType,
          fileId: pending.fileId,
        });
        const existing = await startMessagesRepository.getById(id);
        setAdminState(adminId, { step: 'waiting_for_start_rename_name', editingStartMessageId: id });
        await bot.api.sendMessage(
          adminId,
          '✅ Kontent yangilandi.\n\n' +
          `✏️ Yangi nom kiriting (hozirgi: "${existing?.name ?? ''}") ` +
          'yoki o\'zgartirmaslik uchun "skip" deb yozing:',
        );
      } catch (err) {
        logger.error('Failed to update start message content', { adminId, id, err });
        await bot.api.sendMessage(adminId, '❌ Texnik xatolik yuz berdi.');
      }
    }

    // --- Broadcast: message picked, create draft + show preview ---
    for (const adminId of findAdminsInStep('waiting_for_broadcast_message')) {
      try {
        const draft = await broadcastService.createDraft({
          channelId: pending.channelId,
          messageId: pending.messageId,
          captionText: pending.text,
          contentType: pending.contentType,
          fileId: pending.fileId,
        });

        setAdminState(adminId, {
          step: 'waiting_for_broadcast_keyboard_ask',
          pendingBroadcastId: draft.id,
          pendingKeyboardButtons: [],
        });

        await bot.api.copyMessage(adminId, pending.channelId, pending.messageId);
        await bot.api.sendMessage(adminId, '✅ Xabar qabul qilindi!');
        await bot.api.sendMessage(adminId, '🔗 Inline keyboard qo\'shasizmi?', {
          reply_markup: {
            inline_keyboard: [
              [{ text: '✅ Ha', callback_data: 'admin:broadcast:kb:yes' }, { text: '❌ Yo\'q', callback_data: 'admin:broadcast:kb:no' }],
            ],
          },
        });
      } catch (err) {
        logger.error('Failed to create broadcast draft', { adminId, err });
        await bot.api.sendMessage(adminId, '❌ Texnik xatolik yuz berdi.');
      }
    }
  });
}
