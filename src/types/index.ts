import type { Context } from 'grammy';

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

export interface SessionData {
  step:
    | 'idle'
    | 'waiting_for_start_message'
    | 'waiting_for_start_name'
    | 'waiting_for_start_keyboard_name'
    | 'waiting_for_start_keyboard_url'
    | 'waiting_for_start_rename_message'
    | 'waiting_for_start_rename_name'
    | 'waiting_for_broadcast_message'
    | 'waiting_for_broadcast_keyboard_name'
    | 'waiting_for_broadcast_keyboard_url'
    | 'waiting_for_broadcast_keyboard_ask'
    | 'waiting_for_broadcast_confirmation';
  pendingChannelMessage?: PendingChannelMessage;
  editingStartMessageId?: string;
  pendingBroadcastId?: string;
  pendingKeyboardButtons?: KeyboardButton[];
  pendingButtonName?: string;
}

export type BotContext = Context;
