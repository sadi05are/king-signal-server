const TelegramBot = require('node-telegram-bot-api');

const BOT_TOKEN = process.env.BOT_TOKEN || '8639490181:AAHlTgtVDsRuohlt0ZgcGV2h0J4vz7o5pLQ';
const ADMIN_IDS = (process.env.ADMIN_IDS || '6697505756').split(',').map(s => s.trim());
const API_URL   = process.env.API_URL || 'https://king-signal-server.onrender.com';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Состояния диалога
const states = {};

function isAdmin(chatId) {
  return ADMIN_IDS.includes(String(chatId));
}

// ── /start ────────────────────────────────────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  if (isAdmin(chatId)) {
    bot.sendMessage(chatId,
      `👑 <b>KING SIGNAL — ADMIN PANEL</b>\n\n` +
      `Команды:\n` +
      `/addplayer — добавить нового игрока\n` +
      `/players — список всех игроков\n` +
      `/ban ID — заблокировать игрока\n` +
      `/unban ID — разблокировать игрока\n` +
      `/info ID — инфо об игроке`,
      { parse_mode: 'HTML' }
    );
  } else {
    bot.sendMessage(chatId,
      `👑 <b>KING SIGNAL</b>\n\nЭтот бот только для администраторов.\nДля получения доступа: @vivoxz`,
      { parse_mode: 'HTML' }
    );
  }
});

// ── /addplayer — добавить игрока ──────────────────────────────────────────────
bot.onText(/\/addplayer/, (msg) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  states[chatId] = { action: 'addplayer_id' };
  bot.sendMessage(chatId,
    `➕ <b>ДОБАВИТЬ ИГРОКА</b>\n\nШаг 1/3 — Введи <b>Айди</b> игрока:\n<i>(например: PLAYER001)</i>`,
    { parse_mode: 'HTML' }
  );
});

// ── /ban ──────────────────────────────────────────────────────────────────────
bot.onText(/\/ban(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const id = match[1];
  if (!id) {
    states[chatId] = { action: 'ban_id' };
    return bot.sendMessage(chatId, `🔨 Введи Айди игрока для блокировки:`, { parse_mode: 'HTML' });
  }
  await doBan(chatId, id.toUpperCase());
});

// ── /unban ────────────────────────────────────────────────────────────────────
bot.onText(/\/unban(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const id = match[1];
  if (!id) {
    states[chatId] = { action: 'unban_id' };
    return bot.sendMessage(chatId, `✅ Введи Айди игрока для разблокировки:`, { parse_mode: 'HTML' });
  }
  await doUnban(chatId, id.toUpperCase());
});

// ── /info ─────────────────────────────────────────────────────────────────────
bot.onText(/\/info(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  if (!isAdmin(chatId)) return;
  const id = match[1];
  if (!id) {
    states[chatId] = { action: 'info_id' };
    return bot.sendMessage(chatId, `🔍 Введи Айди игрока:`, { parse_mode: 'HTML' });
  }
  await doInfo(chatId, id.toUpperCase());
});

// ── /players ──────────────────────────────────────────────────────────────────
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
      const icon = p.banned ? '🔨' : p.frozen ? '❄️' : '✅';
      const exp = p.expiresAt || '∞';
      txt += `${icon} <code>${p.playerId}</code>\n🔑 <code>${p.key}</code> | до: ${exp}\n\n`;
    });
    bot.sendMessage(chatId, txt, { parse_mode: 'HTML' });
  } catch (e) {
    bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
});

