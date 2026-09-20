import { supabase } from '../supabase.js';
import { DatabaseError } from '../../utils/errors.js';
import type { StartMessageRow, KeyboardButton, SourceType } from '../../types/index.js';

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
    source: SourceType;
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
        source: input.source,
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
   * Returns all start messages currently included in the /start sequence for a specific source,
   * ordered by when each was turned on (oldest first) — i.e. the order in
   * which they will be delivered to a user pressing /start.
   * source berilmasa — barcha sourcelar (admin ko'rinishi uchun).
   */
  async listActiveOrdered(source?: SourceType): Promise<StartMessageRow[]> {
    let q = supabase.from('start_messages').select('*').eq('is_active', true);
    if (source) q = q.eq('source', source);
    const { data, error } = await q.order('activated_at', { ascending: true });

    if (error) throw new DatabaseError('Failed to fetch active start messages', error);
    return (data as StartMessageRow[]) ?? [];
  },

  async getActive(source?: SourceType): Promise<StartMessageRow | null> {
    let q = supabase.from('start_messages').select('*').eq('is_active', true);
    if (source) q = q.eq('source', source);
    const { data, error } = await q.order('activated_at', { ascending: true }).limit(1).maybeSingle();

    if (error) throw new DatabaseError('Failed to fetch active start message', error);
    return (data as StartMessageRow) ?? null;
  },

  async countActiveBySource(): Promise<{ source: string; count: number }[]> {
    const { data, error } = await supabase.from('start_messages').select('source').eq('is_active', true);
    if (error) throw new DatabaseError('Failed to count active start messages', error);
    const map = new Map<string, number>();
    for (const r of (data as { source: string }[]) ?? []) {
      map.set(r.source, (map.get(r.source) ?? 0) + 1);
    }
    return [...map.entries()].map(([source, count]) => ({ source, count }));
  },

  async listAll(): Promise<StartMessageRow[]> {
    const { data, error } = await supabase
      .from('start_messages')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw new DatabaseError('Failed to list start messages', error);
    return (data as StartMessageRow[]) ?? [];
  },

  async listBySource(source: SourceType): Promise<StartMessageRow[]> {
    const { data, error } = await supabase
      .from('start_messages')
      .select('*')
      .eq('source', source)
      .order('created_at', { ascending: false });

    if (error) throw new DatabaseError('Failed to list start messages by source', error);
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

  async updateSource(id: string, source: SourceType): Promise<void> {
    const { error } = await supabase.from('start_messages').update({ source }).eq('id', id);
    if (error) throw new DatabaseError(`Failed to update start message ${id} source`, error);
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