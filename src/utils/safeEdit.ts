import { GrammyError } from 'grammy';
import type { BotContext } from '../types/index.js';

type EditExtra = Parameters<BotContext['editMessageText']>[1];

/**
 * editMessageText ni xavfsiz chaqirish.
 * "message is not modified" (tugmani 2 marta bosish yoki ikkita bot
 * instance bir xil xabarni tahrirlaganda) — xato emas deb hisoblanadi,
 * shunchaki callback query javoblanib o'tib ketiladi.
 * Qaytaradi: true = yangilandi, false = o'zgarishsiz (yutildi).
 * Boshqa xatolar yuqoriga otadi.
 */
export async function safeEditMessageText(
  ctx: BotContext,
  text: string,
  extra?: EditExtra,
): Promise<boolean> {
  try {
    await ctx.editMessageText(text, extra);
    return true;
  } catch (err) {
    if (
      err instanceof GrammyError &&
      err.error_code === 400 &&
      err.description.includes('message is not modified')
    ) {
      await ctx.answerCallbackQuery().catch(() => undefined);
      return false;
    }
    throw err;
  }
}
