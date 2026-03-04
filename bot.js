const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');

const BOT_TOKEN = process.env.BOT_TOKEN || '8639490181:AAHlTgtVDsRuohlt0ZgcGV2h0J4vz7o5pLQ';
const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://YOUR_USER:YOUR_PASS@cluster.mongodb.net/kingsignal';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'supersecret123';
const API_URL = process.env.API_URL || 'https://king-signal-server.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

let db;
MongoClient.connect(MONGO_URI).then(client => {
  db = client.db('kingsignal');
  console.log('✅ Бот: MongoDB подключён');
}).catch(err => console.error('❌ MongoDB ошибка:', err));

// Хранение состояний разговора
const states = {};

function isAdmin(chatId) {
  const admins = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim());
  return admins.includes(String(chatId));
}

// ─── /start ───────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (isAdmin(chatId)) {
    bot.sendMessage(chatId,
      `👑 <b>KING SIGNAL — ADMIN PANEL</b>\n\n` +
      `Команды:\n` +
      `/deposit — начислить баланс игроку\n` +
      `/withdraw — вывод игрока (просмотр заявок)\n` +
      `/balance — проверить баланс игрока\n` +
      `/addkey — добавить новый ключ\n` +
      `/keys — список всех ключей\n` +
      `/players — список игроков`,
      { parse_mode: 'HTML' }
    );
  } else {
    bot.sendMessage(chatId,
      `👑 <b>KING SIGNAL BOT</b>\n\nЭтот бот для администраторов.\nДля получения ключа: @vivoxz`,
      { parse_mode: 'HTML' }
    );
  }
});

