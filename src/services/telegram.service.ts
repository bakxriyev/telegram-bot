import type { Bot, Api, RawApi } from 'grammy';
import { InlineKeyboard } from 'grammy';
import { GrammyError } from 'grammy';
import type { Message } from 'grammy/types';
import { isPermanentTelegramError } from '../utils/errors.js';
import { personalizeText } from '../utils/personalize.js';
import type { UserRow, ContentTypeName, KeyboardButton } from '../types/index.js';
import { logger } from '../utils/logger.js';

export type ContentType = ContentTypeName;

export function detectContentType(msg: Message): ContentType {
  if (msg.text) return 'text';
  if (msg.photo) return 'photo';
  if (msg.video) return 'video';
  if (msg.video_note) return 'video_note';
  if (msg.audio) return 'audio';
  if (msg.document) return 'document';
  return 'unsupported';
}

export function extractFileId(msg: Message): string | undefined {
  if (msg.photo && msg.photo.length > 0) return msg.photo[msg.photo.length - 1].file_id;
  if (msg.video) return msg.video.file_id;
  if (msg.video_note) return msg.video_note.file_id;
  if (msg.audio) return msg.audio.file_id;
  if (msg.document) return msg.document.file_id;
  return undefined;
}

export function extractCaptionOrText(msg: Message): string | null {
  return msg.text ?? msg.caption ?? null;
}

function buildInlineKeyboard(buttons: KeyboardButton[]): InlineKeyboard | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  const now = new Date();
  const activeButtons = buttons.filter((btn) => {
    if (!btn.send_at) return true;
    return new Date(btn.send_at) <= now;
  });
  if (activeButtons.length === 0) return undefined;
  const kb = new InlineKeyboard();
  for (const btn of activeButtons) {
    kb.url(btn.text, btn.url).row();
  }
  return kb;
}

interface DeliverParams {
  api: Api<RawApi>;
  toTelegramId: number;
  fromChannelId: number;
  fromMessageId: number;
  storageMessage?: Message;
  capturedCaption?: string | null;
  capturedContentType?: ContentType;
  capturedFileId?: string;
  capturedKeyboardButtons?: KeyboardButton[];
  user: UserRow;
}

export async function deliverStorageMessage(params: DeliverParams): Promise<void> {
  const {
    api,
    toTelegramId,
    fromChannelId,
    fromMessageId,
    storageMessage,
    capturedCaption,
    capturedContentType,
    capturedKeyboardButtons,
    user,
  } = params;

  const rawText = storageMessage ? extractCaptionOrText(storageMessage) : (capturedCaption ?? null);
  const hasPlaceholder = !!rawText && /\{name\}|\{username\}/.test(rawText);
  const keyboard = capturedKeyboardButtons ? buildInlineKeyboard(capturedKeyboardButtons) : undefined;

  // TEZ YO'L: placeholder yo'q → copyMessage
  if (!hasPlaceholder) {
    if (keyboard) {
      await api.copyMessage(toTelegramId, fromChannelId, fromMessageId, { reply_markup: keyboard });
    } else {
      await api.copyMessage(toTelegramId, fromChannelId, fromMessageId);
    }
    return;
  }

  // Placeholder bor → personalize qilish kerak
  const personalized = personalizeText(rawText, user);
  const type = storageMessage ? detectContentType(storageMessage) : (capturedContentType ?? 'unsupported');
  const fileId = storageMessage ? extractFileId(storageMessage) : params.capturedFileId;

  switch (type) {
    case 'text':
      await api.sendMessage(toTelegramId, personalized, { reply_markup: keyboard });
      return;
    case 'photo':
      if (!fileId) break;
      await api.sendPhoto(toTelegramId, fileId, { caption: personalized, reply_markup: keyboard });
      return;
    case 'video':
      if (!fileId) break;
      await api.sendVideo(toTelegramId, fileId, { caption: personalized, reply_markup: keyboard });
      return;
    case 'document':
      if (!fileId) break;
      await api.sendDocument(toTelegramId, fileId, { caption: personalized, reply_markup: keyboard });
      return;
    case 'audio':
      if (!fileId) break;
      await api.sendAudio(toTelegramId, fileId, { caption: personalized, reply_markup: keyboard });
      return;
    case 'video_note':
      if (!fileId) break;
      if (hasPlaceholder) {
        await api.sendMessage(toTelegramId, personalized);
      }
      await api.sendVideoNote(toTelegramId, fileId);
      return;
    default:
      break;
  }

  // Fallback
  if (keyboard) {
    await api.copyMessage(toTelegramId, fromChannelId, fromMessageId, { reply_markup: keyboard });
  } else {
    await api.copyMessage(toTelegramId, fromChannelId, fromMessageId);
  }
}

export interface SendOutcome {
  ok: boolean;
  permanent: boolean;
  errorMessage?: string;
  retryAfterSeconds?: number;
}

/**
 * Admin botga to'g'ridan-to'g'ri yuborgan xabarni storage kanalga
 * nusxalaydi. Qaytgan message_id keyin copyMessage orqali
 * foydalanuvchilarga yetkazishda ishlatiladi (forward shart emas).
 */
export async function copyToStorage(
  bot: Bot,
  fromChatId: number,
  fromMessageId: number,
  storageChannelId: number,
): Promise<{ channelId: number; messageId: number }> {
  const copied = await bot.api.copyMessage(storageChannelId, fromChatId, fromMessageId);
  return { channelId: storageChannelId, messageId: copied.message_id };
}
export async function safeDeliver(
  bot: Bot,
  args: Omit<DeliverParams, 'api'>,
): Promise<SendOutcome> {
  try {
    await deliverStorageMessage({ ...args, api: bot.api });
    return { ok: true, permanent: false };
  } catch (err) {
    if (err instanceof GrammyError) {
      const description = err.description;
      const permanent = isPermanentTelegramError(description);
      const retryAfterSeconds =
        err.error_code === 429
          ? ((err.parameters?.retry_after as number | undefined) ?? 1)
          : undefined;

      logger.warn('Delivery failed', {
        telegram_id: args.toTelegramId,
        description,
        permanent,
        retryAfterSeconds,
      });
      return { ok: false, permanent, errorMessage: description, retryAfterSeconds };
    }
    logger.error('Unexpected delivery error', {
      telegram_id: args.toTelegramId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, permanent: false, errorMessage: 'unknown error' };
  }
}
