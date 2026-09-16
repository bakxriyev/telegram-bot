import type { UserRow } from '../types/index.js';

/**
 * Replaces known placeholders inside a text/caption with real user data.
 * Currently supports {name} (first_name, falls back to "User") and
 * {username} (falls back to empty string). Never emits "undefined"/"null".
 */
export function personalizeText(text: string | null | undefined, user: UserRow): string {
  if (!text) return '';

  const name = user.first_name && user.first_name.trim().length > 0 ? user.first_name : 'User';
  const username = user.username ? `@${user.username}` : '';

  return text.replace(/\{name\}/g, name).replace(/\{username\}/g, username);
}

export function containsPlaceholder(text: string | null | undefined): boolean {
  if (!text) return false;
  return /\{name\}|\{username\}/.test(text);
}
