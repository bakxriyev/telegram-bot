import { InlineKeyboard, Keyboard } from 'grammy';

export function adminMainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('👥 Userlar', 'admin:users')
    .text('📊 Statistika', 'admin:stats')
    .row()
    .text('🚀 Start xabar', 'admin:start')
    .text('📢 Broadcast', 'admin:broadcast')
    .row()
    .text('🌐 Huzur sayti', 'admin:huzur')
    .text('💪 Ichki kuch sayti', 'admin:ichkikuch');
}

export function backKeyboard(target: string): InlineKeyboard {
  return new InlineKeyboard().text('⬅️ Orqaga', target);
}

/**
 * Pastki doimiy menyu (reply keyboard) — yozuv maydoni tagida
 * doim turadi, bo'limlarga tez kirish uchun.
 */
export const MENU_USERS = '👥 Userlar';
export const MENU_STATS = '📊 Statistika';
export const MENU_START = '🚀 Start xabar';
export const MENU_BROADCAST = '📢 Broadcast';
export const MENU_HUZUR = '🌐 Huzur sayti';
export const MENU_ICHKI_KUCH = '💪 Ichki kuch sayti';

export function mainReplyKeyboard(): Keyboard {
  return new Keyboard()
    .text(MENU_USERS)
    .text(MENU_STATS)
    .row()
    .text(MENU_START)
    .text(MENU_BROADCAST)
    .row()
    .text(MENU_HUZUR)
    .text(MENU_ICHKI_KUCH)
    .resized()
    .persistent();
}
