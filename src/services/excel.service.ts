import ExcelJS from 'exceljs';
import { formatTashkent } from '../utils/schedule.js';
import type { UserRow } from '../types/index.js';
import type { HuzurLeadRow } from '../database/repositories/huzur.repository.js';

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
  row.alignment = { vertical: 'middle' };
}

function autosizeColumns(sheet: ExcelJS.Worksheet, widths: number[]): void {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

/** Userlar jadvali — sarlavha yozilgan, qatorlar keyin qo'shiladi. */
export function createUsersWorkbook(): { workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet } {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Telegram Bot';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Userlar');
  sheet.columns = [
    { header: '№', key: 'n', width: 6 },
    { header: 'Telegram ID', key: 'telegram_id', width: 16 },
    { header: 'Username', key: 'username', width: 20 },
    { header: 'Ism', key: 'first_name', width: 20 },
    { header: 'Familiya', key: 'last_name', width: 20 },
    { header: 'Holat', key: 'status', width: 12 },
    { header: "Qo'shilgan (Toshkent)", key: 'started', width: 22 },
    { header: 'Yangilangan (Toshkent)', key: 'updated', width: 22 },
  ];
  styleHeader(sheet.getRow(1));
  autosizeColumns(sheet, [6, 16, 20, 20, 20, 12, 22, 22]);
  return { workbook, sheet };
}

export function addUserRow(sheet: ExcelJS.Worksheet, n: number, u: UserRow): void {
  sheet.addRow({
    n,
    telegram_id: u.telegram_id,
    username: u.username ? `@${u.username}` : '',
    first_name: u.first_name ?? '',
    last_name: u.last_name ?? '',
    status: u.is_active ? 'Aktiv' : 'Bloklagan',
    started: formatTashkent(u.started_at),
    updated: formatTashkent(u.updated_at),
  });
}

/** Lidlar jadvali. */
export function createLeadsWorkbook(): { workbook: ExcelJS.Workbook; sheet: ExcelJS.Worksheet } {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Telegram Bot';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Lidlar');
  sheet.columns = [
    { header: '№', key: 'n', width: 6 },
    { header: 'Sana (Toshkent)', key: 'date', width: 22 },
    { header: 'F.I.Sh', key: 'full_name', width: 30 },
    { header: 'Telefon', key: 'phone', width: 22 },
    { header: 'Manba', key: 'source', width: 20 },
  ];
  styleHeader(sheet.getRow(1));
  autosizeColumns(sheet, [6, 22, 30, 22, 20]);
  return { workbook, sheet };
}

export function addLeadRow(sheet: ExcelJS.Worksheet, n: number, lead: HuzurLeadRow): void {
  sheet.addRow({
    n,
    date: formatTashkent(lead.created_at),
    full_name: lead.full_name ?? '',
    phone: lead.phone_number ?? '',
    source: lead.source?.trim() ? lead.source.trim() : '',
  });
}

export async function workbookToBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
