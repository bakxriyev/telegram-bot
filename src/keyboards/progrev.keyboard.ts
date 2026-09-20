import { InlineKeyboard } from 'grammy';
import { formatProgrevDelay } from '../services/progrev.service.js';
import type { KeyboardButton, ProgrevMessageRow, SourceType } from '../types/index.js';

export const SOURCES: SourceType[] = ['vsl', 'instagram'];

export function progrevMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Yangi progrev', 'admin:progrev:add')
    .row()
    .text('📋 Progrev ro‘yxati', 'admin:progrev:list')
    .row()
    .text('⬅️ Orqaga', 'admin:broadcast');
}

export function progrevListKeyboard(messages: ProgrevMessageRow[]): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const msg of messages) {
    const icon = msg.is_active ? '🟢' : '⚪';
    const delay = formatProgrevDelay(msg.delay_days, msg.delay_hours, msg.delay_minutes);
    kb.text(`${icon} ${msg.name} (${delay}) [${msg.source}]`, `admin:progrev:pick:${msg.id}`).row();
  }
  kb.text('⬅️ Orqaga', 'admin:progrev');
  return kb;
}

export function progrevItemKeyboard(msg: ProgrevMessageRow): InlineKeyboard {
  const kb = new InlineKeyboard()
    .text('👁 Ko‘rish', `admin:progrev:view:${msg.id}`)
    .row()
    .text('✏️ O‘zgartirish', `admin:progrev:edit:${msg.id}`)
    .row()
    .text(msg.is_active ? '⏸ O‘chirish' : '▶️ Yoqish', `admin:progrev:toggle:${msg.id}`)
    .row()
    .text('🗑 O‘chirish', `admin:progrev:delete:ask:${msg.id}`)
    .row()
    .text('⬅️ Ro‘yxat', 'admin:progrev:list');
  return kb;
}

export function progrevEditKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('📝 Nom', `admin:progrev:edit:name:${id}`)
    .row()
    .text('⏳ Interval', `admin:progrev:edit:delay:${id}`)
    .row()
    .text('📩 Kontent', `admin:progrev:edit:msg:${id}`)
    .row()
    .text('🔗 Tugmalar', `admin:progrev:edit:kb:${id}`)
    .row()
    .text('📋 Source', `admin:progrev:edit:source:${id}`)
    .row()
    .text('⬅️ Orqaga', `admin:progrev:pick:${id}`);
}

export function progrevDeleteConfirmKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Ha, o‘chirish', `admin:progrev:delete:yes:${id}`)
    .text('❌ Bekor', `admin:progrev:list`)
    .row()
    .text('⬅️ Ro‘yxat', 'admin:progrev:list');
}

export function progrevKbEditKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Qo‘shish', `admin:progrev:kb:add:${id}`)
    .text('🗑 Tozalash', `admin:progrev:kb:clear:${id}`)
    .row()
    .text('⬅️ Orqaga', `admin:progrev:edit:${id}`);
}

export function formatKbList(buttons: KeyboardButton[]): string {
  if (buttons.length === 0) return '—';
  return buttons.map((b, i) => `${i + 1}. ${b.text} → ${b.url}`).join('\n');
}

export function progrevKeyboardAskKeyboard(): {
  inline_keyboard: { text: string; callback_data: string }[][];
} {
  return {
    inline_keyboard: [
      [
        { text: '✅ Ha', callback_data: 'admin:progrev:kb:yes' },
        { text: '❌ Yo‘q', callback_data: 'admin:progrev:kb:no' },
      ],
    ],
  };
}

export function sourceSelectionKeyboard(prefix: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('🎬 VSL', `${prefix}:vsl`).row();
  kb.text('📸 Instagram', `${prefix}:instagram`).row();
  kb.text('⬅️ Orqaga', 'admin:progrev');
  return kb;
}

export function sourceDisplayName(source: SourceType | null | undefined): string {
  if (!source) return '(nomaʼlum)';
  const s = String(source).toLowerCase().trim();
  if (s.startsWith('vsl')) return 'VSL';
  if (s === 'instagram') return 'Instagram';
  return String(source);
}
