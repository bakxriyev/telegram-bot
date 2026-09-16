import { supabase } from '../supabase.js';
import { DatabaseError } from '../../utils/errors.js';

export interface HuzurLeadRow {
  id: number;
  created_at: string;
  full_name: string | null;
  phone_number: string | null;
}

export interface HuzurCounterRow {
  id: number;
  created_at: string;
  count: string | null;
}

const PAGE_SIZE = 1000;

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
