import type { Bot } from 'grammy';
import { startMessagesRepository } from '../database/repositories/startMessages.repository.js';
import type { UserRow, StartMessageRow, ContentTypeName, SourceType, KeyboardButton } from '../types/index.js';
import { deliverStorageMessage } from './telegram.service.js';
import { logger } from '../utils/logger.js';

/** Ketma-ket yuborishda xabarlar orasidagi pauza (tartib kafolati uchun). */
const SEND_GAP_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const startMessageService = {
  /**
   * Aktiv start xabarlarni KETMA-KETLIKDA yuboradi (activated_at tartibida).
   * Parallel yuborilsa Telegram tartibni kafolatlamaydi — shuning uchun
   * har birini await qilib, orasida kichik pauza bilan jo'natamiz.
   * Bitta xabar xato bersa ham qolganlari to'xtamaydi.
   */
  async deliverActiveStartMessage(bot: Bot, user: UserRow): Promise<void> {
    const source = user.source ?? 'instagram';
    const activeMessages = await startMessagesRepository.listActiveOrdered(source);

    if (activeMessages.length === 0) {
      await bot.api.sendMessage(
        user.telegram_id,
        '👋 Xush kelibsiz! Hozircha start xabar sozlanmagan, tez orada qaytadan urinib ko\'ring.',
      );
      return;
    }

    for (let i = 0; i < activeMessages.length; i++) {
      const msg = activeMessages[i];
      try {
        await startMessageService.deliverSingleMessage(bot, user, msg);
      } catch (err) {
        logger.error('Failed to deliver a start message', {
          telegram_id: user.telegram_id,
          start_message_id: msg.id,
          source,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      if (i < activeMessages.length - 1) await sleep(SEND_GAP_MS);
    }
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

  async create(input: {
    name: string;
    channel_id: number;
    message_id: number;
    activate: boolean;
    keyboard_buttons?: KeyboardButton[];
    caption_text?: string | null;
    content_type?: string | null;
    file_id?: string | null;
    source: SourceType;
  }): Promise<StartMessageRow> {
    return startMessagesRepository.create(input);
  },

  listAll: startMessagesRepository.listAll.bind(startMessagesRepository),
  listBySource: startMessagesRepository.listBySource.bind(startMessagesRepository),
  listActiveOrdered: startMessagesRepository.listActiveOrdered.bind(startMessagesRepository),
  getActive: startMessagesRepository.getActive.bind(startMessagesRepository),
  getById: startMessagesRepository.getById.bind(startMessagesRepository),
  setActive: startMessagesRepository.setActive.bind(startMessagesRepository),
  activate: (id: string) => startMessagesRepository.setActive(id, true),
  updateMessageRef: startMessagesRepository.updateMessageRef.bind(startMessagesRepository),
  updateKeyboardButtons: startMessagesRepository.updateKeyboardButtons.bind(startMessagesRepository),
  updateName: startMessagesRepository.updateName.bind(startMessagesRepository),
  updateSource: startMessagesRepository.updateSource.bind(startMessagesRepository),
  delete: startMessagesRepository.delete.bind(startMessagesRepository),
  count: startMessagesRepository.count.bind(startMessagesRepository),
};
