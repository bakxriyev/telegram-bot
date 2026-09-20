import { supabase } from '../supabase.js';
import { DatabaseError } from '../../utils/errors.js';
import type { KeyboardButton, ProgrevMessageRow, ProgrevSendRow, SourceType } from '../../types/index.js';

export interface ProgrevDueSend extends ProgrevSendRow {
  progrev: ProgrevMessageRow;
  user: {
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
  };
}

const PAGE_SIZE = 500;

export const progrevRepository = {
  // ---------- PROGREV MESSAGES ----------
  async create(input: {
    name: string;
    channel_id: number;
    message_id: number;
    delay_days: number;
    delay_hours: number;
    delay_minutes: number;
    keyboard_buttons?: KeyboardButton[];
    caption_text?: string | null;
    content_type?: string | null;
    file_id?: string | null;
    source: SourceType;
  }): Promise<ProgrevMessageRow> {
    const { data, error } = await supabase
      .from('progrev_messages')
      .insert({
        name: input.name,
        channel_id: input.channel_id,
        message_id: input.message_id,
        delay_days: input.delay_days,
        delay_hours: input.delay_hours,
        delay_minutes: input.delay_minutes,
        is_active: true,
        keyboard_buttons: input.keyboard_buttons ?? [],
        caption_text: input.caption_text ?? null,
        content_type: input.content_type ?? null,
        file_id: input.file_id ?? null,
        source: input.source,
      })
      .select('*')
      .single();

    if (error) throw new DatabaseError('Failed to create progrev message', error);
    return data as ProgrevMessageRow;
  },

  /** Hammasi — eng kichik delay birinchida (ro'yxat tartibi uchun). */
  async listAll(): Promise<ProgrevMessageRow[]> {
    const { data, error } = await supabase
      .from('progrev_messages')
      .select('*')
      .order('delay_days', { ascending: true })
      .order('delay_hours', { ascending: true })
      .order('delay_minutes', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw new DatabaseError('Failed to list progrev messages', error);
    return (data as ProgrevMessageRow[]) ?? [];
  },

  async listActive(): Promise<ProgrevMessageRow[]> {
    const { data, error } = await supabase
      .from('progrev_messages')
      .select('*')
      .eq('is_active', true)
      .order('delay_days', { ascending: true })
      .order('delay_hours', { ascending: true })
      .order('delay_minutes', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw new DatabaseError('Failed to list active progrev messages', error);
    return (data as ProgrevMessageRow[]) ?? [];
  },

  async listActiveBySource(source: SourceType): Promise<ProgrevMessageRow[]> {
    const { data, error } = await supabase
      .from('progrev_messages')
      .select('*')
      .eq('is_active', true)
      .eq('source', source)
      .order('delay_days', { ascending: true })
      .order('delay_hours', { ascending: true })
      .order('delay_minutes', { ascending: true })
      .order('created_at', { ascending: true });

    if (error) throw new DatabaseError('Failed to list active progrev messages by source', error);
    return (data as ProgrevMessageRow[]) ?? [];
  },

  async listBySource(source: SourceType): Promise<ProgrevMessageRow[]> {
    const { data, error } = await supabase
      .from('progrev_messages')
      .select('*')
      .eq('source', source)
      .order('created_at', { ascending: false });

    if (error) throw new DatabaseError('Failed to list progrev messages by source', error);
    return (data as ProgrevMessageRow[]) ?? [];
  },

  async getById(id: string): Promise<ProgrevMessageRow | null> {
    const { data, error } = await supabase
      .from('progrev_messages')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) throw new DatabaseError(`Failed to fetch progrev message ${id}`, error);
    return (data as ProgrevMessageRow) ?? null;
  },

  async setActive(id: string, active: boolean): Promise<void> {
    const { error } = await supabase.from('progrev_messages').update({ is_active: active }).eq('id', id);
    if (error) throw new DatabaseError(`Failed to set progrev message ${id} active=${active}`, error);
  },

  async updateKeyboardButtons(id: string, buttons: KeyboardButton[]): Promise<void> {
    const { error } = await supabase
      .from('progrev_messages')
      .update({ keyboard_buttons: buttons })
      .eq('id', id);

    if (error) throw new DatabaseError(`Failed to update progrev message ${id} keyboard`, error);
  },

  async updateDelay(id: string, delay: { days: number; hours: number; minutes: number }): Promise<void> {
    const { error } = await supabase
      .from('progrev_messages')
      .update({ delay_days: delay.days, delay_hours: delay.hours, delay_minutes: delay.minutes })
      .eq('id', id);

    if (error) throw new DatabaseError(`Failed to update progrev message ${id} delay`, error);
  },

  async updateName(id: string, name: string): Promise<void> {
    const { error } = await supabase.from('progrev_messages').update({ name }).eq('id', id);

    if (error) throw new DatabaseError(`Failed to rename progrev message ${id}`, error);
  },

  async updateSource(id: string, source: SourceType): Promise<void> {
    const { error } = await supabase.from('progrev_messages').update({ source }).eq('id', id);
    if (error) throw new DatabaseError(`Failed to update progrev ${id} source`, error);
  },

  async updateContent(
    id: string,
    content: {
      channel_id: number;
      message_id: number;
      caption_text?: string | null;
      content_type?: string | null;
      file_id?: string | null;
    },
  ): Promise<void> {
    const { error } = await supabase
      .from('progrev_messages')
      .update({
        channel_id: content.channel_id,
        message_id: content.message_id,
        caption_text: content.caption_text ?? null,
        content_type: content.content_type ?? null,
        file_id: content.file_id ?? null,
      })
      .eq('id', id);

    if (error) throw new DatabaseError(`Failed to update progrev message ${id} content`, error);
  },

  /**
   * Interval o'zgarganda barcha kutilayotgan rejalarni siljitish
   * (bitta atomar RPC — yuborilganlarga tegilmaydi).
   * Qaytaradi: siljitilgan qatorlar soni.
   */
  async shiftPendingSchedule(progrevId: string, deltaMs: number): Promise<number> {
    const { data, error } = await supabase.rpc('shift_progrev_pending_schedule', {
      p_progrev_id: progrevId,
      p_delta_ms: Math.trunc(deltaMs),
    });

    if (error) throw new DatabaseError(`Failed to shift pending sends for progrev ${progrevId}`, error);
    return (data as number) ?? 0;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from('progrev_messages').delete().eq('id', id);
    if (error) throw new DatabaseError(`Failed to delete progrev message ${id}`, error);
  },

  async incrementCounters(id: string, sent: number, failed: number): Promise<void> {
    if (sent === 0 && failed === 0) return;
    // RPC yo'q — kichik hajmda read-modify-write yetadi (har bir send bitta marta).
    const current = await this.getById(id);
    if (!current) return;
    const { error } = await supabase
      .from('progrev_messages')
      .update({
        sent_count: (current.sent_count ?? 0) + sent,
        failed_count: (current.failed_count ?? 0) + failed,
      })
      .eq('id', id);
    if (error) throw new DatabaseError(`Failed to update progrev message ${id} counters`, error);
  },

  // ---------- PROGREV SENDS ----------
  /** Userning barcha rejalari (qayta /start da dublikat yaratmaslik uchun). */
  async listSendsByUser(userId: string): Promise<ProgrevSendRow[]> {
    const { data, error } = await supabase.from('progrev_sends').select('*').eq('user_id', userId);

    if (error) throw new DatabaseError(`Failed to list progrev sends for user ${userId}`, error);
    return (data as ProgrevSendRow[]) ?? [];
  },

  /** Bitta progrev uchun barcha send'lar (yangi progrev schedule uchun). */
  async listSendsByProgrev(progrevId: string): Promise<ProgrevSendRow[]> {
    const { data, error } = await supabase.from('progrev_sends').select('*').eq('progrev_id', progrevId);

    if (error) throw new DatabaseError(`Failed to list progrev sends for progrev ${progrevId}`, error);
    return (data as ProgrevSendRow[]) ?? [];
  },

  async insertSend(input: { progrev_id: string; user_id: string; scheduled_at: string }): Promise<void> {
    const { error } = await supabase.from('progrev_sends').insert({
      progrev_id: input.progrev_id,
      user_id: input.user_id,
      status: 'pending',
      scheduled_at: input.scheduled_at,
    });

    if (error) throw new DatabaseError('Failed to insert progrev send', error);
  },

  /** Qayta /start da kutilayotgan rejani yangi anchor'ga ko'chirish. */
  async rescheduleSend(sendId: string, scheduledAt: string): Promise<void> {
    const { error } = await supabase
      .from('progrev_sends')
      .update({ scheduled_at: scheduledAt, attempts: 0, error_message: null })
      .eq('id', sendId)
      .eq('status', 'pending');

    if (error) throw new DatabaseError(`Failed to reschedule progrev send ${sendId}`, error);
  },

  /**
   * Vaqti kelgan pending'lar — progrev xabar + user bilan birga.
   * Scheduler har tick'da chaqiradi.
   */
  async listDueSends(limit = 50): Promise<ProgrevDueSend[]> {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from('progrev_sends')
      .select('*, progrev:progrev_messages!inner(*), user:users!inner(*)')
      .eq('status', 'pending')
      .lte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(limit);

    if (error) throw new DatabaseError('Failed to list due progrev sends', error);
    return (data as ProgrevDueSend[]) ?? [];
  },

  async markSent(sendId: string): Promise<void> {
    const { error } = await supabase
      .from('progrev_sends')
      .update({ status: 'sent', sent_at: new Date().toISOString(), error_message: null })
      .eq('id', sendId);

    if (error) throw new DatabaseError(`Failed to mark progrev send ${sendId} sent`, error);
  },

  /** Vaqtinchalik xatolik — N marta keyinroq qayta urinish, keyin failed. */
  async markRetryOrFailed(sendId: string, attempts: number, errorMessage: string, retryAtIso: string): Promise<void> {
    const { error } = await supabase
      .from('progrev_sends')
      .update({ attempts, error_message: errorMessage, scheduled_at: retryAtIso })
      .eq('id', sendId);

    if (error) throw new DatabaseError(`Failed to update progrev send ${sendId} retry`, error);
  },

  async markFailed(sendId: string, errorMessage: string): Promise<void> {
    const { error } = await supabase
      .from('progrev_sends')
      .update({ status: 'failed', error_message: errorMessage })
      .eq('id', sendId);

    if (error) throw new DatabaseError(`Failed to mark progrev send ${sendId} failed`, error);
  },

  async markCancelled(sendId: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from('progrev_sends')
      .update({ status: 'cancelled', error_message: reason })
      .eq('id', sendId);

    if (error) throw new DatabaseError(`Failed to cancel progrev send ${sendId}`, error);
  },

  async countPending(): Promise<number> {
    const { count, error } = await supabase
      .from('progrev_sends')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    if (error) throw new DatabaseError('Failed to count pending progrev sends', error);
    return count ?? 0;
  },

  /** Bitta progrev xabarning barcha pending rejalarini bekor qilish (o'chirishda). */
  async cancelPendingByProgrev(progrevId: string): Promise<void> {
    const { error } = await supabase
      .from('progrev_sends')
      .update({ status: 'cancelled', error_message: 'progrev deleted' })
      .eq('progrev_id', progrevId)
      .eq('status', 'pending');

    if (error) throw new DatabaseError(`Failed to cancel pending sends for progrev ${progrevId}`, error);
  },

  /**
   * User boshqa source bilan qayta /start bosganda — eski source dan qolgan
   * kutilayotgan rejalarni bekor qilish, aralashib ketmasligi uchun.
   * keepProgrevIds — hozirgi source zanjiridagilar, ular tegilmaydi.
   */
  async cancelPendingByUserExcept(userId: string, keepProgrevIds: string[]): Promise<number> {
    let q = supabase.from('progrev_sends').select('id').eq('user_id', userId).eq('status', 'pending');
    // Supabase .not('progrev_id','in',...) bo'sh arrayda xato beradi — shuning uchun alohida.
    if (keepProgrevIds.length > 0) {
      q = q.not('progrev_id', 'in', `(${keepProgrevIds.map((id) => `"${id}"`).join(',')})`);
    }
    const { data, error } = await q;
    if (error) throw new DatabaseError(`Failed to list stale pending sends for user ${userId}`, error);
    const ids = ((data as { id: string }[]) ?? []).map((r) => r.id);
    if (ids.length === 0) return 0;
    const { error: updErr } = await supabase
      .from('progrev_sends')
      .update({ status: 'cancelled', error_message: 'source changed' })
      .in('id', ids);
    if (updErr) throw new DatabaseError(`Failed to cancel stale sends for user ${userId}`, updErr);
    return ids.length;
  },

  async *iterateAllSends(): AsyncGenerator<ProgrevSendRow[]> {
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('progrev_sends')
        .select('*')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to page through progrev sends', error);
      const rows = (data as ProgrevSendRow[]) ?? [];
      if (rows.length === 0) return;

      yield rows;
      if (rows.length < PAGE_SIZE) return;
      from += PAGE_SIZE;
    }
  },
};
