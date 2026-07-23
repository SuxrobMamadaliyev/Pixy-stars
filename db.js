const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'orders.json');

function load() {
  if (!fs.existsSync(DB_PATH)) return { orders: [] };
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    return { orders: [] };
  }
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function addOrder(order) {
  const data = load();
  data.orders.push(order);
  save(data);
  return order;
}

function getOrders() {
  return load().orders;
}

function getStats() {
  const orders = getOrders();
  const success = orders.filter((o) => o.status === 'success');
  const totalStars = success.reduce((sum, o) => sum + (o.amount || 0), 0);
  const totalRevenue = success.reduce((sum, o) => sum + (o.priceUZS || 0), 0);
  return {
    totalOrders: orders.length,
    successOrders: success.length,
    totalStars,
    totalRevenue,
  };
}

module.exports = { addOrder, getOrders, getStats };
