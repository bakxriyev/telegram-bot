# Telegram Bot — Storage Channel + Supabase + Broadcast

Node.js 20+, TypeScript, grammY, Supabase asosida qurilgan production-ready Telegram bot.

## Qisqacha arxitektura

- Barcha media (video, photo, document, audio, video note) **VPS'da saqlanmaydi**.
- Admin kontentni maxsus **STORAGE CHANNEL**ga yuboradi, bot o'sha yerdagi `channel_id` + `message_id`ni Supabase'ga yozadi.
- Userga yuborishda `copyMessage` orqali Telegram serverlari ichida nusxalanadi.
- Admin boshqaruvi **alohida jadvalsiz** — faqat `.env` dagi `ADMIN_IDS` ro'yxati orqali (bot foydalanuvchini Telegram ID orqali taniydi, login/parol kerak emas).

## 1. O'rnatish

```bash
node -v   # 20+ bo'lishi kerak
npm install
cp .env.example .env
```

## 2. Supabase loyihasi

1. https://supabase.com da yangi project yarating.
2. **SQL Editor** ga o'ting va `supabase/schema.sql` faylining butun mazmunini ishga tushiring.
3. **Project Settings → API** bo'limidan quyidagilarni oling:
   - `Project URL` → `.env`dagi `SUPABASE_URL`
   - `service_role` key (⚠️ **sir**, hech qachon frontendga chiqarilmasin) → `SUPABASE_SERVICE_ROLE_KEY`

## 3. Telegram bot yaratish

1. Telegram'da [@BotFather](https://t.me/BotFather) bilan gaplashib `/newbot` orqali bot yarating (yoki mavjud tokenni qayta generatsiya qiling: `/mybots` → botingiz → **API Token** → **Revoke**).
2. Olingan tokenni `.env`dagi `BOT_TOKEN`ga qo'ying.

> ⚠️ **Muhim xavfsizlik eslatmasi**: agar bot tokeningiz biror joyda (chat, screenshot, public repo) ochiq ko'rinib qolgan bo'lsa, uni **darhol** @BotFather orqali qayta generatsiya qiling. Eski token darhol ishlamay qoladi.

## 4. Storage kanal yaratish

1. Yangi **private** Telegram kanal yarating.
2. Botingizni o'sha kanalga **admin** qilib qo'shing (kamida "Post Messages" huquqi bilan).
3. Kanal ID'sini oling (masalan, [@userinfobot](https://t.me/userinfobot) yoki kanal linkidan `-100...` formatdagi ID). Kanal private bo'lgani uchun ID odatda `-100` bilan boshlanadi.
4. `.env`dagi `STORAGE_CHANNEL_ID`ga shu ID'ni yozing (masalan `-1001234567890`).

## 5. `.env` sozlash

```env
BOT_TOKEN=xxxxx:yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=xxxxxxxxxxxxxxxxxxxxxxxx
STORAGE_CHANNEL_ID=-1001234567890
ADMIN_IDS=123456789,987654321
NODE_ENV=production
```

`ADMIN_IDS` — botdan admin sifatida foydalanadigan Telegram foydalanuvchi ID'lari, vergul bilan ajratilgan. O'z Telegram ID'ingizni bilish uchun [@userinfobot](https://t.me/userinfobot)dan foydalaning.

## 6. Ishga tushirish (development)

```bash
npm run dev
```

## 7. Build va production start

```bash
npm run build
npm start
```

## 8. VPS'ga deploy qilish

```bash
git clone <repo> telegram-bot
cd telegram-bot
npm install
cp .env.example .env    # va to'ldiring
npm run build
```

## 9. PM2 bilan ishlatish (tavsiya etiladi)

```bash
npm install -g pm2
pm2 start dist/index.js --name telegram-bot
pm2 save
pm2 startup   # server reboot bo'lganda avtomatik ishga tushishi uchun
```

Botni qayta ishga tushirish:

```bash
pm2 restart telegram-bot
```

Loglarni ko'rish:

```bash
pm2 logs telegram-bot
```

## 10. Botdan foydalanish

### Oddiy user

