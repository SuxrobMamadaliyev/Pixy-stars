require('dotenv').config();
const express = require('express');
const { Telegraf, Markup, session } = require('telegraf');
const pixy = require('./pixyApi');
const db = require('./db');

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const PRICE_PER_STAR = Number(process.env.PRICE_PER_STAR || 150);
const MIN_STARS = Number(process.env.MIN_STARS || 50);

// Custom emoji (faqat Telegram Premium akkountlar ko'radi, HTML parse_mode bilan xabar matnida ishlaydi)
const STAR_EMOJI_ID = '5397916757333654639';
const STAR_EMOJI_HTML = `<tg-emoji emoji-id="${STAR_EMOJI_ID}">⭐</tg-emoji>`;

// Render doim tashqi RENDER_EXTERNAL_URL beradi (masalan: https://sizning-app.onrender.com)
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_DOMAIN;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error("❌ BOT_TOKEN .env faylida topilmadi!");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
bot.use((ctx, next) => {
  console.log(`🤖 Update: ${ctx.updateType} from ${ctx.from?.id}`);
  return next();
});
bot.use(session({ defaultSession: () => ({}) }));

function isAdmin(ctx) {
  return ADMIN_IDS.includes(String(ctx.from.id));
}

function mainMenu() {
  return Markup.keyboard([['⭐ Stars sotib olish'], ['ℹ️ Yordam']]).resize();
}

function adminMenu() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('💰 Balansni tekshirish', 'admin_balance')],
    [Markup.button.callback('📊 Statistika', 'admin_stats')],
  ]);
}

// ---------------- USER FLOW ----------------

bot.start((ctx) => {
  ctx.session = {};
  ctx.reply(
    `👋 Assalomu alaykum, ${ctx.from.first_name}!\n\n` +
      `${STAR_EMOJI_HTML} Bu bot orqali Telegram Stars sotib olishingiz mumkin.\n` +
      `💵 Narx: 1 stars = ${PRICE_PER_STAR} so'm\n` +
      `📦 Minimum: ${MIN_STARS} stars\n\n` +
      `Boshlash uchun pastdagi tugmani bosing 👇`,
    { parse_mode: 'HTML', ...mainMenu() }
  );
});

bot.hears('⭐ Stars sotib olish', (ctx) => {
  ctx.session.step = 'awaiting_username';
  ctx.reply(
    "📩 Stars yuboriladigan Telegram username'ni kiriting.\n" +
      "Masalan: @username (@ belgisi bilan yoki bilmasdan yozsangiz ham bo'ladi)"
  );
});

bot.hears('ℹ️ Yordam', (ctx) => {
  ctx.reply(
    "ℹ️ Yordam:\n\n" +
      "1️⃣ 'Stars sotib olish' tugmasini bosing\n" +
      "2️⃣ Username kiriting\n" +
      "3️⃣ Miqdorni kiriting\n" +
      "4️⃣ To'lovni tasdiqlang\n\n" +
      "Savollar bo'lsa admin bilan bog'laning."
  );
});

bot.command('admin', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Sizda ruxsat yo\'q.');
  ctx.reply('🔧 Admin panel', adminMenu());
});

// Foydalanuvchi matnli xabarlari (username / miqdor / tasdiqlash bosqichlari)
bot.on('text', async (ctx, next) => {
  const step = ctx.session?.step;
  if (!step) return next();

  const text = ctx.message.text.trim();

  if (step === 'awaiting_username') {
    const username = text.replace('@', '');
    if (!/^[a-zA-Z0-9_]{5,32}$/.test(username)) {
      return ctx.reply("❌ Username noto'g'ri formatda. Qaytadan kiriting:");
    }
    ctx.session.username = username;
    ctx.session.step = 'awaiting_amount';
    return ctx.reply(`✅ Username: @${username}\n\n📦 Nechta stars sotib olmoqchisiz? (minimum ${MIN_STARS})`);
  }

  if (step === 'awaiting_amount') {
    const amount = parseInt(text, 10);
    if (isNaN(amount) || amount < MIN_STARS) {
      return ctx.reply(`❌ Noto'g'ri miqdor. Minimum ${MIN_STARS} stars kiriting:`);
    }
    const priceUZS = amount * PRICE_PER_STAR;
    ctx.session.amount = amount;
    ctx.session.priceUZS = priceUZS;
    ctx.session.step = 'awaiting_confirm';

    return ctx.reply(
      `🧾 Buyurtma tafsilotlari:\n\n` +
        `👤 Username: @${ctx.session.username}\n` +
        `${STAR_EMOJI_HTML} Stars: ${amount}\n` +
        `💵 Narx: ${priceUZS.toLocaleString('ru-RU')} so'm\n\n` +
        `Tasdiqlaysizmi?`,
      {
        parse_mode: 'HTML',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('✅ Tasdiqlash', 'confirm_order')],
          [Markup.button.callback('❌ Bekor qilish', 'cancel_order')],
        ]),
      }
    );
  }

  return next();
});

bot.action('cancel_order', (ctx) => {
  ctx.session = {};
  ctx.answerCbQuery('Bekor qilindi');
  ctx.editMessageText('❌ Buyurtma bekor qilindi.');
});

