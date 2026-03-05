const express = require('express');
const cors = require('cors');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = '8639490181:AAHlTgtVDsRuohlt0ZgcGV2h0J4vz7o5pLQ';
const ADMIN_ID = '6697505756';
const PLAYERS_FILE = './players.json';

// ══════════════════════════════════════════════════
// PLAYERS DB
// ══════════════════════════════════════════════════
function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
  catch { return {}; }
}
function savePlayers(data) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(data, null, 2));
}

// ══════════════════════════════════════════════════
// ROUND SYSTEM — общий раунд для всех игроков
// ══════════════════════════════════════════════════
const WAIT_MS   = 7000;   // 7 сек приём ставок
const MAX_FLIGHT = 20000; // макс 20 сек полёт

let currentRound = null;

function genCrashAt(seed, isAvi = false) {
  let x = seed;
  x = ((x >> 16) ^ x) * 0x45d9f3b | 0;
  x = ((x >> 16) ^ x) * 0x45d9f3b | 0;
  x = (x >> 16) ^ x;
  const r = Math.abs(x) / 0x7fffffff;
  if (isAvi) {
    if (r < 0.35) return +(1 + r * 1.2).toFixed(2);
    if (r < 0.60) return +(1.42 + r * 2).toFixed(2);
    if (r < 0.78) return +(2.62 + r * 5).toFixed(2);
    if (r < 0.90) return +(7 + r * 15).toFixed(2);
    if (r < 0.97) return +(22 + r * 30).toFixed(2);
    return +(52 + r * 150).toFixed(2);
  }
  if (r < 0.50) return +(1 + r * 0.8).toFixed(2);
  if (r < 0.72) return +(1.4 + r * 1.5).toFixed(2);
  if (r < 0.87) return +(2.8 + r * 5).toFixed(2);
  if (r < 0.95) return +(7.8 + r * 12).toFixed(2);
  if (r < 0.99) return +(19 + r * 15).toFixed(2);
  return +(34 + r * 66).toFixed(2);
}

function newRound() {
  const seed = Math.floor(Math.random() * 0x7fffffff);
  const now = Date.now();
  currentRound = {
    id: now,
    seed,
    crashAt:    genCrashAt(seed, false),
    aviCrashAt: genCrashAt(seed + 1, true),
    startAt:    now + WAIT_MS,       // старт полёта
    phase: 'waiting',                // waiting | flying | crashed
  };
  // Автопереход: ждём WAIT_MS, потом летим, потом краш
  setTimeout(() => {
    if (currentRound && currentRound.id === now) {
      currentRound.phase = 'flying';
    }
  }, WAIT_MS);

  // Рассчитаем время краша по множителю
  // mult(t) = 1.055^(t*2.2) = crashAt => t = log(crashAt)/log(1.055)/2.2
  const flightMs = Math.min(
    Math.ceil(Math.log(currentRound.crashAt) / Math.log(1.055) / 2.2 * 1000) + 300,
    MAX_FLIGHT
  );
  setTimeout(() => {
    if (currentRound && currentRound.id === now) {
      currentRound.phase = 'crashed';
      // Начать новый раунд через 4 сек
      setTimeout(newRound, 4000);
    }
  }, WAIT_MS + flightMs);

  console.log(`🎮 Новый раунд #${now} | Crash: x${currentRound.crashAt} | Avi: x${currentRound.aviCrashAt} | Старт через ${WAIT_MS/1000}с`);
}

// Запускаем первый раунд при старте
newRound();

// ══════════════════════════════════════════════════
// TELEGRAM
// ══════════════════════════════════════════════════
function sendTelegram(chatId, text) {
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const opts = {
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  };
  const req = https.request(opts);
  req.on('error', () => {});
  req.write(body);
  req.end();
}

// ══════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════

// Текущий раунд — главный эндпоинт для синхронизации
app.get('/round', (req, res) => {
  if (!currentRound) return res.json({ error: 'no round' });
  res.json({
    id:         currentRound.id,
    seed:       currentRound.seed,
    crashAt:    currentRound.crashAt,
    aviCrashAt: currentRound.aviCrashAt,
    startAt:    currentRound.startAt,
    phase:      currentRound.phase,
    serverTime: Date.now()
  });
});

