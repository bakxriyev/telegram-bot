/**
 * Concurrent load test — bir vaqtda ko'p /start so'rovini simulyatsiya qiladi.
 *
 * Nimalarni o'lchaydi:
 *  1. Bir vaqtda N ta user upsert (DB yozuv) — worker pool, 20 parallel
 *  2. /start yetkazish yo'li (mock Telegram API, 30ms kechikish bilan)
 *  3. Broadcast natijalarini batch yozish (markManyResults)
 *
 * Test userlari soxta telegram_id (9_000_000_001+) bilan yozilib,
 * oxirida TO'LIQ o'chiriladi.
 *
 * Ishga tushirish:  npx tsx loadtest/concurrent-starts.ts [SONI]
 */
import { usersRepository } from '../src/database/repositories/users.repository.js';
import {
  broadcastsRepository,
  broadcastRecipientsRepository,
} from '../src/database/repositories/broadcasts.repository.js';
import { startMessageService } from '../src/services/startMessage.service.js';
import { supabase } from '../src/database/supabase.js';
import type { StartMessageRow, UserRow } from '../src/types/index.js';

const COUNT = Number(process.argv[2] ?? 500);
const CONCURRENCY = 20;
const FAKE_BASE = 9_000_000_000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Cheklangan parallelizm bilan massivni ishlash. */
async function pool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

// Telegram API mock — 30ms tarmoq kechikishi bilan
function mockBot(): any {
  const call = async () => {
    await sleep(30);
    return { message_id: 1 };
  };
  return {
    api: {
      copyMessage: call,
      sendMessage: call,
      sendPhoto: call,
      sendVideo: call,
      sendDocument: call,
      sendAudio: call,
      sendVideoNote: call,
    },
  };
}

function fakeUserRow(i: number): UserRow {
  const now = new Date().toISOString();
  return {
    id: `test-${i}`,
    telegram_id: FAKE_BASE + i,
    username: `testuser${i}`,
    first_name: `Test${i}`,
    last_name: null,
    is_active: true,
    started_at: now,
    updated_at: now,
    created_at: now,
  };
}

async function cleanup(ids: number[], broadcastId?: string): Promise<void> {
  if (broadcastId) {
    await supabase.from('broadcasts').delete().eq('id', broadcastId);
  }
  // 200 tadan o'chirish
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    await supabase.from('users').delete().in('telegram_id', chunk);
  }
}

async function main(): Promise<void> {
  console.log(`=== Load test: ${COUNT} ta parallel so'rov, concurrency=${CONCURRENCY} ===\n`);
  const ids = Array.from({ length: COUNT }, (_, i) => FAKE_BASE + i + 1);
  let broadcastId: string | undefined;

  try {
    // ---------- TEST 1: concurrent upsert ----------
    console.log('TEST 1: bir vaqtda user upsert (DB yozuv)...');
    let t0 = Date.now();
    let errors = 0;
    await pool(ids, CONCURRENCY, async (tgId) => {
      try {
        await usersRepository.upsertByTelegramId({
          telegram_id: tgId,
          username: `testuser${tgId}`,
          first_name: `Test${tgId}`,
          last_name: null,
        });
      } catch {
        errors++;
      }
    });
    const upsertMs = Date.now() - t0;
    console.log(`  ✅ ${COUNT - errors}/${COUNT} yozildi, xato: ${errors}`);
    console.log(`  ⏱ Jami: ${upsertMs}ms, o'rtacha: ${(upsertMs / COUNT).toFixed(1)}ms/so'rov\n`);

    // ---------- TEST 2: /start yetkazish (mock API) ----------
    console.log('TEST 2: /start yetkazish (copy + {name} personalize)...');
    const bot = mockBot();
    const plainMsg = {
      id: 'm1', name: 't', channel_id: -1001, message_id: 1,
      is_active: true, activated_at: null, keyboard_buttons: [],
      caption_text: null, content_type: null, file_id: null,
      created_at: '', updated_at: '',
    } as StartMessageRow;
    const personalMsg = {
      ...plainMsg,
      caption_text: '{name}, videoni koring!',
      content_type: 'text',
      keyboard_buttons: [{ text: 'Kanal', url: 'https://t.me/x' }],
    } as StartMessageRow;

    t0 = Date.now();
    errors = 0;
    await pool(ids, CONCURRENCY, async (tgId, ) => {
      try {
        const u = fakeUserRow(tgId);
        await startMessageService.deliverSingleMessage(bot, u, plainMsg);
        await startMessageService.deliverSingleMessage(bot, u, personalMsg);
      } catch {
        errors++;
      }
    });
    const deliverMs = Date.now() - t0;
    console.log(`  ✅ ${COUNT * 2 - errors}/${COUNT * 2} yetkazildi, xato: ${errors}`);
    console.log(`  ⏱ Jami: ${deliverMs}ms, o'rtacha: ${(deliverMs / (COUNT * 2)).toFixed(1)}ms/xabar\n`);

    // ---------- TEST 3: broadcast batch yozuv ----------
    console.log('TEST 3: broadcast natijalarini batch yozish...');
    const draft = await broadcastsRepository.create({ channel_id: -1001, message_id: 1 });
    broadcastId = draft.id;

    // recipients uchun real user uuid larni olamiz
    const { data: testUsers } = await supabase
      .from('users')
      .select('id')
      .gte('telegram_id', FAKE_BASE)
      .lt('telegram_id', FAKE_BASE + COUNT + 1);
    const uuids = ((testUsers as { id: string }[]) ?? []).map((u) => u.id);
    console.log(`  test userlar topildi: ${uuids.length}`);

    t0 = Date.now();
    for (let i = 0; i < uuids.length; i += 500) {
      await broadcastRecipientsRepository.bulkInsertPending(broadcastId, uuids.slice(i, i + 500));
    }
    console.log(`  ⏱ bulkInsert: ${Date.now() - t0}ms (${uuids.length} qator)`);

    t0 = Date.now();
    const sentIds = uuids.slice(0, Math.floor(uuids.length * 0.9));
    const failedIds = uuids.slice(Math.floor(uuids.length * 0.9));
    await broadcastRecipientsRepository.markManyResults(broadcastId, sentIds, [
      { errorMessage: 'bot was blocked by the user', userIds: failedIds },
    ]);
    const markMs = Date.now() - t0;
    console.log(`  ✅ ${sentIds.length} sent + ${failedIds.length} failed yozildi`);
    console.log(`  ⏱ markManyResults: ${markMs}ms\n`);

    console.log('=== XULOSA ===');
    console.log(`Upsert: ${(upsertMs / COUNT).toFixed(1)}ms/so'rov | Yetkazish: ${(deliverMs / (COUNT * 2)).toFixed(1)}ms/xabar | Batch yozuv: ${markMs}ms`);
  } finally {
    console.log('\nTozalanmoqda...');
    await cleanup(ids, broadcastId);
    const { count } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('telegram_id', FAKE_BASE);
    console.log(`Qoldiq test userlar: ${count ?? 0}`);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
