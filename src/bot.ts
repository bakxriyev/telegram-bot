import { Bot, GrammyError, HttpError } from 'grammy';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import type { BotContext } from './types/index.js';

import { registerStartHandler } from './handlers/start.handler.js';
import { registerMenuHandler } from './handlers/menu.handler.js';
import { registerAdminHandler } from './handlers/admin.handler.js';
import { registerUsersHandler } from './handlers/users.handler.js';
import { registerStatisticsHandler } from './handlers/statistics.handler.js';
import { registerStartMessagesHandler } from './handlers/startMessages.handler.js';
import { registerBroadcastsHandler } from './handlers/broadcasts.handler.js';
import { registerProgrevHandler } from './handlers/progrev.handler.js';
import { registerHuzurHandler } from './handlers/huzur.handler.js';
import { registerStorageCaptureHandler } from './handlers/storageCapture.handler.js';

export function createBot(): Bot<BotContext> {
  const bot = new Bot<BotContext>(env.BOT_TOKEN);

  // Order matters: storage capture must see channel_post updates regardless
  // of admin-command routing; command/callback handlers are independent.
  // Menu handler is FIRST among message handlers so bottom-menu taps
  // cancel any in-progress flow before flow text-handlers read the state.
  registerMenuHandler(bot);
  registerStorageCaptureHandler(bot);

  registerStartHandler(bot);
  registerAdminHandler(bot);
  registerUsersHandler(bot);
  registerStatisticsHandler(bot);
  registerBroadcastsHandler(bot);
  registerProgrevHandler(bot);
  registerHuzurHandler(bot);
  registerStartMessagesHandler(bot);

  bot.catch((err) => {
    const ctx = err.ctx;
    const error = err.error;

    if (error instanceof GrammyError) {
      logger.error('Telegram API error', {
        update_id: ctx.update.update_id,
        description: error.description,
      });
    } else if (error instanceof HttpError) {
      logger.error('Network error while contacting Telegram', {
        update_id: ctx.update.update_id,
        message: error.message,
      });
    } else {
      logger.error('Unhandled bot error', {
        update_id: ctx.update.update_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Best-effort user-facing message; never leak internals.
    if (ctx.chat && ctx.chat.type === 'private') {
      ctx.reply('❌ Texnik xatolik yuz berdi.').catch(() => {
        /* swallow — we already logged the root cause */
      });
    }
  });

  return bot;
}
