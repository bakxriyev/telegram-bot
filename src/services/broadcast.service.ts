import type { Bot } from 'grammy';
import {
  broadcastsRepository,
  broadcastRecipientsRepository,
} from '../database/repositories/broadcasts.repository.js';
import { startMessagesRepository } from '../database/repositories/startMessages.repository.js';
import { usersRepository } from '../database/repositories/users.repository.js';
import { safeDeliver } from './telegram.service.js';
import { logger } from '../utils/logger.js';
import type { BroadcastRow, ContentTypeName, UserRow, StartMessageRow, SourceType } from '../types/index.js';

const BATCH_SIZE = 30;
const BATCH_DELAY_MS = 800;
const PARALLEL_LIMIT = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const broadcastService = {
  async createDraft(input: {
    channelId: number;
    messageId: number;
    captionText?: string | null;
    contentType?: string | null;
    fileId?: string | null;
  }): Promise<BroadcastRow> {
    return broadcastsRepository.create({
      channel_id: input.channelId,
      message_id: input.messageId,
      caption_text: input.captionText,
      content_type: input.contentType,
      file_id: input.fileId,
    });
  },

  async countEligibleRecipients(): Promise<number> {
    return usersRepository.countActive();
  },

  async createStartMessageWithKeyboard(
    name: string,
    channelId: number,
    messageId: number,
    captured?: { captionText?: string | null; contentType?: string | null; fileId?: string | null },
    source?: SourceType,
  ): Promise<StartMessageRow> {
    return startMessagesRepository.create({
      name,
      channel_id: channelId,
      message_id: messageId,
      activate: false,
      caption_text: captured?.captionText ?? null,
      content_type: captured?.contentType ?? null,
      file_id: captured?.fileId ?? null,
      source: source ?? 'instagram',
    });
  },

  async run(bot: Bot, broadcastId: string): Promise<void> {
    const broadcast = await broadcastsRepository.getById(broadcastId);
    if (!broadcast) {
      logger.error('Broadcast not found when starting run', { broadcastId });
      return;
    }

    await broadcastsRepository.updateStatus(broadcastId, 'processing', {
      started_at: new Date().toISOString(),
    });

    let totalUsers = 0;
    let successCount = 0;
    let failedCount = 0;

    try {
      const allUsers: { id: string; telegram_id: number }[] = [];
      for await (const page of usersRepository.iterateActive()) {
        allUsers.push(...page.map((u) => ({ id: u.id, telegram_id: u.telegram_id })));
      }
      totalUsers = allUsers.length;

      await broadcastsRepository.updateStatus(broadcastId, 'processing', {
        total_users: totalUsers,
      });

      for (let i = 0; i < allUsers.length; i += 500) {
        const chunk = allUsers.slice(i, i + 500).map((u) => u.id);
        await broadcastRecipientsRepository.bulkInsertPending(broadcastId, chunk);
      }

      // Batch — har bir batch ichida parallel yuborish
      for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
        const batch = allUsers.slice(i, i + BATCH_SIZE);

        // Foydalanuvchilarni batch bo'yicha oldindan yuklab olish
        const userRows = new Map<number, UserRow>();
        const uniqueTgIds = [...new Set(batch.map((r) => r.telegram_id))];
        const fetchPromises = uniqueTgIds.map(async (tgId) => {
          const user = await usersRepository.findByTelegramId(tgId);
          if (user) userRows.set(tgId, user);
        });
        await Promise.allSettled(fetchPromises);

        // Parallel yuborish — PARALLEL_LIMIT concurrently
        const batchResults: { recipient: typeof batch[0]; ok: boolean; permanent: boolean; retryAfter?: number; error?: string }[] = [];

        for (let j = 0; j < batch.length; j += PARALLEL_LIMIT) {
          const chunk = batch.slice(j, j + PARALLEL_LIMIT);
          const results = await Promise.allSettled(
            chunk.map(async (recipient) => {
              const userRow = userRows.get(recipient.telegram_id);
              if (!userRow) return { recipient, ok: false, permanent: false, error: 'no user' };

              const outcome = await safeDeliver(bot, {
                toTelegramId: recipient.telegram_id,
                fromChannelId: broadcast.channel_id,
                fromMessageId: broadcast.message_id,
                capturedCaption: broadcast.caption_text,
                capturedContentType: (broadcast.content_type ?? undefined) as ContentTypeName | undefined,
                capturedFileId: broadcast.file_id ?? undefined,
                capturedKeyboardButtons: broadcast.keyboard_buttons,
                user: userRow,
              });

              return {
                recipient,
                ok: outcome.ok,
                permanent: outcome.permanent,
                retryAfter: outcome.retryAfterSeconds,
                error: outcome.errorMessage,
              };
            }),
          );

          for (const r of results) {
            if (r.status === 'fulfilled') {
              batchResults.push(r.value);
            }
          }

          // Agar retryAfter kerak bo'lsa, kutish
          for (const r of batchResults) {
            if (!r.ok && r.retryAfter) {
              await sleep((r.retryAfter + 1) * 1000);
              const userRow = userRows.get(r.recipient.telegram_id);
              if (userRow) {
                const retry = await safeDeliver(bot, {
                  toTelegramId: r.recipient.telegram_id,
                  fromChannelId: broadcast.channel_id,
                  fromMessageId: broadcast.message_id,
                  capturedCaption: broadcast.caption_text,
                  capturedContentType: (broadcast.content_type ?? undefined) as ContentTypeName | undefined,
                  capturedFileId: broadcast.file_id ?? undefined,
                  capturedKeyboardButtons: broadcast.keyboard_buttons,
                  user: userRow,
                });
                if (retry.ok) {
                  r.ok = true;
                  r.error = undefined;
                }
              }
            }
          }
        }

        // Natijalarni saqlash — batch yozuv (10k+ userda tezlik uchun):
        // 30 ta alohida UPDATE o'rniga 2-3 ta so'rov.
        let batchSuccess = 0;
        let batchFailed = 0;
        const sentIds: string[] = [];
        const failedByError = new Map<string, string[]>();
        const permanentIds: string[] = [];

        for (const r of batchResults) {
          if (r.ok) {
            successCount++;
            batchSuccess++;
            sentIds.push(r.recipient.id);
          } else {
            failedCount++;
            batchFailed++;
            const key = r.error ?? '';
            const list = failedByError.get(key) ?? [];
            list.push(r.recipient.id);
            failedByError.set(key, list);
            if (r.permanent) permanentIds.push(r.recipient.id);
          }
        }

        await broadcastRecipientsRepository.markManyResults(
          broadcastId,
          sentIds,
          [...failedByError.entries()].map(([errorMessage, userIds]) => ({
            errorMessage: errorMessage || undefined,
            userIds,
          })),
        );
        if (permanentIds.length > 0) {
          await usersRepository.setManyActive(permanentIds, false);
        }

        await broadcastsRepository.incrementCounters(broadcastId, batchSuccess, batchFailed);

        if (i + BATCH_SIZE < allUsers.length) {
          await sleep(BATCH_DELAY_MS);
        }
      }

      await broadcastsRepository.updateStatus(broadcastId, 'completed', {
        finished_at: new Date().toISOString(),
      });

      logger.info('Broadcast finished', { broadcastId, totalUsers, successCount, failedCount });
    } catch (err) {
      logger.error('Broadcast run failed', {
        broadcastId,
        error: err instanceof Error ? err.message : String(err),
      });
      await broadcastsRepository.updateStatus(broadcastId, 'failed', {
        finished_at: new Date().toISOString(),
      });
    }
  },
};
