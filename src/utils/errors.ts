export class AppError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = 'DatabaseError';
  }
}

export class TelegramSendError extends AppError {
  constructor(
    message: string,
    public readonly telegramId: number,
    public readonly permanent: boolean,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = 'TelegramSendError';
  }
}

/**
 * Telegram error descriptions that mean the user is permanently unreachable.
 * On these we mark the user inactive so future broadcasts skip them.
 */
export function isPermanentTelegramError(description: string | undefined): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  return (
    d.includes('bot was blocked') ||
    d.includes('user is deactivated') ||
    d.includes('chat not found') ||
    d.includes('user not found') ||
    d.includes('bot was kicked') ||
    d.includes('peer_id_invalid')
  );
}
