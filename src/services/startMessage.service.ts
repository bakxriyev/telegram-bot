import type { Bot } from 'grammy';
import { startMessagesRepository } from '../database/repositories/startMessages.repository.js';
import type { UserRow, StartMessageRow, ContentTypeName } from '../types/index.js';
import { deliverStorageMessage } from './telegram.service.js';
import { logger } from '../utils/logger.js';

export const startMessageService = {
  async deliverActiveStartMessage(bot: Bot, user: UserRow): Promise<void> {
    const activeMessages = await startMessagesRepository.listActiveOrdered();

    if (activeMessages.length === 0) {
      await bot.api.sendMessage(
        user.telegram_id,
        '👋 Xush kelibsiz! Hozircha start xabar sozlanmagan, tez orada qaytadan urinib ko\'ring.',
      );
      return;
    }

    const deliveries = activeMessages.map((msg) =>
      startMessageService.deliverSingleMessage(bot, user, msg).catch((err) => {
        logger.error('Failed to deliver a start message', {
          telegram_id: user.telegram_id,
          start_message_id: msg.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }),
    );
    await Promise.allSettled(deliveries);
  },

  async deliverSingleMessage(bot: Bot, user: UserRow, msg: StartMessageRow): Promise<void> {
    // deliverStorageMessage ham {name}/{username} personalizatsiyasini,
    // ham inline keyboard'ni, ham tez copyMessage yo'lini o'zi hal qiladi.
    await deliverStorageMessage({
      api: bot.api,
      toTelegramId: user.telegram_id,
      fromChannelId: msg.channel_id,
      fromMessageId: msg.message_id,
      capturedCaption: msg.caption_text,
      capturedContentType: (msg.content_type ?? undefined) as ContentTypeName | undefined,
      capturedFileId: msg.file_id ?? undefined,
      capturedKeyboardButtons: msg.keyboard_buttons,
      user,
    });
  },

  createAndOptionallyActivate: startMessagesRepository.create.bind(startMessagesRepository),
  listAll: startMessagesRepository.listAll.bind(startMessagesRepository),
  listActiveOrdered: startMessagesRepository.listActiveOrdered.bind(startMessagesRepository),
  getActive: startMessagesRepository.getActive.bind(startMessagesRepository),
  getById: startMessagesRepository.getById.bind(startMessagesRepository),
  setActive: startMessagesRepository.setActive.bind(startMessagesRepository),
  activate: (id: string) => startMessagesRepository.setActive(id, true),
  updateMessageRef: startMessagesRepository.updateMessageRef.bind(startMessagesRepository),
  updateKeyboardButtons: startMessagesRepository.updateKeyboardButtons.bind(startMessagesRepository),
  delete: startMessagesRepository.delete.bind(startMessagesRepository),
  count: startMessagesRepository.count.bind(startMessagesRepository),
};