// ─── /deposit — начислить баланс ─────────────────────────────────────────────
bot.onText(/\/deposit(?:\s+(\S+))?(?:\s+(\d+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  const playerId = match[1];
  const amount = match[2];

  if (playerId && amount) {
    // Сразу начисляем
    await doDeposit(chatId, playerId.toUpperCase(), Number(amount));
  } else if (playerId) {
    states[chatId] = { action: 'deposit_amount', playerId: playerId.toUpperCase() };
    bot.sendMessage(chatId, `💰 Игрок: <b>${playerId.toUpperCase()}</b>\nВведи сумму для начисления (KGS):`, { parse_mode: 'HTML' });
  } else {
    states[chatId] = { action: 'deposit_id' };
    bot.sendMessage(chatId, `💰 <b>НАЧИСЛЕНИЕ БАЛАНСА</b>\n\nВведи Айди игрока:`, { parse_mode: 'HTML' });
  }
});

async function doDeposit(chatId, playerId, amount) {
  try {
    const result = await db.collection('players').findOneAndUpdate(
      { playerId },
      { $inc: { balance: amount }, $setOnInsert: { createdAt: Date.now() } },
      { returnDocument: 'after', upsert: true }
    );
    const newBalance = result.balance;
    bot.sendMessage(chatId,
      `✅ <b>НАЧИСЛЕНО!</b>\n\nАйди: <code>${playerId}</code>\nНачислено: <b>+${amount} KGS</b>\nНовый баланс: <b>${newBalance} KGS</b>`,
      { parse_mode: 'HTML' }
    );
    // Уведомляем игрока если есть его telegramId
    const player = await db.collection('players').findOne({ playerId });
    if (player && player.telegramChatId) {
      bot.sendMessage(player.telegramChatId,
        `💰 <b>Баланс пополнен!</b>\n\nНачислено: <b>+${amount} KGS</b>\nВаш баланс: <b>${newBalance} KGS</b>`,
        { parse_mode: 'HTML' }
      );
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

// ─── /balance — проверить баланс ─────────────────────────────────────────────
bot.onText(/\/balance(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;

  const playerId = match[1];
  if (playerId) {
    const player = await db.collection('players').findOne({ playerId: playerId.toUpperCase() });
    if (!player) return bot.sendMessage(chatId, `❌ Игрок <code>${playerId.toUpperCase()}</code> не найден.`, { parse_mode: 'HTML' });
    bot.sendMessage(chatId,
      `💼 <b>БАЛАНС ИГРОКА</b>\n\nАйди: <code>${player.playerId}</code>\nКлюч: <code>${player.key || '—'}</code>\nБаланс: <b>${player.balance || 0} KGS</b>`,
      { parse_mode: 'HTML' }
    );
  } else {
    states[chatId] = { action: 'balance_id' };
    bot.sendMessage(chatId, `🔍 Введи Айди игрока:`, { parse_mode: 'HTML' });
  }
});

// ─── /addkey — добавить ключ ─────────────────────────────────────────────────
bot.onText(/\/addkey/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  states[chatId] = { action: 'addkey_key' };
  bot.sendMessage(chatId, `🔑 <b>ДОБАВИТЬ КЛЮЧ</b>\n\nВведи ключ (например: KING123456):`, { parse_mode: 'HTML' });
});

// ─── /keys — список ключей ────────────────────────────────────────────────────
bot.onText(/\/keys/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const keys = await db.collection('keys').find({}).limit(20).toArray();
  if (!keys.length) return bot.sendMessage(chatId, '📋 Ключей нет.');
  const lines = keys.map(k => {
    const exp = k.expiresAt ? new Date(k.expiresAt).toLocaleDateString('ru') : '∞';
    const status = k.status || 'active';
    return `<code>${k.key}</code> | ${k.playerId || '—'} | ${exp} | ${status}`;
  });
  bot.sendMessage(chatId, `🔑 <b>КЛЮЧИ (последние 20):</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
});

// ─── /players — список игроков ────────────────────────────────────────────────
bot.onText(/\/players/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const players = await db.collection('players').find({}).limit(20).toArray();
  if (!players.length) return bot.sendMessage(chatId, '👥 Игроков нет.');
  const lines = players.map(p => `<code>${p.playerId}</code> | <b>${p.balance || 0} KGS</b> | ключ: ${p.key || '—'}`);
  bot.sendMessage(chatId, `👥 <b>ИГРОКИ (последние 20):</b>\n\n${lines.join('\n')}`, { parse_mode: 'HTML' });
});

// ─── /cancel_withdraw — вернуть сумму игроку ─────────────────────────────────
bot.onText(/\/cancel_withdraw\s+(\S+)\s+(\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const playerId = match[1].toUpperCase();
  const amount = Number(match[2]);
  await db.collection('players').updateOne({ playerId }, { $inc: { balance: amount } });
  bot.sendMessage(chatId, `↩️ Возвращено <b>${amount} KGS</b> игроку <code>${playerId}</code>`, { parse_mode: 'HTML' });
});

// ─── ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ (состояния) ───────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text || text.startsWith('/')) return;
  if (!isAdmin(chatId)) return;

  const state = states[chatId];
  if (!state) return;

  if (state.action === 'deposit_id') {
    states[chatId] = { action: 'deposit_amount', playerId: text.toUpperCase() };
    bot.sendMessage(chatId, `💰 Игрок: <b>${text.toUpperCase()}</b>\nВведи сумму (KGS):`, { parse_mode: 'HTML' });
  }
  else if (state.action === 'deposit_amount') {
    const amount = Number(text);
    if (isNaN(amount) || amount <= 0) return bot.sendMessage(chatId, '❌ Введи корректную сумму.');
    delete states[chatId];
    await doDeposit(chatId, state.playerId, amount);
  }
  else if (state.action === 'balance_id') {
    delete states[chatId];
    const player = await db.collection('players').findOne({ playerId: text.toUpperCase() });
    if (!player) return bot.sendMessage(chatId, `❌ Игрок не найден.`);
    bot.sendMessage(chatId,
      `💼 Айди: <code>${player.playerId}</code>\nБаланс: <b>${player.balance || 0} KGS</b>`,
      { parse_mode: 'HTML' }
    );
  }
  else if (state.action === 'addkey_key') {
    states[chatId] = { action: 'addkey_days', key: text.toUpperCase() };
    bot.sendMessage(chatId, `🔑 Ключ: <b>${text.toUpperCase()}</b>\nНа сколько дней? (0 = бессрочный):`, { parse_mode: 'HTML' });
  }
  else if (state.action === 'addkey_days') {
    const days = Number(text);
    const expiresAt = days > 0 ? Date.now() + days * 86400000 : null;
    delete states[chatId];
    await db.collection('keys').insertOne({ key: state.key, status: 'active', expiresAt, createdAt: Date.now() });
    bot.sendMessage(chatId,
      `✅ Ключ <code>${state.key}</code> добавлен!\n${days > 0 ? `Действует ${days} дн.` : 'Бессрочный'}`,
      { parse_mode: 'HTML' }
    );
  }
});

console.log('🤖 Бот запущен...');
