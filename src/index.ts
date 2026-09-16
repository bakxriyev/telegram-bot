import { createBot } from './bot.js';
import { startScheduler, stopScheduler } from './services/scheduler.service.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  logger.info('Starting bot...', { node_env: env.NODE_ENV });

  const bot = createBot();

  await bot.init();
  logger.info('Bot initialized', { username: bot.botInfo.username });
  logger.info('Admins configured', { count: env.ADMIN_IDS.length });

  startScheduler(bot);

  // Polling for now; swap to webhook (bot.api.setWebhook + an HTTP server)
  // when moving to production behind a reverse proxy, without touching
  // any handler code — handlers are transport-agnostic.
  bot.start({
    onStart: () => logger.info('Bot is polling for updates'),
  });

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down...`);
    stopScheduler();
    await bot.stop();
    process.exit(0);
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