bot.action('confirm_order', async (ctx) => {
  const { username, amount, priceUZS } = ctx.session || {};
  if (!username || !amount) {
    return ctx.answerCbQuery("Sessiya eskirgan, qaytadan urinib ko'ring", { show_alert: true });
  }

  await ctx.answerCbQuery();
  await ctx.editMessageText('⏳ Buyurtma qayta ishlanmoqda, biroz kuting...');

  const orderId = `ORD${Date.now()}`;
  const result = await pixy.buyStars(username, amount, orderId);

  const order = {
    orderId,
    userId: ctx.from.id,
    username,
    amount,
    priceUZS,
    createdAt: new Date().toISOString(),
    status: result.ok ? 'success' : 'failed',
    error: result.ok ? null : result.message,
  };
  db.addOrder(order);

  if (result.ok) {
    await ctx.reply(
      `✅ Muvaffaqiyatli!\n\n${STAR_EMOJI_HTML} ${amount} stars @${username} ga yuborildi.\n🆔 Buyurtma: ${orderId}`,
      { parse_mode: 'HTML', ...mainMenu() }
    );
  } else {
    await ctx.reply(pixy.formatPixyError(result), mainMenu());
  }

  ctx.session = {};
});

// ---------------- ADMIN PANEL ----------------

bot.action('admin_balance', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Ruxsat yoʻq', { show_alert: true });
  await ctx.answerCbQuery('Tekshirilmoqda...');

  const balance = await pixy.getBalance();
  if (!balance.ok) {
    return ctx.reply(`❌ Balansni olishda xatolik: ${balance.message}`, adminMenu());
  }

  // Pixy javobi turlicha bo'lishi mumkin — mavjud maydonlarni ko'rsatamiz
  const amount = balance.balance ?? balance.amount ?? balance.data?.balance ?? JSON.stringify(balance);
  const currency = balance.currency || 'TON';

  await ctx.reply(`💰 Hamyon balansi:\n\n${amount} ${currency}`, adminMenu());
});

bot.action('admin_stats', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Ruxsat yoʻq', { show_alert: true });
  await ctx.answerCbQuery();

  const stats = db.getStats();
  await ctx.reply(
    `📊 Statistika:\n\n` +
      `📦 Jami buyurtmalar: ${stats.totalOrders}\n` +
      `✅ Muvaffaqiyatli: ${stats.successOrders}\n` +
      `${STAR_EMOJI_HTML} Sotilgan stars: ${stats.totalStars}\n` +
      `💵 Jami tushum: ${stats.totalRevenue.toLocaleString('ru-RU')} so'm`,
    { parse_mode: 'HTML', ...adminMenu() }
  );
});

bot.catch((err, ctx) => {
  console.error(`Xatolik ${ctx.updateType} uchun:`, err);
  ctx.reply('⚠️ Kutilmagan xatolik yuz berdi.').catch(() => {});
});

// ---------------- ISHGA TUSHIRISH (Render uchun webhook, lokal uchun polling) ----------------

const app = express();
app.use(express.json());

// Har bir kelgan so'rovni log qilib turamiz — diagnostika uchun
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.path}`);
  next();
});

// Render "health check" uchun oddiy GET endpoint kutadi
app.get('/', (req, res) => res.send('✅ Stars bot ishlayapti'));

// Diagnostika: joriy webhook holatini ko'rish uchun (brauzerda oching)
app.get('/webhook-info', async (req, res) => {
  try {
    const info = await bot.telegram.getWebhookInfo();
    res.json(info);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// MUHIM: Render portni darhol ochilishini kutadi — shuning uchun listen()ni
// webhook/Telegram bilan bog'liq har qanday ishdan OLDIN chaqiramiz.
const server = app.listen(PORT, () => {
  console.log(`🌐 Server ${PORT} portda tinglayapti`);
  setupBot().catch((err) => {
    console.error('❌ Botni sozlashda xatolik:', err);
  });
});

async function setupBot() {
  console.log('RENDER_EXTERNAL_URL:', RENDER_URL || '(topilmadi)');

  if (RENDER_URL) {
    const webhookPath = `/webhook/${BOT_TOKEN}`;
    const fullWebhookUrl = `${RENDER_URL}${webhookPath}`;

    app.use(bot.webhookCallback(webhookPath));

    try {
      const result = await bot.telegram.setWebhook(fullWebhookUrl);
      console.log('setWebhook natijasi:', result);
      const info = await bot.telegram.getWebhookInfo();
      console.log('Webhook holati:', JSON.stringify(info));
      console.log(`🚀 Bot webhook rejimida ishga tushdi: ${fullWebhookUrl}`);
    } catch (err) {
      console.error('❌ setWebhook xatosi:', err.message);
    }
  } else {
    await bot.launch();
    console.log('🚀 Bot polling rejimida ishga tushdi (lokal)');
  }
}

process.once('SIGINT', () => {
  bot.stop('SIGINT');
  server.close();
});
process.once('SIGTERM', () => {
  bot.stop('SIGTERM');
  server.close();
});
