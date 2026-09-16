import type { SessionData } from '../types/index.js';

/**
 * Lightweight in-memory FSM state, keyed by the admin's Telegram id.
 *
 * We do NOT use grammY's built-in `session` plugin here because that
 * plugin keys state by chat id, and the crucial step of this flow —
 * capturing the message an admin posts into the STORAGE CHANNEL — arrives
 * as a `channel_post` update whose chat is the *channel*, not the admin's
 * private chat with the bot. So per-admin state is tracked here instead,
 * and matched to the right admin when the channel_post arrives.
 *
 * NOTE: this is process-memory only. If the bot restarts mid-flow, admins
 * simply start the flow again (acceptable for a single-instance VPS bot).
 * For multi-instance/HA deployments, swap this for a Redis-backed store.
 */
const store = new Map<number, SessionData>();

export function getAdminState(telegramId: number): SessionData {
  let state = store.get(telegramId);
  if (!state) {
    state = { step: 'idle' };
    store.set(telegramId, state);
  }
  return state;
}

export function setAdminState(telegramId: number, state: SessionData): void {
  store.set(telegramId, state);
}

export function resetAdminState(telegramId: number): void {
  store.set(telegramId, { step: 'idle' });
}

/** All admin ids currently sitting in the given step, oldest call order not guaranteed. */
export function findAdminsInStep(step: SessionData['step']): number[] {
  const result: number[] = [];
  for (const [id, state] of store.entries()) {
    if (state.step === step) result.push(id);
  }
  return result;
}
