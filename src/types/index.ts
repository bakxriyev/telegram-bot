import type { Context } from 'grammy';

/**
 * Source guruhlar: atigi 2 ta.
 * - 'vsl' — barcha VSL linklar (vsl1..vsl10) uchun UMUMIY
 * - 'instagram' — Instagram linki uchun
 * Hamma VSL uchun bitta start xabar + bitta progrev zanjir bo'ladi.
 */
export type SourceType = 'vsl' | 'instagram' | string;

export const VALID_SOURCES: SourceType[] = ['vsl', 'instagram'];

export interface UserRow {
  id: string;
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  is_active: boolean;
  started_at: string;
  updated_at: string;
  created_at: string;
  source: SourceType | null;
}

export interface KeyboardButton {
  text: string;
  url: string;
  send_at?: string | null;
}

export interface StartMessageRow {
  id: string;
  name: string;
  channel_id: number;
  message_id: number;
  is_active: boolean;
  activated_at: string | null;
  keyboard_buttons: KeyboardButton[];
  caption_text: string | null;
  content_type: string | null;
  file_id: string | null;
  source: SourceType;
  created_at: string;
  updated_at: string;
}

export type BroadcastStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface BroadcastRow {
  id: string;
  channel_id: number;
  message_id: number;
  status: BroadcastStatus;
  total_users: number;
  success_count: number;
  failed_count: number;
  caption_text: string | null;
  content_type: string | null;
  file_id: string | null;
  keyboard_buttons: KeyboardButton[];
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  scheduled_at: string | null;
}

export type RecipientStatus = 'pending' | 'sent' | 'failed';

export interface BroadcastRecipientRow {
  id: string;
  broadcast_id: string;
  user_id: string;
  status: RecipientStatus;
  error_message: string | null;
  sent_at: string | null;
  created_at: string;
}

/**
 * Progrev (drip) xabar — /start bosgan har bir userga UNING start
 * vaqtidan nisbatan (kun/soat/daqiqa) keyin yuboriladigan post.
 */
export interface ProgrevMessageRow {
  id: string;
  name: string;
  channel_id: number;
  message_id: number;
  delay_days: number;
  delay_hours: number;
  delay_minutes: number;
  is_active: boolean;
  keyboard_buttons: KeyboardButton[];
  caption_text: string | null;
  content_type: string | null;
  file_id: string | null;
  source: SourceType;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
}

export type ProgrevSendStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

/** Bitta userga bitta progrev xabarni qachon yuborish rejasi. */
export interface ProgrevSendRow {
  id: string;
  progrev_id: string;
  user_id: string;
  status: ProgrevSendStatus;
  scheduled_at: string;
  sent_at: string | null;
  attempts: number;
  error_message: string | null;
  created_at: string;
}

export type ContentTypeName =
  | 'text'
  | 'photo'
  | 'video'
  | 'video_note'
  | 'audio'
  | 'document'
  | 'unsupported';

export interface PendingChannelMessage {
  channelId: number;
  messageId: number;
  text: string | null;
  fileId: string | null;
  hasPlaceholder: boolean;
  contentType: ContentTypeName;
}

/**
 * Deep-link (?start=...) ni 2 guruhga map qiladi:
 * vsl, vsl1..vsl10, VSL1... → 'vsl'
 * instagram → 'instagram'
 * Bo'sh/noma'lum → null (chaqiruvchi 'instagram' default qiladi)
 */
export function normalizeSource(raw: string | null | undefined): SourceType | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s === 'vsl' || s === 'instagram') return s as SourceType;
  // vsl1..vsl10 (va kelajakdagi vslN) — hammasi bitta VSL guruhi
  if (/^vsl\d*$/.test(s)) return 'vsl';
  return null;
}

export function sourceDisplayName(source: SourceType | null | undefined): string {
  if (!source) return '(nomaʼlum)';
  const s = String(source).toLowerCase().trim();
  if (s === 'vsl' || s.startsWith('vsl')) return 'VSL';
  if (s === 'instagram') return 'Instagram';
  return String(source);
}

export interface SessionData {
  step:
    | 'idle'
    | 'waiting_for_start_source'
    | 'waiting_for_start_message'
    | 'waiting_for_start_name'
    | 'waiting_for_start_keyboard_name'
    | 'waiting_for_start_keyboard_url'
    | 'waiting_for_start_rename_message'
    | 'waiting_for_start_rename_name'
    | 'waiting_for_start_source_edit'
    | 'waiting_for_broadcast_message'
    | 'waiting_for_broadcast_keyboard_name'
    | 'waiting_for_broadcast_keyboard_url'
    | 'waiting_for_broadcast_keyboard_ask'
    | 'waiting_for_broadcast_confirmation'
    | 'waiting_for_progrev_source'
    | 'waiting_for_progrev_message'
    | 'waiting_for_progrev_name'
    | 'waiting_for_progrev_delay_days'
    | 'waiting_for_progrev_delay_hours'
    | 'waiting_for_progrev_delay_minutes'
    | 'waiting_for_progrev_keyboard_ask'
    | 'waiting_for_progrev_keyboard_name'
    | 'waiting_for_progrev_keyboard_url'
    | 'waiting_for_progrev_edit_name'
    | 'waiting_for_progrev_edit_days'
    | 'waiting_for_progrev_edit_hours'
    | 'waiting_for_progrev_edit_minutes'
    | 'waiting_for_progrev_edit_message'
    | 'waiting_for_progrev_source_edit';
  pendingChannelMessage?: PendingChannelMessage;
  editingStartMessageId?: string;
  pendingBroadcastId?: string;
  pendingKeyboardButtons?: KeyboardButton[];
  pendingButtonName?: string;
  pendingProgrevId?: string;
  pendingProgrevName?: string;
  editingProgrevId?: string;
  pendingProgrevDelay?: { days: number; hours: number; minutes: number };
  pendingSource?: SourceType;
}

export type BotContext = Context;