// ── ОБРАБОТКА ТЕКСТА (пошаговые диалоги) ─────────────────────────────────────
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = (msg.text || '').trim();
  if (!text || text.startsWith('/')) return;
  if (!isAdmin(chatId)) return;

  const state = states[chatId];
  if (!state) return;

  // ── Добавление игрока: шаг 1 — Айди
  if (state.action === 'addplayer_id') {
    states[chatId] = { action: 'addplayer_key', playerId: text.toUpperCase() };
    bot.sendMessage(chatId,
      `➕ Айди: <b>${text.toUpperCase()}</b>\n\nШаг 2/3 — Введи <b>Ключ</b> для этого игрока:\n<i>(например: KING-ABC123)</i>`,
      { parse_mode: 'HTML' }
    );
  }

  // ── Добавление игрока: шаг 2 — Ключ
  else if (state.action === 'addplayer_key') {
    states[chatId] = { action: 'addplayer_days', playerId: state.playerId, key: text.toUpperCase() };
    bot.sendMessage(chatId,
      `➕ Ключ: <b>${text.toUpperCase()}</b>\n\nШаг 3/3 — На сколько <b>дней</b> доступ?\n<i>(введи 0 для бессрочного)</i>`,
      { parse_mode: 'HTML' }
    );
  }

  // ── Добавление игрока: шаг 3 — Дни → сохраняем
  else if (state.action === 'addplayer_days') {
    const days = parseInt(text, 10);
    if (isNaN(days) || days < 0) {
      return bot.sendMessage(chatId, '❌ Введи число (например: 30 или 0)');
    }
    delete states[chatId];
    await doAddPlayer(chatId, state.playerId, state.key, days);
  }

  // ── Бан
  else if (state.action === 'ban_id') {
    delete states[chatId];
    await doBan(chatId, text.toUpperCase());
  }

  // ── Разбан
  else if (state.action === 'unban_id') {
    delete states[chatId];
    await doUnban(chatId, text.toUpperCase());
  }

  // ── Инфо
  else if (state.action === 'info_id') {
    delete states[chatId];
    await doInfo(chatId, text.toUpperCase());
  }
});

// ── ФУНКЦИИ ───────────────────────────────────────────────────────────────────

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
        `Отправь игроку его данные:\n` +
        `——————————\n` +
        `🆔 Айди: <code>${playerId}</code>\n` +
        `🔑 Ключ: <code>${key}</code>\n` +
        `——————————`,
        { parse_mode: 'HTML' }
      );
    } else {
      bot.sendMessage(chatId, `❌ Ошибка: ${data.message}`);
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Нет соединения с сервером: ${e.message}`);
  }
}

async function doBan(chatId, playerId) {
  try {
    const res = await fetch(`${API_URL}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId })
    });
    const data = await res.json();
    if (data.ok) {
      bot.sendMessage(chatId, `🔨 Игрок <code>${playerId}</code> заблокирован`, { parse_mode: 'HTML' });
    } else {
      bot.sendMessage(chatId, `❌ ${data.message}`);
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

async function doUnban(chatId, playerId) {
  try {
    const res = await fetch(`${API_URL}/unban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId })
    });
    const data = await res.json();
    if (data.ok) {
      bot.sendMessage(chatId, `✅ Игрок <code>${playerId}</code> разблокирован`, { parse_mode: 'HTML' });
    } else {
      bot.sendMessage(chatId, `❌ ${data.message}`);
    }
  } catch (e) {
    bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

async function doInfo(chatId, playerId) {
  try {
    const res = await fetch(`${API_URL}/players`);
    const data = await res.json();
    const p = (data.players || []).find(x => x.playerId === playerId);
    if (!p) return bot.sendMessage(chatId, `❌ Игрок <code>${playerId}</code> не найден`, { parse_mode: 'HTML' });
    const icon = p.banned ? '🔨 Забанен' : p.frozen ? '❄️ Заморожен' : '✅ Активен';
    bot.sendMessage(chatId,
      `👤 <b>Игрок: ${p.playerId}</b>\n\n` +
      `🔑 Ключ: <code>${p.key}</code>\n` +
      `📅 До: ${p.expiresAt || '∞'}\n` +
      `🚦 Статус: ${icon}`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    bot.sendMessage(chatId, `❌ Ошибка: ${e.message}`);
  }
}

console.log('🤖 KING SIGNAL Бот запущен...');
