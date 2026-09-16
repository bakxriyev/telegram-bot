/* Minimal structured logger. Never log secrets (tokens/keys). */

type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function timestamp(): string {
  return new Date().toISOString();
}

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  const line = `[${timestamp()}] [${level.toUpperCase()}] ${message}`;
  const payload = meta ? `${line} ${JSON.stringify(meta)}` : line;

  if (level === 'error') {
    // eslint-disable-next-line no-console
    console.error(payload);
  } else if (level === 'warn') {
    // eslint-disable-next-line no-console
    console.warn(payload);
  } else {
    // eslint-disable-next-line no-console
    console.log(payload);
  }
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
  debug: (message: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== 'production') write('debug', message, meta);
  },
};
