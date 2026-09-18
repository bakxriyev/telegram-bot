/** O'zbekiston (Toshkent, UTC+5, DST yo'q) vaqti bilan ishlash. */

const TASHKENT_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * "14:00" yoki "2025-01-15 14:00" formatidagi matnni Toshkent vaqti
 * sifatida o'qib UTC Date ga aylantiradi. Noto'g'ri format/sana → null.
 */
export function parseTashkentDateTime(text: string): Date | null {
  const full = text.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  const short = text.match(/^(\d{2}):(\d{2})$/);

  let y: number;
  let mo: number;
  let d: number;
  let h: number;
  let mi: number;

  if (full) {
    y = Number(full[1]);
    mo = Number(full[2]);
    d = Number(full[3]);
    h = Number(full[4]);
    mi = Number(full[5]);
  } else if (short) {
    // Bugungi sana — Toshkent bo'yicha
    const tashNow = new Date(Date.now() + TASHKENT_OFFSET_MS);
    y = tashNow.getUTCFullYear();
    mo = tashNow.getUTCMonth() + 1;
    d = tashNow.getUTCDate();
    h = Number(short[1]);
    mi = Number(short[2]);
  } else {
    return null;
  }

  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;

  const utcMs = Date.UTC(y, mo - 1, d, h, mi) - TASHKENT_OFFSET_MS;

  // 30-fevral kabi mavjud bo'lmagan sanalarni ushlash
  const check = new Date(utcMs + TASHKENT_OFFSET_MS);
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    check.getUTCHours() !== h ||
    check.getUTCMinutes() !== mi
  ) {
    return null;
  }

  return new Date(utcMs);
}

/** UTC Date ni Toshkent vaqti ko'rinishida formatlaydi. */
export function formatTashkent(date: Date | string): string {
  return new Intl.DateTimeFormat('uz-UZ', {
    timeZone: 'Asia/Tashkent',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

/** Sana uchun Toshkent bo'yicha "YYYY-MM-DD" kun kaliti (kunlik statistika uchun). */
export function tashkentDateKey(date: Date | string): string {
  const tash = new Date(new Date(date).getTime() + TASHKENT_OFFSET_MS);
  const y = tash.getUTCFullYear();
  const mo = String(tash.getUTCMonth() + 1).padStart(2, '0');
  const d = String(tash.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${d}`;
}

/** Berilgan kundan N kun oldingi Toshkent kun kalitlari (bugun + oldingi kunlar). */
export function lastTashkentDateKeys(n: number): string[] {
  const keys: string[] = [];
  const todayMs = Date.now() + TASHKENT_OFFSET_MS;
  for (let i = 0; i < n; i++) {
    const t = new Date(todayMs - i * 24 * 60 * 60 * 1000);
    const y = t.getUTCFullYear();
    const mo = String(t.getUTCMonth() + 1).padStart(2, '0');
    const d = String(t.getUTCDate()).padStart(2, '0');
    keys.push(`${y}-${mo}-${d}`);
  }
  return keys;
}

/**
 * Progrev jimjitlik vaqti (Toshkent vaqti bilan).
 * 22:00 dan 08:00 gacha progrev xabar yuborilmaydi —
 * to'planganlari 08:00 bo'lishi bilan ketadi.
 */
export const QUIET_HOURS_START = 22;
export const QUIET_HOURS_END = 8;

/** Berilgan paytdagi Toshkent soati (0–23). */
export function tashkentHour(date: Date | string | number = new Date()): number {
  const tash = new Date(new Date(date).getTime() + TASHKENT_OFFSET_MS);
  return tash.getUTCHours();
}

/** Hozir jimjitlik vaqti ichidami (22:00–08:00)? */
export function isTashkentQuietHours(date: Date | string | number = new Date()): boolean {
  const h = tashkentHour(date);
  return h >= QUIET_HOURS_START || h < QUIET_HOURS_END;
}

/**
 * Berilgan `nowMs` ni o'z ichiga olgan Toshkent kunining 08:00 ni
 * UTC millisekund sifatida qaytaradi.
 * Masalan now = 2026-01-02 15:00 (Toshkent) → 2026-01-02 08:00 (Toshkent) ning UTC ms.
 */
export function tashkentMorning8Ms(nowMs: number = Date.now()): number {
  const tashNow = new Date(nowMs + TASHKENT_OFFSET_MS);
  const y = tashNow.getUTCFullYear();
  const mo = tashNow.getUTCMonth();
  const d = tashNow.getUTCDate();
  return Date.UTC(y, mo, d, QUIET_HOURS_END, 0) - TASHKENT_OFFSET_MS;
}

/**
 * Agar `ms` jimjitlik ichida bo'lsa (22:00–08:00 Toshkent),
 * uni keyingi 08:00 ga suradi. Kunduzi (08:00–22:00) bo'lsa — o'zgarishsiz qaytaradi.
 * - 00:00–08:00 → shu kun 08:00
 * - 22:00–24:00 → ertangi kun 08:00
 */
export function skipTashkentQuietForward(ms: number): number {
  if (!isTashkentQuietHours(ms)) return ms;
  const morning8 = tashkentMorning8Ms(ms);
  if (ms < morning8) return morning8;
  return morning8 + 24 * 60 * 60 * 1000;
}
