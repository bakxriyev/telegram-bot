import { supabase } from '../supabase.js';
import { DatabaseError } from '../../utils/errors.js';

export interface HuzurLeadRow {
  id: number;
  created_at: string;
  full_name: string | null;
  phone_number: string | null;
  source: string | null;
}

export interface HuzurCounterRow {
  id: number;
  created_at: string;
  count: string | null;
}

export interface HuzurLeadDateSource {
  created_at: string;
  source: string | null;
}

const PAGE_SIZE = 1000;

/** Bo'sh/faqat probelli manbani null ga normallashtirish. */
function normalizeSource(value: string | null): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t ? t : null;
}

export const huzurRepository = {
  // ---------- LIDLAR (huzur1) ----------
  async countLeads(): Promise<number> {
    const { count, error } = await supabase
      .from('huzur1')
      .select('*', { count: 'exact', head: true });

    if (error) throw new DatabaseError('Failed to count huzur leads', error);
    return count ?? 0;
  },

  async countLeadsSince(iso: string): Promise<number> {
    const { count, error } = await supabase
      .from('huzur1')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', iso);

    if (error) throw new DatabaseError('Failed to count huzur leads since', error);
    return count ?? 0;
  },

  async listAllLeadDates(): Promise<string[]> {
    const dates: string[] = [];
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('huzur1')
        .select('created_at')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list huzur lead dates', error);
      const rows = (data as { created_at: string }[]) ?? [];
      if (rows.length === 0) break;
      for (const r of rows) dates.push(r.created_at);
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return dates;
  },

  /** Barcha lidlarning sanasi + manbasi (manba bo'yicha statistika uchun). */
  async listAllLeadDatesWithSource(): Promise<HuzurLeadDateSource[]> {
    const rows: HuzurLeadDateSource[] = [];
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('huzur1')
        .select('created_at, source')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list huzur lead dates with source', error);
      const page = (data as HuzurLeadDateSource[]) ?? [];
      if (page.length === 0) break;
      for (const r of page) rows.push({ created_at: r.created_at, source: normalizeSource(r.source) });
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return rows;
  },

  /** Jadvaldagi barcha farqli manba nomlari (tartiblangan, null eng oxirida). */
  async listDistinctSources(): Promise<Array<string | null>> {
    const set = new Set<string>();
    let hasUnknown = false;
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('huzur1')
        .select('source')
        .order('source', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list huzur sources', error);
      const page = (data as { source: string | null }[]) ?? [];
      if (page.length === 0) break;
      for (const r of page) {
        const s = normalizeSource(r.source);
        if (s == null) hasUnknown = true;
        else set.add(s);
      }
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    const list: Array<string | null> = [...set].sort((a, b) => a.localeCompare(b));
    if (hasUnknown) list.push(null);
    return list;
  },

  /** Bitta manba bo'yicha lidlar soni. */
  async countLeadsBySource(source: string | null): Promise<number> {
    const s = normalizeSource(source);
    let query = supabase.from('huzur1').select('*', { count: 'exact', head: true });
    query = s == null ? query.is('source', null) : query.eq('source', s);
    const { count, error } = await query;

    if (error) throw new DatabaseError('Failed to count huzur leads by source', error);
    return count ?? 0;
  },

  async listRecentLeads(limit = 10): Promise<HuzurLeadRow[]> {
    const { data, error } = await supabase
      .from('huzur1')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new DatabaseError('Failed to list recent huzur leads', error);
    return (data as HuzurLeadRow[]) ?? [];
  },

  async listLeadsPage(page: number, pageSize = 5): Promise<{ rows: HuzurLeadRow[]; total: number }> {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const [{ data, error }, total] = await Promise.all([
      supabase
        .from('huzur1')
        .select('*')
        .order('created_at', { ascending: false })
        .range(from, to),
      this.countLeads(),
    ]);

    if (error) throw new DatabaseError('Failed to list huzur leads page', error);
    return { rows: (data as HuzurLeadRow[]) ?? [], total };
  },

  async *iterateLeads(): AsyncGenerator<HuzurLeadRow[]> {
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('huzur1')
        .select('*')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to page through huzur leads', error);
      const rows = (data as HuzurLeadRow[]) ?? [];
      if (rows.length === 0) return;

      yield rows;
      if (rows.length < PAGE_SIZE) return;
      from += PAGE_SIZE;
    }
  },

  /** Faqat bitta manbaning lidlari (manba bo'yicha Excel uchun). */
  async *iterateLeadsBySource(source: string | null): AsyncGenerator<HuzurLeadRow[]> {
    const s = normalizeSource(source);
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from('huzur1')
        .select('*')
        .order('created_at', { ascending: true })
        .range(from, to);
      query = s == null ? query.is('source', null) : query.eq('source', s);
      const { data, error } = await query;

      if (error) throw new DatabaseError('Failed to page through huzur leads by source', error);
      const rows = (data as HuzurLeadRow[]) ?? [];
      if (rows.length === 0) return;

      yield rows;
      if (rows.length < PAGE_SIZE) return;
      from += PAGE_SIZE;
    }
  },

  // ---------- TASHRIFLAR (counter) ----------
  async listAllCounters(): Promise<HuzurCounterRow[]> {
    const rows: HuzurCounterRow[] = [];
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from('counter')
        .select('*')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list huzur counters', error);
      const page = (data as HuzurCounterRow[]) ?? [];
      if (page.length === 0) break;
      rows.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return rows;
  },
};
