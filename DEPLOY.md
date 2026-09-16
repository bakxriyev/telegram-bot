# Serverga joylash — yo'riqnoma (Ubuntu)

## Muhim: port ochish SHART EMAS
Bot **polling** rejimda ishlaydi — faqat TASHQARIGA ulanadi
(api.telegram.org:443 va Supabase:443). Serverga kiruvchi port
ochish kerak emas, firewall yopiq holatda ham ishlaydi.

## 1. Serverda Docker o'rnatish
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
# Qayta kiring (logout/login), tekshiring:
docker --version
docker compose version
```

## 2. Loyihani serverga ko'chirish
Variant A — git orqali (tavsiya):
```bash
git clone <repo-url> telegram-bot
cd telegram-bot
```
Variant B — shu kompyuterdan nusxalash:
```bash
scp -r C:\Users\Admin\Desktop\telegram-bot\telegram-bot user@SERVER_IP:/home/user/telegram-bot
```
(.env faylni alohida, xavfsiz ko'chiring — pastga qarang)

## 3. `.env` ni to'ldirish
```bash
cp .env.example .env
nano .env
```
Barcha qiymatlarni yozing: `BOT_TOKEN`, `SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `STORAGE_CHANNEL_ID`, `ADMIN_IDS`.
`NODE_ENV=production` bo'lsin.

## 4. Ishga tushirish
```bash
docker compose up -d --build
docker ps                 # container ishlayotganini ko'rish
docker logs -f telegram-bot   # loglarni kuzatish (Ctrl+C chiqish)
```

## 5. Tekshirish
- Telegram'da botga `/start` yuboring — start xabar kelishi kerak
- Admin sifatida `/admin` — panel ochilishi kerak
- Logda xatolik bo'lmasligi kerak

## 6. Yangilash (kod o'zgarganda)
```bash
cd telegram-bot
git pull                  # yoki yangi fayllarni ko'chiring
docker compose up -d --build
docker logs -f telegram-bot
```

## 7. Boshqaruv
```bash
docker compose restart    # qayta ishga tushirish
docker compose stop       # to'xtatish
docker compose start      # ishga tushirish
docker compose down       # to'liq o'chirish
```

## Xavfsizlik
- `.env` ni HECH QACHON git'ga push qilmang (`.gitignore` da bor)
- `SUPABASE_SERVICE_ROLE_KEY` faqat serverdagi `.env` da bo'lsin
- `ADMIN_IDS` ga faqat o'zingizni yozing
- Serverda avtomatik yangilanish yoqing: `sudo apt install unattended-upgrades`
- Muammo bo'lsa `docker logs telegram-bot` chiqishini yuboring