// Регистрация
app.post('/register', (req, res) => {
  const { email, pass, id } = req.body;
  if (!email || !pass || !id) return res.json({ ok: false, message: 'Неверные данные' });
  const players = loadPlayers();
  if (players[id]) return res.json({ ok: false, message: 'ID уже существует' });

  players[id] = {
    id, email,
    pass: pass, // в реальном проекте надо хэшировать
    balance: 1000,
    createdAt: Date.now(),
    banned: false
  };
  savePlayers(players);

  sendTelegram(ADMIN_ID,
    `🆕 <b>НОВЫЙ ИГРОК MRWIN</b>\n\n` +
    `🆔 ID: <code>${id}</code>\n` +
    `📧 Email: <code>${email}</code>\n` +
    `💰 Стартовый баланс: 1000 KGS\n` +
    `📅 ${new Date().toLocaleString('ru')}\n\n` +
    `🔨 Забанить: /ban ${id}\n` +
    `💳 Начислить: /deposit ${id} СУММА`
  );

  res.json({ ok: true, balance: 1000 });
});

// Вход
app.post('/login', (req, res) => {
  const { email, pass } = req.body;
  if (!email || !pass) return res.json({ ok: false, message: 'Неверные данные' });
  const players = loadPlayers();
  const player = Object.values(players).find(p => p.email === email);
  if (!player) return res.json({ ok: false, message: 'Email не найден' });
  if (player.pass !== pass) return res.json({ ok: false, message: 'Неверный пароль' });
  if (player.banned) return res.json({ ok: false, message: 'Аккаунт заблокирован' });
  res.json({ ok: true, id: player.id, balance: player.balance || 1000 });
});

// Баланс
app.get('/balance', (req, res) => {
  const { player_id } = req.query;
  const players = loadPlayers();
  const p = players[player_id];
  if (!p) return res.json({ balance: 0 });
  res.json({ balance: p.balance || 0 });
});

// Обновить баланс
app.post('/balance/update', (req, res) => {
  const { player_id, balance } = req.body;
  const players = loadPlayers();
  if (!players[player_id]) return res.json({ ok: false });
  players[player_id].balance = balance;
  savePlayers(players);
  res.json({ ok: true, balance });
});

// Заявка на пополнение
app.post('/deposit/request', (req, res) => {
  const { playerId } = req.body;
  const players = loadPlayers();
  const p = players[playerId];
  sendTelegram(ADMIN_ID,
    `💰 <b>ПОПОЛНЕНИЕ MRWIN</b>\n\n` +
    `🆔 ID: <code>${playerId}</code>\n` +
    `📧 Email: <code>${p ? p.email : '?'}</code>\n` +
    `💳 Баланс: ${p ? p.balance : 0} KGS\n\n` +
    `Начислить: /deposit ${playerId} СУММА`
  );
  res.json({ ok: true });
});

// Начислить баланс (команда /deposit ID СУММА через бота)
app.post('/deposit/add', (req, res) => {
  const { playerId, amount, adminKey } = req.body;
  if (adminKey !== 'MRWIN_ADMIN_2024') return res.json({ ok: false, message: 'Нет доступа' });
  const players = loadPlayers();
  if (!players[playerId]) return res.json({ ok: false, message: 'Игрок не найден' });
  players[playerId].balance = (players[playerId].balance || 0) + Number(amount);
  savePlayers(players);
  sendTelegram(ADMIN_ID, `✅ Начислено <b>${amount} KGS</b> игроку <code>${playerId}</code>\nНовый баланс: ${players[playerId].balance} KGS`);
  res.json({ ok: true, balance: players[playerId].balance });
});

// Заявка на вывод
app.post('/withdraw/request', (req, res) => {
  const { playerId, amount, bank, cardNumber } = req.body;
  const players = loadPlayers();
  const p = players[playerId];
  if (!p) return res.json({ ok: false, message: 'Игрок не найден' });
  if (p.balance < amount) return res.json({ ok: false, message: 'Недостаточно средств' });
  p.balance -= amount;
  savePlayers(players);
  sendTelegram(ADMIN_ID,
    `📤 <b>ВЫВОД MRWIN</b>\n\n` +
    `🆔 ID: <code>${playerId}</code>\n` +
    `📧 Email: <code>${p.email}</code>\n` +
    `💰 Сумма: <b>${amount} KGS</b>\n` +
    `🏦 Банк: <b>${bank}</b>\n` +
    `💳 Реквизиты: <code>${cardNumber}</code>\n` +
    `💳 Остаток: ${p.balance} KGS`
  );
  res.json({ ok: true });
});

// Бан игрока
app.post('/ban', (req, res) => {
  const { playerId, adminKey } = req.body;
  if (adminKey !== 'MRWIN_ADMIN_2024') return res.json({ ok: false });
  const players = loadPlayers();
  if (!players[playerId]) return res.json({ ok: false, message: 'Не найден' });
  players[playerId].banned = true;
  savePlayers(players);
  res.json({ ok: true });
});

