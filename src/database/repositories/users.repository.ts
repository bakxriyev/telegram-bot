import { supabase } from '../supabase.js';
import { DatabaseError } from '../../utils/errors.js';
import type { UserRow, SourceType } from '../../types/index.js';

export interface UpsertUserInput {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
  source?: SourceType | null;
  /** undefined → eski qiymat saqlanadi; null → to'g'ridan-to'g'ri /start */
  startParam?: string | null;
}

const PAGE_SIZE = 500;

export const usersRepository = {
  /**
   * Insert-or-update by unique telegram_id. Never creates duplicate rows
   * for repeated /start presses by the same user.
   */
  async upsertByTelegramId(input: UpsertUserInput): Promise<UserRow> {
    const payload: Record<string, unknown> = {
      telegram_id: input.telegram_id,
      username: input.username,
      first_name: input.first_name,
      last_name: input.last_name,
      is_active: true,
    };
    // source === undefined bo'lsa — eski source saqlanadi (ustiga yozilmaydi).
    // /start dan kelganda har doim source beriladi, shuning uchun yangilanadi.
    if (input.source !== undefined) {
      payload.source = input.source;
    }
    if (input.startParam !== undefined) {
      payload.start_param = input.startParam;
    }
    const attempt = async (body: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from('users')
        .upsert(body, { onConflict: 'telegram_id' })
        .select('*')
        .single();
      return { data, error };
    };

    let res = await attempt(payload);
    // Migratsiya hali yurgizilmagan bo'lsa — yangi ustunlarsiz qayta urinamiz,
    // shunda /start hech qachon bazasiz qolib ketmaydi.
    if (res.error && res.error.message.includes('start_param')) {
      const { start_param: _drop1, ...withoutParam } = payload;
      void _drop1;
      res = await attempt(withoutParam);
    }
    if (res.error && res.error.message.includes('source')) {
      const { source: _drop2, start_param: _drop3, ...minimal } = payload;
      void _drop2;
      void _drop3;
      res = await attempt(minimal);
    }

    if (res.error) throw new DatabaseError(`Failed to upsert user ${input.telegram_id}`, res.error);
    return res.data as UserRow;
  },

  /**
   * Update user's source (used when existing user comes from a different source link)
   */
  async updateSource(userId: string, source: SourceType): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ source })
      .eq('id', userId);

    if (error) throw new DatabaseError(`Failed to update user ${userId} source`, error);
  },

  async findByTelegramId(telegramId: number): Promise<UserRow | null> {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error) throw new DatabaseError(`Failed to fetch user ${telegramId}`, error);
    return (data as UserRow) ?? null;
  },

  async countAll(): Promise<number> {
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

    if (error) throw new DatabaseError('Failed to count users', error);
    return count ?? 0;
  },

  async countActive(): Promise<number> {
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (error) throw new DatabaseError('Failed to count active users', error);
    return count ?? 0;
  },

  async countInactive(): Promise<number> {
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', false);

    if (error) throw new DatabaseError('Failed to count inactive users', error);
    return count ?? 0;
  },

  async setActive(userId: string, isActive: boolean): Promise<void> {
    const { error } = await supabase.from('users').update({ is_active: isActive }).eq('id', userId);
    if (error) throw new DatabaseError(`Failed to update user ${userId} active state`, error);
  },

  /** Barcha active userlarning ID larini qaytaradi (progrev schedule uchun). */
  async listAllActiveUserIds(): Promise<string[]> {
    const ids: string[] = [];
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list active user IDs', error);
      const rows = (data as { id: string }[]) ?? [];
      if (rows.length === 0) break;
      for (const r of rows) ids.push(r.id);
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return ids;
  },

  /** Barcha active userlarning ID, started_at va source larini qaytaradi (progrev schedule uchun). */
  async listAllActiveUsersForSchedule(): Promise<{ id: string; started_at: string; source: string | null }[]> {
    const rows: { id: string; started_at: string; source: string | null }[] = [];
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('users')
        .select('id, started_at, source')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list active users for schedule', error);
      const page = (data as { id: string; started_at: string; source: string | null }[]) ?? [];
      if (page.length === 0) break;
      for (const r of page) rows.push(r);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return rows;
  },

  /** Bir nechta userni bitta so'rovda aktiv/noaktiv qilish (broadcast tozalash uchun). */
  async setManyActive(userIds: string[], isActive: boolean): Promise<void> {
    if (userIds.length === 0) return;
    for (let i = 0; i < userIds.length; i += 200) {
      const chunk = userIds.slice(i, i + 200);
      const { error } = await supabase.from('users').update({ is_active: isActive }).in('id', chunk);
      if (error) throw new DatabaseError('Failed to bulk update users active state', error);
    }
  },

  /** Berilgan vaqtdan keyin qo'shilgan userlar soni (kunlik statistika uchun). */
  async countCreatedSince(iso: string): Promise<number> {
    const { count, error } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', iso);

    if (error) throw new DatabaseError('Failed to count users since', error);
    return count ?? 0;
  },

  /**
   * Statistika uchun: created_at + source + is_active ni sahifalab qaytaradi.
   * Source bo'yicha (VSL/Instagram) kunlik va umumiy hisoblash uchun.
   */
  async listAllForStats(): Promise<{ created_at: string; source: string | null; is_active: boolean; start_param: string | null }[]> {
    const rows: { created_at: string; source: string | null; is_active: boolean; start_param: string | null }[] = [];
    let from = 0;
    for (;;) {
      const to = from + 1000 - 1;
      const { data, error } = await supabase
        .from('users')
        .select('created_at, source, is_active, start_param')
        .order('created_at', { ascending: true })
        .range(from, to);

      // start_param ustuni hali qo'shilmagan bo'lsa (migratsiya yurgizilmagan) —
      // usiz davom etamiz, barchasi "noma'lum kirish" bo'lib hisoblanadi.
      if (error && error.message.includes('start_param')) {
        return this.listAllForStatsLegacy();
      }
      if (error) throw new DatabaseError('Failed to list users for stats', error);
      const page = (data as { created_at: string; source: string | null; is_active: boolean; start_param: string | null }[]) ?? [];
      if (page.length === 0) break;
      for (const r of page) rows.push(r);
      if (page.length < 1000) break;
      from += 1000;
    }
    return rows;
  },

  /** Migratsiyasiz eski baza uchun: start_param siz variant. */
  async listAllForStatsLegacy(): Promise<{ created_at: string; source: string | null; is_active: boolean; start_param: string | null }[]> {
    const rows: { created_at: string; source: string | null; is_active: boolean; start_param: string | null }[] = [];
    let from = 0;
    for (;;) {
      const to = from + 1000 - 1;
      const { data, error } = await supabase
        .from('users')
        .select('created_at, source, is_active')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list users for stats', error);
      const page = (data as { created_at: string; source: string | null; is_active: boolean }[]) ?? [];
      if (page.length === 0) break;
      for (const r of page) rows.push({ ...r, start_param: null });
      if (page.length < 1000) break;
      from += 1000;
    }
    return rows;
  },

  /** Faqat created_at ustunini sahifalab qaytaradi (kunlik guruhlash uchun). */
  async listAllCreatedAt(): Promise<string[]> {
    const dates: string[] = [];
    let from = 0;
    for (;;) {
      const to = from + 1000 - 1;
      const { data, error } = await supabase
        .from('users')
        .select('created_at')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list users created_at', error);
      const rows = (data as { created_at: string }[]) ?? [];
      if (rows.length === 0) break;
      for (const r of rows) dates.push(r.created_at);
      if (rows.length < 1000) break;
      from += 1000;
    }
    return dates;
  },

  /**
   * Barcha userlarni sahifalab oqim ko'rinishida qaytaradi
   * (Excel eksport uchun — xotirani to'ldirmaydi).
   */
  async *iterateAll(): AsyncGenerator<UserRow[]> {
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to page through all users', error);
      const rows = (data as UserRow[]) ?? [];
      if (rows.length === 0) return;

      yield rows;
      if (rows.length < PAGE_SIZE) return;
      from += PAGE_SIZE;
    }
  },

  /**
   * Streams all active users in fixed-size pages, so we never load the
   * whole table into memory at once (used for broadcast fan-out).
   */
  async *iterateActive(): AsyncGenerator<UserRow[]> {
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to page through active users', error);
      const rows = (data as UserRow[]) ?? [];
      if (rows.length === 0) return;

      yield rows;
      if (rows.length < PAGE_SIZE) return;
      from += PAGE_SIZE;
    }
  },

  /** Paginated listing for admin UI, e.g. future "list users" screens. */
  async listPage(page: number, pageSize = 20): Promise<{ rows: UserRow[]; total: number }> {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const [{ data, error }, total] = await Promise.all([
      supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to),
      this.countAll(),
    ]);

    if (error) throw new DatabaseError('Failed to list users page', error);
    return { rows: (data as UserRow[]) ?? [], total };
  },
};
