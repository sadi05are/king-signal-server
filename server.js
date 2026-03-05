const express = require('express');
const cors = require('cors');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN  = process.env.BOT_TOKEN  || '8639490181:AAHlTgtVDsRuohlt0ZgcGV2h0J4vz7o5pLQ';
const ADMIN_ID   = process.env.ADMIN_ID   || '6697505756';
const PLAYERS_FILE = './players.json';

// ══════════════════════════════════════════════════
// PLAYERS DB (players.json)
// Структура: { "PLAYER_ID": { key, playerId, expiresAt, banned, frozen, createdAt } }
// ══════════════════════════════════════════════════
function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
  catch { return {}; }
}
function savePlayers(data) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(data, null, 2));
}

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
// ГЛАВНЫЙ ЭНДПОИНТ — проверка ключа
// GET /check?key=XXXX&player_id=YYYY
// ══════════════════════════════════════════════════
app.get('/check', (req, res) => {
  const { key, player_id } = req.query;
  if (!key || !player_id) return res.json({ status: 'error', message: 'Введи Айди и ключ' });

  const players = loadPlayers();
  const p = players[player_id.toUpperCase()];

  if (!p) return res.json({ status: 'error', message: '✕ Айди не найден' });
  if (p.key !== key.toUpperCase()) return res.json({ status: 'error', message: '✕ Неверный ключ' });
  if (p.banned) return res.json({ status: 'banned', message: p.banReason || 'Ваш аккаунт заблокирован.' });
  if (p.frozen) return res.json({ status: 'frozen', message: p.freezeReason || 'Ваш аккаунт временно заморожен.' });

  // Проверка срока действия
  if (p.expiresAt && Date.now() > p.expiresAt) {
    return res.json({ status: 'expired' });
  }

  const expiresIn = p.expiresAt ? p.expiresAt - Date.now() : null;

  res.json({
    status: 'ok',
    key: p.key,
    playerId: p.playerId,
    expiresIn
  });
});

// ══════════════════════════════════════════════════
// ДОБАВИТЬ ИГРОКА (вызывается из бота)
// POST /addplayer { playerId, key, days, adminKey }
// ══════════════════════════════════════════════════
app.post('/addplayer', (req, res) => {
  const { playerId, key, days, adminKey } = req.body;
  if (adminKey !== process.env.ADMIN_SECRET || 'KING_ADMIN_SECRET') {
    // Простая защита
  }
  if (!playerId || !key) return res.json({ ok: false, message: 'Нужен playerId и key' });

  const players = loadPlayers();
  const id = playerId.toUpperCase();
  const k  = key.toUpperCase();

  if (players[id]) return res.json({ ok: false, message: 'Этот Айди уже существует' });

  const expiresAt = days && days > 0 ? Date.now() + days * 86400000 : null;

  players[id] = {
    playerId: id,
    key: k,
    expiresAt,
    banned: false,
    frozen: false,
    createdAt: Date.now()
  };
  savePlayers(players);

  res.json({ ok: true, playerId: id, key: k, expiresAt });
});

// ══════════════════════════════════════════════════
// БАН / РАЗБАН / ЗАМОРОЗКА
// ══════════════════════════════════════════════════
app.post('/ban', (req, res) => {
  const { playerId } = req.body;
  const players = loadPlayers();
  const id = (playerId || '').toUpperCase();
  if (!players[id]) return res.json({ ok: false, message: 'Не найден' });
  players[id].banned = true;
  savePlayers(players);
  res.json({ ok: true });
});

app.post('/unban', (req, res) => {
  const { playerId } = req.body;
  const players = loadPlayers();
  const id = (playerId || '').toUpperCase();
  if (!players[id]) return res.json({ ok: false, message: 'Не найден' });
  players[id].banned = false;
  savePlayers(players);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════════
// СПИСОК ИГРОКОВ
// ══════════════════════════════════════════════════
app.get('/players', (req, res) => {
  const players = loadPlayers();
  const list = Object.values(players).map(p => ({
    playerId: p.playerId,
    key: p.key,
    banned: p.banned,
    frozen: p.frozen,
    expiresAt: p.expiresAt ? new Date(p.expiresAt).toLocaleString('ru') : '∞',
    createdAt: new Date(p.createdAt).toLocaleString('ru')
  }));
  res.json({ count: list.length, players: list });
});

// ══════════════════════════════════════════════════
// WEBHOOK — команды из Telegram бота
// ══════════════════════════════════════════════════
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  const msg = req.body.message;
  if (!msg || String(msg.chat.id) !== ADMIN_ID) return res.json({});

  const text = (msg.text || '').trim();
  const parts = text.split(' ');
  const cmd = parts[0];

  if (cmd === '/ban' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    if (!players[id]) { sendTelegram(ADMIN_ID, `❌ Игрок <code>${id}</code> не найден`); return res.json({}); }
    players[id].banned = true;
    savePlayers(players);
    sendTelegram(ADMIN_ID, `🔨 Игрок <code>${id}</code> заблокирован`);
  }

  else if (cmd === '/unban' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    if (players[id]) { players[id].banned = false; savePlayers(players); }
    sendTelegram(ADMIN_ID, `✅ Игрок <code>${id}</code> разблокирован`);
  }

  else if (cmd === '/info' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    const p = players[id];
    if (!p) { sendTelegram(ADMIN_ID, `❌ Игрок <code>${id}</code> не найден`); return res.json({}); }
    const exp = p.expiresAt ? new Date(p.expiresAt).toLocaleString('ru') : '∞';
    sendTelegram(ADMIN_ID,
      `👤 <b>Игрок: ${id}</b>\n\n` +
      `🔑 Ключ: <code>${p.key}</code>\n` +
      `📅 До: ${exp}\n` +
      `🚦 Статус: ${p.banned ? '🔨 Забанен' : p.frozen ? '❄️ Заморожен' : '✅ Активен'}`
    );
  }

  else if (cmd === '/players') {
    const players = loadPlayers();
    const list = Object.values(players);
    let txt = `👥 <b>Игроки (${list.length})</b>\n\n`;
    list.slice(0, 20).forEach(p => {
      const icon = p.banned ? '🔨' : p.frozen ? '❄️' : '✅';
      txt += `${icon} <code>${p.playerId}</code> — ключ: <code>${p.key}</code>\n`;
    });
    if (list.length > 20) txt += `\n...и ещё ${list.length - 20}`;
    sendTelegram(ADMIN_ID, txt);
  }

  else if (cmd === '/help') {
    sendTelegram(ADMIN_ID,
      `📋 <b>KING SIGNAL — Команды</b>\n\n` +
      `/ban ID — заблокировать\n` +
      `/unban ID — разблокировать\n` +
      `/info ID — инфо об игроке\n` +
      `/players — список всех`
    );
  }

  res.json({});
});

// Установить webhook
app.get('/set-webhook', (req, res) => {
  const url = `https://king-signal-server.onrender.com/webhook/${BOT_TOKEN}`;
  const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`;
  https.get(apiUrl, r => {
    let d = '';
    r.on('data', c => d += c);
    r.on('end', () => res.json(JSON.parse(d)));
  });
});

app.get('/', (req, res) => res.json({ status: 'KING SIGNAL Server OK' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ KING SIGNAL Server запущен на порту ${PORT}`);
  // Установить webhook автоматически
  setTimeout(() => {
    const url = `https://king-signal-server.onrender.com/webhook/${BOT_TOKEN}`;
    const apiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`;
    https.get(apiUrl, () => console.log('✅ Webhook установлен'));
  }, 3000);
});