// Список игроков (только для тебя)
app.get('/players', (req, res) => {
  const { adminKey } = req.query;
  if (adminKey !== 'MRWIN_ADMIN_2024') return res.status(403).json({ error: 'Нет доступа' });
  const players = loadPlayers();
  const list = Object.values(players).map(p => ({
    id: p.id, email: p.email, balance: p.balance, banned: p.banned,
    createdAt: new Date(p.createdAt).toLocaleString('ru')
  }));
  res.json({ count: list.length, players: list });
});

// ══════════════════════════════════════════════════
// TELEGRAM BOT WEBHOOK (команды админа)
// ══════════════════════════════════════════════════
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  const msg = req.body.message;
  if (!msg || String(msg.chat.id) !== ADMIN_ID) return res.json({});

  const text = msg.text || '';
  const parts = text.split(' ');
  const cmd = parts[0];

  if (cmd === '/deposit' && parts.length >= 3) {
    const pid = parts[1], amt = Number(parts[2]);
    const players = loadPlayers();
    if (!players[pid]) { sendTelegram(ADMIN_ID, `❌ Игрок ${pid} не найден`); return res.json({}); }
    players[pid].balance = (players[pid].balance || 0) + amt;
    savePlayers(players);
    sendTelegram(ADMIN_ID, `✅ Начислено <b>${amt} KGS</b> игроку <code>${pid}</code>\nНовый баланс: <b>${players[pid].balance} KGS</b>`);
  }

  else if (cmd === '/ban' && parts.length >= 2) {
    const pid = parts[1];
    const players = loadPlayers();
    if (!players[pid]) { sendTelegram(ADMIN_ID, `❌ Игрок ${pid} не найден`); return res.json({}); }
    players[pid].banned = true;
    savePlayers(players);
    sendTelegram(ADMIN_ID, `🔨 Игрок <code>${pid}</code> заблокирован`);
  }

  else if (cmd === '/unban' && parts.length >= 2) {
    const pid = parts[1];
    const players = loadPlayers();
    if (players[pid]) { players[pid].banned = false; savePlayers(players); }
    sendTelegram(ADMIN_ID, `✅ Игрок <code>${pid}</code> разблокирован`);
  }

  else if (cmd === '/balance' && parts.length >= 2) {
    const pid = parts[1];
    const players = loadPlayers();
    const p = players[pid];
    if (!p) { sendTelegram(ADMIN_ID, `❌ Не найден`); return res.json({}); }
    sendTelegram(ADMIN_ID, `💰 Игрок <code>${pid}</code>\nEmail: ${p.email}\nБаланс: <b>${p.balance} KGS</b>\nСтатус: ${p.banned ? '🔨 Забанен' : '✅ Активен'}`);
  }

  else if (cmd === '/players') {
    const players = loadPlayers();
    const list = Object.values(players);
    let txt = `👥 <b>Игроки MRWIN (${list.length})</b>\n\n`;
    list.slice(0, 20).forEach(p => {
      txt += `${p.banned ? '🔨' : '✅'} <code>${p.id}</code> — ${p.email} — ${p.balance} KGS\n`;
    });
    if (list.length > 20) txt += `\n...и ещё ${list.length - 20}`;
    sendTelegram(ADMIN_ID, txt);
  }

  else if (cmd === '/round') {
    const r = currentRound;
    if (!r) { sendTelegram(ADMIN_ID, 'Нет активного раунда'); return res.json({}); }
    sendTelegram(ADMIN_ID,
      `🎮 <b>Текущий раунд</b>\n\nФаза: ${r.phase}\nCrash: x${r.crashAt}\nAviator: x${r.aviCrashAt}\nСтарт: ${new Date(r.startAt).toLocaleTimeString('ru')}`
    );
  }

  else if (cmd === '/help') {
    sendTelegram(ADMIN_ID,
      `📋 <b>Команды MRWIN</b>\n\n` +
      `/deposit ID СУММА — начислить KGS\n` +
      `/ban ID — заблокировать\n` +
      `/unban ID — разблокировать\n` +
      `/balance ID — баланс игрока\n` +
      `/players — список игроков\n` +
      `/round — текущий раунд`
    );
  }

  res.json({});
});

// Установить webhook
app.get('/set-webhook', async (req, res) => {
  const url = `https://king-signal-server.onrender.com/webhook/${BOT_TOKEN}`;
  const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${url}`;
  https.get(apiUrl, r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => res.json(JSON.parse(d)));
  });
});

app.get('/', (req, res) => res.json({ status: 'MRWIN Server OK', round: currentRound?.phase || 'none' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ MRWIN Server запущен на порту ${PORT}`);
  // Установить webhook автоматически
  setTimeout(() => {
    const url = `https://king-signal-server.onrender.com/webhook/${BOT_TOKEN}`;
    const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`;
    https.get(apiUrl, () => console.log('✅ Webhook установлен'));
  }, 3000);
});