- `/start` — ro'yxatdan o'tadi (yoki mavjud bo'lsa yangilanadi) va aktiv start xabarni oladi.

### Admin

- `/admin` — admin panelni ochadi (faqat `ADMIN_IDS` ichidagi userlar uchun).
- **👥 Userlar** — jami/aktiv/bloklangan userlar soni.
- **📊 Statistika** — umumiy statistikalar.
- **🚀 Start xabar**:
  - ➕ qo'shish — storage kanalga xabar yuborasiz, keyin nom kiritasiz, so'ng aktivlashtirishni tanlaysiz.
  - ✏️ o'zgartirish — mavjud start xabarning nomi saqlanib, faqat kontenti (channel_id/message_id) yangilanadi.
  - 📋 ro'yxat — mavjud xabarlarni ko'rish va birini aktivlashtirish.
  - 🗑 o'chirish — aktiv xabarni o'chirishda qo'shimcha tasdiqlash so'raladi.
- **📢 Broadcast**:
  - ➕ yangi — storage kanalga xabar yuborasiz → preview + qabul qiluvchilar soni → tasdiqlaysiz.
  - `{name}` (va `{username}`) placeholder avtomatik har bir userning ismiga almashtiriladi. Bu faqat matn/caption'da ishlaydi; oddiy `copyMessage` esa placeholder yo'q bo'lsa ishlatiladi (tezroq, VPS trafigisiz).
  - `video_note` (aylana) captionni qo'llab-quvvatlamaydi — shu sababli agar placeholder ishlatilsa, avval alohida shaxsiylashtirilgan matn, keyin video note yuboriladi.
  - Yuborish 20 talik batch'larda, batch'lar orasida ~1.2s kutish bilan amalga oshiriladi; Telegram `429 Too Many Requests` qaytarsa, `retry_after` vaqtiga qarab kutib, qayta urinadi.
  - Bloklagan/deaktivlangan userlar avtomatik `is_active=false` qilinadi va keyingi broadcastlarga kiritilmaydi.
  - 📋 tarixi — pagination bilan barcha broadcastlar ro'yxati.

## 11. Muhim texnik eslatmalar

- **FSM/holat**: admin oqimlari (start xabar qo'shish, broadcast yaratish) jarayon xotirasida (`src/state/adminState.ts`) saqlanadi, chunki storage kanalga yuborilgan xabar `channel_post` sifatida keladi va unda yuboruvchi admin identifikatori bo'lmaydi — shu sababli grammY'ning chat-based session pluginidan foydalanilmadi. Bot qayta ishga tushsa, boshlanmagan oqim shunchaki qayta boshlanadi. Ko'p instansiyali (HA) deploy uchun buni Redis-backed store'ga almashtirish tavsiya etiladi.
- **Bitta aktiv start xabar**: Postgres partial unique index + `activate_start_message` SQL funksiyasi orqali kafolatlanadi (race condition'siz).
- **RLS**: barcha jadvallarda yoqilgan, hech qanday public/anon policy yo'q — faqat backend `service_role` kaliti orqali ishlaydi.
- **Pagination**: userlar va broadcast recipientlar hech qachon bittada to'liq xotiraga yuklanmaydi (`iterateActive` sahifalab o'qiydi).
- **Webhook'ga o'tish**: hozircha `bot.start()` (long polling) ishlatiladi. Webhook'ga o'tish uchun `src/index.ts`dagi polling qismini HTTP server + `bot.api.setWebhook(...)` bilan almashtirish kifoya — handler kodiga tegilmaydi.

## 12. Loyiha strukturasi

```
src/
├── index.ts                 — entrypoint, polling start
├── bot.ts                   — bot yig'ish, global error handler
├── config/env.ts             — Zod bilan environment validatsiya
├── database/
│   ├── supabase.ts
│   └── repositories/
├── handlers/                 — barcha komanda/callback handlerlar
├── services/                 — biznes-logika (user, broadcast, telegram, startMessage)
├── keyboards/                 — inline keyboardlar
├── middleware/admin.middleware.ts
├── state/adminState.ts        — admin FSM (in-memory)
├── utils/                     — logger, errors, personalize
└── types/index.ts
```
