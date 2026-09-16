import { supabase } from '../supabase.js';
import { DatabaseError } from '../../utils/errors.js';
import type { BroadcastRow, BroadcastStatus, RecipientStatus, KeyboardButton } from '../../types/index.js';

export const broadcastsRepository = {
  async create(input: {
    channel_id: number;
    message_id: number;
    caption_text?: string | null;
    content_type?: string | null;
    file_id?: string | null;
  }): Promise<BroadcastRow> {
    const { data, error } = await supabase
      .from('broadcasts')
      .insert({
        channel_id: input.channel_id,
        message_id: input.message_id,
        caption_text: input.caption_text ?? null,
        content_type: input.content_type ?? null,
        file_id: input.file_id ?? null,
        status: 'pending',
      })
      .select('*')
      .single();

    if (error) throw new DatabaseError('Failed to create broadcast', error);
    return data as BroadcastRow;
  },

  async getById(id: string): Promise<BroadcastRow | null> {
    const { data, error } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new DatabaseError(`Failed to fetch broadcast ${id}`, error);
    return (data as BroadcastRow) ?? null;
  },

  async updateStatus(
    id: string,
    status: BroadcastStatus,
    extra: Partial<Pick<BroadcastRow, 'started_at' | 'finished_at' | 'total_users'>> = {},
  ): Promise<void> {
    const { error } = await supabase
      .from('broadcasts')
      .update({ status, ...extra })
      .eq('id', id);

    if (error) throw new DatabaseError(`Failed to update broadcast ${id} status`, error);
  },

  /** Atomic increment via Postgres function — safe under concurrent batches. */
  async incrementCounters(id: string, success: number, failed: number): Promise<void> {
    const { error } = await supabase.rpc('increment_broadcast_counters', {
      p_id: id,
      p_success: success,
      p_failed: failed,
    });
    if (error) throw new DatabaseError(`Failed to increment counters for broadcast ${id}`, error);
  },

  async count(): Promise<number> {
    const { count, error } = await supabase
      .from('broadcasts')
      .select('*', { count: 'exact', head: true });

    if (error) throw new DatabaseError('Failed to count broadcasts', error);
    return count ?? 0;
  },

  async listPage(page: number, pageSize = 10): Promise<{ rows: BroadcastRow[]; total: number }> {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const [{ data, error }, total] = await Promise.all([
      supabase.from('broadcasts').select('*').order('created_at', { ascending: false }).range(from, to),
      this.count(),
    ]);

    if (error) throw new DatabaseError('Failed to list broadcasts page', error);
    return { rows: (data as BroadcastRow[]) ?? [], total };
  },

  async updateKeyboardButtons(id: string, buttons: KeyboardButton[]): Promise<void> {
    const { error } = await supabase
      .from('broadcasts')
      .update({ keyboard_buttons: buttons })
      .eq('id', id);
    if (error) throw new DatabaseError(`Failed to update broadcast ${id} keyboard`, error);
  },

  /** Rejalashtirish: broadcast shu vaqtda avtomatik yuboriladi. */
  async schedule(id: string, scheduledAt: string): Promise<void> {
    const { error } = await supabase
      .from('broadcasts')
      .update({ scheduled_at: scheduledAt })
      .eq('id', id);
    if (error) throw new DatabaseError(`Failed to schedule broadcast ${id}`, error);
  },

  /** Vaqti kelgan, hali yuborilmagan rejalashtirilgan broadcastlar. */
  async listDueScheduled(limit = 10): Promise<BroadcastRow[]> {
    const { data, error } = await supabase
      .from('broadcasts')
      .select('*')
      .eq('status', 'pending')
      .not('scheduled_at', 'is', null)
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(limit);

    if (error) throw new DatabaseError('Failed to fetch due scheduled broadcasts', error);
    return (data as BroadcastRow[]) ?? [];
  },
};

export const broadcastRecipientsRepository = {
  async bulkInsertPending(broadcastId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;
    const rows = userIds.map((userId) => ({
      broadcast_id: broadcastId,
      user_id: userId,
      status: 'pending' as RecipientStatus,
    }));

    const { error } = await supabase.from('broadcast_recipients').insert(rows);
    if (error) throw new DatabaseError(`Failed to insert recipients for broadcast ${broadcastId}`, error);
  },

  async markResult(
    broadcastId: string,
    userId: string,
    status: RecipientStatus,
    errorMessage?: string,
  ): Promise<void> {
    const { error } = await supabase
      .from('broadcast_recipients')
      .update({
        status,
        error_message: errorMessage ?? null,
        sent_at: status === 'sent' ? new Date().toISOString() : null,
      })
      .eq('broadcast_id', broadcastId)
      .eq('user_id', userId);

    if (error) {
      throw new DatabaseError(
        `Failed to mark recipient result for broadcast ${broadcastId}, user ${userId}`,
        error,
      );
    }
  },

  /**
   * Bitta batch natijalarini 1-2 ta so'rovda yozadi (10k+ userda tezlik uchun).
   * Xatolik xabarlari har xil bo'lishi mumkin — shuning uchun failed'lar
   * bir xil xabar bo'yicha guruhlab yoziladi.
   */
  async markManyResults(
    broadcastId: string,
    sentUserIds: string[],
    failedGroups: { errorMessage?: string; userIds: string[] }[],
  ): Promise<void> {
    const now = new Date().toISOString();

    if (sentUserIds.length > 0) {
      for (const chunk of chunkIds(sentUserIds)) {
        const { error } = await supabase
          .from('broadcast_recipients')
          .update({ status: 'sent', error_message: null, sent_at: now })
          .eq('broadcast_id', broadcastId)
          .in('user_id', chunk);
        if (error) throw new DatabaseError(`Failed to mark sent recipients for broadcast ${broadcastId}`, error);
      }
    }

    for (const group of failedGroups) {
      if (group.userIds.length === 0) continue;
      for (const chunk of chunkIds(group.userIds)) {
        const { error } = await supabase
          .from('broadcast_recipients')
          .update({ status: 'failed', error_message: group.errorMessage ?? null, sent_at: null })
          .eq('broadcast_id', broadcastId)
          .in('user_id', chunk);
        if (error) throw new DatabaseError(`Failed to mark failed recipients for broadcast ${broadcastId}`, error);
      }
    }
  },
};

function chunkIds(ids: string[], size = 200): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) chunks.push(ids.slice(i, i + size));
  return chunks;
}
