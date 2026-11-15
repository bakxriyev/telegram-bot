import { supabase } from '../supabase.js';
import { DatabaseError } from '../../utils/errors.js';

export type IchkiKuchTarif = 'VIP' | 'Premium';

export interface IchkiKuchLeadRow {
  id: number;
  created_at: string;
  full_name: string;
  phone_number: string;
  tarif: IchkiKuchTarif;
  source: string | null;
}

export interface IchkiKuchLeadDateInfo {
  created_at: string;
  source: string | null;
  tarif: IchkiKuchTarif;
}

const PAGE_SIZE = 1000;
const TABLE = 'ichki_kuch_leads';

/** Bo'sh/faqat probelli manbani null ga normallashtirish. */
function normalizeSource(value: string | null): string | null {
  if (value == null) return null;
  const t = value.trim();
  return t ? t : null;
}

export const ichkiKuchRepository = {
  async countLeads(): Promise<number> {
    const { count, error } = await supabase.from(TABLE).select('*', { count: 'exact', head: true });

    if (error) throw new DatabaseError('Failed to count ichki kuch leads', error);
    return count ?? 0;
  },

  async countLeadsSince(iso: string): Promise<number> {
    const { count, error } = await supabase
      .from(TABLE)
      .select('*', { count: 'exact', head: true })
      .gte('created_at', iso);

    if (error) throw new DatabaseError('Failed to count ichki kuch leads since', error);
    return count ?? 0;
  },

  async listAllLeadDates(): Promise<string[]> {
    const dates: string[] = [];
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from(TABLE)
        .select('created_at')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list ichki kuch lead dates', error);
      const rows = (data as { created_at: string }[]) ?? [];
      if (rows.length === 0) break;
      for (const r of rows) dates.push(r.created_at);
      if (rows.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return dates;
  },

  /** Barcha lidlarning sanasi + manbasi + tarifi (statistika uchun). */
  async listAllLeadDatesWithSource(): Promise<IchkiKuchLeadDateInfo[]> {
    const rows: IchkiKuchLeadDateInfo[] = [];
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from(TABLE)
        .select('created_at, source, tarif')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list ichki kuch lead dates with source', error);
      const page = (data as IchkiKuchLeadDateInfo[]) ?? [];
      if (page.length === 0) break;
      for (const r of page) {
        rows.push({ created_at: r.created_at, source: normalizeSource(r.source), tarif: r.tarif });
      }
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
        .from(TABLE)
        .select('source')
        .order('source', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to list ichki kuch sources', error);
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
    let query = supabase.from(TABLE).select('*', { count: 'exact', head: true });
    query = s == null ? query.is('source', null) : query.eq('source', s);
    const { count, error } = await query;

    if (error) throw new DatabaseError('Failed to count ichki kuch leads by source', error);
    return count ?? 0;
  },

  async listRecentLeads(limit = 10): Promise<IchkiKuchLeadRow[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new DatabaseError('Failed to list recent ichki kuch leads', error);
    return (data as IchkiKuchLeadRow[]) ?? [];
  },

  async listLeadsPage(page: number, pageSize = 5): Promise<{ rows: IchkiKuchLeadRow[]; total: number }> {
    const from = page * pageSize;
    const to = from + pageSize - 1;

    const [{ data, error }, total] = await Promise.all([
      supabase.from(TABLE).select('*').order('created_at', { ascending: false }).range(from, to),
      this.countLeads(),
    ]);

    if (error) throw new DatabaseError('Failed to list ichki kuch leads page', error);
    return { rows: (data as IchkiKuchLeadRow[]) ?? [], total };
  },

  async *iterateLeads(): AsyncGenerator<IchkiKuchLeadRow[]> {
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) throw new DatabaseError('Failed to page through ichki kuch leads', error);
      const rows = (data as IchkiKuchLeadRow[]) ?? [];
      if (rows.length === 0) return;

      yield rows;
      if (rows.length < PAGE_SIZE) return;
      from += PAGE_SIZE;
    }
  },

  /** Faqat bitta manbaning lidlari (manba bo'yicha Excel uchun). */
  async *iterateLeadsBySource(source: string | null): AsyncGenerator<IchkiKuchLeadRow[]> {
    const s = normalizeSource(source);
    let from = 0;
    for (;;) {
      const to = from + PAGE_SIZE - 1;
      let query = supabase
        .from(TABLE)
        .select('*')
        .order('created_at', { ascending: true })
        .range(from, to);
      query = s == null ? query.is('source', null) : query.eq('source', s);
      const { data, error } = await query;

      if (error) throw new DatabaseError('Failed to page through ichki kuch leads by source', error);
      const rows = (data as IchkiKuchLeadRow[]) ?? [];
      if (rows.length === 0) return;

      yield rows;
      if (rows.length < PAGE_SIZE) return;
      from += PAGE_SIZE;
    }
  },
};
