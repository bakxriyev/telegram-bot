import { InlineKeyboard } from 'grammy';

export function broadcastMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Yangi broadcast', 'admin:broadcast:add')
    .row()
    .text('📋 Broadcast tarixi', 'admin:broadcast:list')
    .row()
    .text('⬅️ Orqaga', 'admin:back');
}

export function broadcastConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Yuborish', 'admin:broadcast:confirm:yes')
    .text('❌ Bekor qilish', 'admin:broadcast:confirm:no');
}

export function broadcastHistoryPagerKeyboard(page: number, totalPages: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (page > 0) kb.text('⬅️', `admin:broadcast:list:page:${page - 1}`);
  kb.text(`${page + 1}/${Math.max(totalPages, 1)}`, 'noop');
  if (page < totalPages - 1) kb.text('➡️', `admin:broadcast:list:page:${page + 1}`);
  kb.row().text('⬅️ Orqaga', 'admin:broadcast');
  return kb;
}
