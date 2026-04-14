const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN || '8778762497:AAEpXb9BCdyztC1YQRJaGTSL4IIGrZC8dJ0';
const ADMIN_IDS = (process.env.ADMIN_IDS || '8572856251').split(',').map(s => s.trim());
const API_URL   = process.env.API_URL || 'https://king-signal-server.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: false });
const states = {};

function isAdmin(chatId) {
  return ADMIN_IDS.includes(String(chatId));
}

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (isAdmin(chatId)) {
    bot.sendMessage(chatId,
      `👑 <b>KING SIGNAL — ADMIN</b>\n\n` +
      `/addplayer — добавить игрока\n` +
      `/players — список игроков\n` +
      `/info ID — инфо об игроке\n` +
      `/ban ID — заблокировать\n` +
      `/unban ID — разблокировать`,
      { parse_mode: 'HTML' }
    );
  } else {
    bot.sendMessage(chatId,
      `👑 <b>KING SIGNAL</b>\n\nБот только для администраторов.\nДоступ: @vivoxz`,
      { parse_mode: 'HTML' }
    );
  }
});

bot.onText(/\/addplayer/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  states[chatId] = { action: 'addplayer_id' };
  bot.sendMessage(chatId,
    `➕ <b>ДОБАВИТЬ ИГРОКА</b>\n\nШаг 1/3 — Введи <b>Айди</b>:\n<i>Пример: PLAYER001</i>`,
    { parse_mode: 'HTML' }
  );
});

bot.onText(/\/ban(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const parts = (match[1] || '').split(' ');
  const id = parts[0];
  if (!id) {
    states[chatId] = { action: 'ban_id' };
    return bot.sendMessage(chatId, `🔨 Введи Айди для блокировки:`);
  }
  const reason = parts.slice(1).join(' ') || 'Нарушение правил';
  await doBan(chatId, id.toUpperCase(), reason);
});

bot.onText(/\/unban(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const id = match[1];
  if (!id) {
    states[chatId] = { action: 'unban_id' };
    return bot.sendMessage(chatId, `✅ Введи Айди для разблокировки:`);
  }
  await doUnban(chatId, id.toUpperCase());
});

bot.onText(/\/info(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const id = match[1];
  if (!id) {
    states[chatId] = { action: 'info_id' };
    return bot.sendMessage(chatId, `🔍 Введи Айди игрока:`);
  }
  await doInfo(chatId, id.toUpperCase());
});

bot.onText(/\/players/, async (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  try {
    const res = await fetch(`${API_URL}/players`);
    const data = await res.json();
    if (!data.players || !data.players.length) {
      return bot.sendMessage(chatId, '👥 Игроков пока нет.');
    }
    let txt = `👥 <b>Игроки (${data.count})</b>\n\n`;
    data.players.slice(0, 20).forEach(p => {
      const icon = p.status === 'banned' ? '🔨' : p.status === 'frozen' ? '❄️' : '✅';
      txt += `${icon} <code>${p.playerId}</code>\n🔑 <code>${p.key}</code> | до: ${p.expires}\n\n`;
    });
    bot.sendMessage(chatId, txt, { parse_mode: 'HTML' });
  } catch (e) {
    bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text || text.startsWith('/')) return;
  if (!isAdmin(chatId)) return;
  const state = states[chatId];
  if (!state) return;

  if (state.action === 'addplayer_id') {
    states[chatId] = { action: 'addplayer_key', playerId: text.toUpperCase() };
    bot.sendMessage(chatId,
      `✅ Айди: <b>${text.toUpperCase()}</b>\n\nШаг 2/3 — Введи <b>Ключ</b>:\n<i>Пример: KING-ABC123</i>`,
      { parse_mode: 'HTML' }
    );
  }
  else if (state.action === 'addplayer_key') {
    states[chatId] = { action: 'addplayer_days', playerId: state.playerId, key: text.toUpperCase() };
    bot.sendMessage(chatId,
      `✅ Ключ: <b>${text.toUpperCase()}</b>\n\nШаг 3/3 — На сколько <b>дней</b>?\n<i>0 = бессрочный</i>`,
      { parse_mode: 'HTML' }
    );
  }
  else if (state.action === 'addplayer_days') {
    const days = parseInt(text, 10);
    if (isNaN(days) || days < 0) {
      return bot.sendMessage(chatId, '❌ Введи число (например: 30 или 0)');
    }
    delete states[chatId];
    await doAddPlayer(chatId, state.playerId, state.key, days);
  }
  else if (state.action === 'ban_id') {
    delete states[chatId];
    await doBan(chatId, text.toUpperCase(), 'Нарушение правил');
  }
  else if (state.action === 'unban_id') {
    delete states[chatId];
    await doUnban(chatId, text.toUpperCase());
  }
  else if (state.action === 'info_id') {
    delete states[chatId];
    await doInfo(chatId, text.toUpperCase());
  }
});

async function doAddPlayer(chatId, playerId, key, days) {
  try {
    const res = await fetch(`${API_URL}/addplayer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, key, days })
    });
    const data = await res.json();
    if (data.ok) {
      const expText = days > 0 ? `${days} дней` : 'Бессрочный';
      bot.sendMessage(chatId,
        `✅ <b>ИГРОК ДОБАВЛЕН!</b>\n\n` +
        `🆔 Айди: <code>${playerId}</code>\n` +
        `🔑 Ключ: <code>${key}</code>\n` +
        `📅 Срок: <b>${expText}</b>\n\n` +
        `📨 Отправь игроку:\n` +
        `———————————————\n` +
        `🆔 Айди: <code>${playerId}</code>\n` +
        `🔑 Ключ: <code>${key}</code>\n` +
        `———————————————`,
        { parse_mode: 'HTML' }
      );
    } else {
      bot.sendMessage(chatId, `❌ Ошибка: ${data.message}`);
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Нет связи с сервером: ${e.message}`);
  }
}

async function doBan(chatId, playerId, reason) {
  try {
    const res = await fetch(`${API_URL}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId, reason })
    });
    const data = await res.json();
    bot.sendMessage(chatId, data.ok
      ? `🔨 Игрок <code>${playerId}</code> заблокирован`
      : `❌ ${data.message}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) { bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`); }
}

async function doUnban(chatId, playerId) {
  try {
    const res = await fetch(`${API_URL}/unban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId })
    });
    const data = await res.json();
    bot.sendMessage(chatId, data.ok
      ? `✅ Игрок <code>${playerId}</code> разблокирован`
      : `❌ ${data.message}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) { bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`); }
}

async function doInfo(chatId, playerId) {
  try {
    const res = await fetch(`${API_URL}/players`);
    const data = await res.json();
    const p = (data.players || []).find(x => x.playerId === playerId);
    if (!p) return bot.sendMessage(chatId, `❌ Игрок <code>${playerId}</code> не найден`, { parse_mode: 'HTML' });
    const icon = p.status === 'banned' ? '🔨' : p.status === 'frozen' ? '❄️' : '✅';
    bot.sendMessage(chatId,
      `👤 <b>${p.playerId}</b>\n\n` +
      `🔑 Ключ: <code>${p.key}</code>\n` +
      `📅 До: ${p.expires}\n` +
      `${icon} Статус: ${p.status}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) { bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`); }
}

console.log('🤖 KING SIGNAL Бот запущен...');
