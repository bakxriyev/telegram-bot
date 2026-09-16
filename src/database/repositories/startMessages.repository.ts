import { supabase } from '../supabase.js';
import { DatabaseError } from '../../utils/errors.js';
import type { StartMessageRow, KeyboardButton } from '../../types/index.js';

export const startMessagesRepository = {
  async create(input: {
    name: string;
    channel_id: number;
    message_id: number;
    activate: boolean;
    keyboard_buttons?: KeyboardButton[];
    caption_text?: string | null;
    content_type?: string | null;
    file_id?: string | null;
  }): Promise<StartMessageRow> {
    const { data, error } = await supabase
      .from('start_messages')
      .insert({
        name: input.name,
        channel_id: input.channel_id,
        message_id: input.message_id,
        is_active: false,
        keyboard_buttons: input.keyboard_buttons ?? [],
        caption_text: input.caption_text ?? null,
        content_type: input.content_type ?? null,
        file_id: input.file_id ?? null,
      })
      .select('*')
      .single();

    if (error) throw new DatabaseError('Failed to create start message', error);

    const row = data as StartMessageRow;
    if (input.activate) {
      await this.setActive(row.id, true);
      return { ...row, is_active: true, activated_at: new Date().toISOString() };
    }
    return row;
  },

  /**
   * Returns all start messages currently included in the /start sequence,
   * ordered by when each was turned on (oldest first) — i.e. the order in
   * which they will be delivered to a user pressing /start.
   */
  async listActiveOrdered(): Promise<StartMessageRow[]> {
    const { data, error } = await supabase
      .from('start_messages')
      .select('*')
      .eq('is_active', true)
      .order('activated_at', { ascending: true });

    if (error) throw new DatabaseError('Failed to fetch active start messages', error);
    return (data as StartMessageRow[]) ?? [];
  },

  async getActive(): Promise<StartMessageRow | null> {
    const { data, error } = await supabase
      .from('start_messages')
      .select('*')
      .eq('is_active', true)
      .order('activated_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) throw new DatabaseError('Failed to fetch active start message', error);
    return (data as StartMessageRow) ?? null;
  },

  async listAll(): Promise<StartMessageRow[]> {
    const { data, error } = await supabase
      .from('start_messages')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new DatabaseError('Failed to list start messages', error);
    return (data as StartMessageRow[]) ?? [];
  },

  async getById(id: string): Promise<StartMessageRow | null> {
    const { data, error } = await supabase
      .from('start_messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new DatabaseError(`Failed to fetch start message ${id}`, error);
    return (data as StartMessageRow) ?? null;
  },

  /**
   * Turns a start message on/off in the sequence. Turning one on sets
   * activated_at = now(), so re-toggling off then on again moves it to
   * the end of the delivery order — this is how admins "reorder" without
   * a dedicated drag-and-drop UI.
   */
  async setActive(id: string, active: boolean): Promise<void> {
    const { error } = await supabase.rpc('set_start_message_active', {
      p_id: id,
      p_active: active,
    });
    if (error) throw new DatabaseError(`Failed to set start message ${id} active=${active}`, error);
  },

  async updateMessageRef(
    id: string,
    channelId: number,
    messageId: number,
    extra?: { captionText?: string | null; contentType?: string | null; fileId?: string | null },
  ): Promise<void> {
    const { error } = await supabase
      .from('start_messages')
      .update({
        channel_id: channelId,
        message_id: messageId,
        ...(extra?.captionText !== undefined ? { caption_text: extra.captionText } : {}),
        ...(extra?.contentType !== undefined ? { content_type: extra.contentType } : {}),
        ...(extra?.fileId !== undefined ? { file_id: extra.fileId } : {}),
      })
      .eq('id', id);

    if (error) throw new DatabaseError(`Failed to update start message ${id}`, error);
  },

  async updateName(id: string, name: string): Promise<void> {
    const { error } = await supabase
      .from('start_messages')
      .update({ name })
      .eq('id', id);

    if (error) throw new DatabaseError(`Failed to rename start message ${id}`, error);
  },

  async updateKeyboardButtons(id: string, buttons: KeyboardButton[]): Promise<void> {
    const { error } = await supabase
      .from('start_messages')
      .update({ keyboard_buttons: buttons })
      .eq('id', id);

    if (error) throw new DatabaseError(`Failed to update start message ${id} keyboard`, error);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('start_messages').delete().eq('id', id);
    if (error) throw new DatabaseError(`Failed to delete start message ${id}`, error);
  },

  async count(): Promise<number> {
    const { count, error } = await supabase
      .from('start_messages')
      .select('*', { count: 'exact', head: true });

    if (error) throw new DatabaseError('Failed to count start messages', error);
    return count ?? 0;
  },
};