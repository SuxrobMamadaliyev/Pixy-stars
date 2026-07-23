const axios = require('axios');

const PIXY_API_URL = process.env.PIXY_API_URL;
const PIXY_SEED_PHRASE = process.env.PIXY_SEED_PHRASE;

const client = axios.create({
  baseURL: PIXY_API_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'User-Agent': 'TelegramStarsBot/1.0(Node)',
  },
});

/**
 * Umumiy POST so'rov, xatoliklarni birxil formatga keltiradi.
 * Pixy tarafida "Seqno" xatosi bo'lsa avtomatik qayta urinadi.
 */
async function post(endpoint, payload, { maxRetries = 3 } = {}) {
  if (!PIXY_API_URL) {
    return { ok: false, message: 'API URL sozlanmagan', error_type: 'CONFIG_ERROR' };
  }
  if (!PIXY_SEED_PHRASE) {
    return { ok: false, message: 'Seed phrase sozlanmagan', error_type: 'CONFIG_ERROR' };
  }

  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const resp = await client.post(url, payload);
      return resp.data || {};
    } catch (err) {
      const errData = err.response?.data;
      const errMsg = errData?.message || errData?.error || err.message;
      const errCode = errData?.code || errData?.error || 'HTTP_ERROR';

      // SeqNo xatosi bo'lsa biroz kutib qayta urinamiz
      if (String(errMsg).includes('Seqno') && attempt < maxRetries - 1) {
        const delay = 5000 + attempt * 2000;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      // Hamyon/seed bilan bog'liq xato — qayta urinmaymiz
      if (/(hamyon|seed|wallet)/i.test(String(errMsg))) {
        return { ok: false, message: errMsg, error_type: 'WALLET_ERROR' };
      }

      if (attempt < maxRetries - 1 && !err.response) {
        // Tarmoq xatosi — qayta urinish
        await new Promise((r) => setTimeout(r, 2 ** attempt * 1000));
        continue;
      }

      return { ok: false, message: errMsg, error_type: errCode };
    }
  }

  return { ok: false, message: 'Max retries exceeded', error_type: 'MAX_RETRIES' };
}

async function buyStars(username, amount, orderId) {
  if (amount < Number(process.env.MIN_STARS || 50)) {
    return { ok: false, message: `Minimum ${process.env.MIN_STARS || 50} stars`, error_type: 'VALIDATION_ERROR' };
  }
  const payload = { username, amount, seed: PIXY_SEED_PHRASE };
  if (orderId) payload.order_id = orderId;
  return post('/stars/buy', payload);
}

async function buyPremium(username, months, orderId) {
  if (![3, 6, 12].includes(months)) {
    return { ok: false, message: 'Faqat 3, 6, 12 oy', error_type: 'VALIDATION_ERROR' };
  }
  const payload = { username, duration: months, seed: PIXY_SEED_PHRASE };
  if (orderId) payload.order_id = orderId;
  return post('/premium/buy', payload);
}

async function getBalance() {
  return post('/balance', { seed: PIXY_SEED_PHRASE });
}

async function getStatus() {
  return post('/status', {});
}

function formatPixyError(response) {
  if (response.ok) return "Muvaffaqiyatli!";

  const messages = {
    VALIDATION_ERROR: "Validatsiya xatosi",
    INSUFFICIENT_FUNDS: "Hamyonda mablag' yetarli emas",
    WALLET_ERROR: 'Hamyon xatosi',
    WALLET_VM_ERROR: 'Hamyon xatosi',
    FRAGMENT_API_ERROR: 'Fragment API xatosi',
    FRAGMENT_TIMEOUT: 'Fragment serveri javob bermadi',
    CONFIG_ERROR: 'Sozlama xatosi',
    HTTP_ERROR: 'Server xatosi',
    REQUEST_ERROR: "So'rov xatosi",
  };

  const title = messages[response.error_type] || 'Xatolik';
  return `❌ ${title}!\n\n📝 Xatolik: ${response.message}\n\n💰 Pul qaytariladi\n\n🔧 Iltimos, admin bilan bog'laning`;
}

module.exports = { buyStars, buyPremium, getBalance, getStatus, formatPixyError };
