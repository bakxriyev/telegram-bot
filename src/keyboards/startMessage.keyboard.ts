import { InlineKeyboard } from 'grammy';
import type { StartMessageRow, SourceType } from '../types/index.js';

export const SOURCES: SourceType[] = ['vsl', 'instagram'];

export function startMessageMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Start xabar qo‘shish', 'admin:start:add')
    .row()
    .text('✏️ Start xabarni o‘zgartirish', 'admin:start:edit')
    .row()
    .text('📋 Start xabarlar / tartib', 'admin:start:list')
    .row()
    .text('🗑 O‘chirish', 'admin:start:delete')
    .row()
    .text('⬅️ Orqaga', 'admin:back');
}

export function startMessageListKeyboard(
  messages: StartMessageRow[],
  actionPrefix: string,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const msg of messages) {
    const icon = msg.is_active ? '🟢' : '⚪';
    kb.text(`${icon} ${msg.name} [${msg.source}]`, `${actionPrefix}:${msg.id}`).row();
  }
  kb.text('⬅️ Orqaga', 'admin:start');
  return kb;
}

/**
 * List with a toggle per row: tapping switches inclusion in the /start
 * sequence on/off. Turning one on moves it to the end of the delivery
 * order (see startMessages.repository.ts setActive). Numbered so admins
 * can see current send order at a glance.
 */
export function startMessageSequenceKeyboard(
  allMessages: StartMessageRow[],
  activeOrdered: StartMessageRow[],
): InlineKeyboard {
  const orderIndex = new Map(activeOrdered.map((m, i) => [m.id, i + 1]));
  const kb = new InlineKeyboard();
  for (const msg of allMessages) {
    const position = orderIndex.get(msg.id);
    const label = position
      ? `${position}️⃣ 🟢 ${msg.name} [${msg.source}]`
      : `⚪ ${msg.name} [${msg.source}]`;
    kb.text(label, `admin:start:toggle:${msg.id}`).row();
  }
  kb.text('⬅️ Orqaga', 'admin:start');
  return kb;
}

export function confirmActivateKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Ha', `admin:start:activate:yes:${id}`)
    .text('❌ Yo‘q', 'admin:start');
}

export function confirmDeleteKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Ha', `admin:start:delete:yes:${id}`)
    .text('❌ Yo‘q', 'admin:start');
}

export function confirmIncludeKeyboard(id: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Ha, qo‘shish', `admin:start:toggle:${id}`)
    .text('❌ Yo‘q', 'admin:start');
}

export function sourceSelectionKeyboard(prefix: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text('🎬 VSL', `${prefix}:vsl`).row();
  kb.text('📸 Instagram', `${prefix}:instagram`).row();
  kb.text('⬅️ Orqaga', 'admin:start');
  return kb;
}

export function sourceDisplayName(source: SourceType | null | undefined): string {
  if (!source) return '(nomaʼlum)';
  const s = String(source).toLowerCase().trim();
  if (s.startsWith('vsl')) return 'VSL';
  if (s === 'instagram') return 'Instagram';
  return String(source);
}