const express = require('express');
const cors = require('cors');
const fs = require('fs');
const https = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN   = process.env.BOT_TOKEN || '8639490181:AAHlTgtVDsRuohlt0ZgcGV2h0J4vz7o5pLQ';
const ADMIN_ID    = process.env.ADMIN_ID  || '6697505756';
const PLAYERS_FILE = './players.json';

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
  catch { return {}; }
}
function savePlayers(data) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(data, null, 2));
}

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
  req.write(body); req.end();
}

app.get('/check', (req, res) => {
  const { key, player_id } = req.query;
  if (!key || !player_id) return res.json({ status: 'error', message: 'Введи Айди и ключ' });
  const players = loadPlayers();
  const p = players[player_id.toUpperCase()];
  if (!p) return res.json({ status: 'error', message: '✕ Айди не найден' });
  if (p.key !== key.toUpperCase()) return res.json({ status: 'error', message: '✕ Неверный ключ' });
  if (p.status === 'banned')      return res.json({ status: 'banned', message: p.ban_reason || 'Аккаунт заблокирован.' });
  if (p.status === 'frozen')      return res.json({ status: 'frozen', message: 'Аккаунт заморожен.' });
  if (p.status === 'maintenance') return res.json({ status: 'maintenance', message: 'Технические работы.' });
  if (p.expires && new Date(p.expires) < new Date()) return res.json({ status: 'expired' });
  const expiresIn = p.expires ? new Date(p.expires).getTime() - Date.now() : null;
  res.json({ status: 'ok', key: p.key, playerId: player_id.toUpperCase(), nick: p.nick || null, expiresIn });
});

app.post('/addplayer', (req, res) => {
  const { playerId, key, days } = req.body;
  if (!playerId || !key) return res.json({ ok: false, message: 'Нужен playerId и key' });
  const players = loadPlayers();
  const id = playerId.toUpperCase();
  const k  = key.toUpperCase();
  if (players[id]) return res.json({ ok: false, message: 'Этот Айди уже существует' });
  const expires = days && days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  players[id] = {
    key: k, balance: 0, status: 'ok',
    expires, registered: true,
    created: new Date().toISOString(), nick: id
  };
  savePlayers(players);
  sendTelegram(ADMIN_ID,
    `🆕 <b>НОВЫЙ ИГРОК</b>\n\n🆔 <code>${id}</code>\n🔑 <code>${k}</code>\n📅 ${days > 0 ? days + ' дней' : 'Бессрочный'}`
  );
  res.json({ ok: true, playerId: id, key: k, expires });
});

app.post('/ban', (req, res) => {
  const { playerId, reason } = req.body;
  const players = loadPlayers();
  const id = (playerId || '').toUpperCase();
  if (!players[id]) return res.json({ ok: false, message: 'Не найден' });
  players[id].status = 'banned';
  players[id].ban_reason = reason || 'Нарушение правил';
  savePlayers(players);
  res.json({ ok: true });
});

app.post('/unban', (req, res) => {
  const { playerId } = req.body;
  const players = loadPlayers();
  const id = (playerId || '').toUpperCase();
  if (!players[id]) return res.json({ ok: false, message: 'Не найден' });
  players[id].status = 'ok';
  delete players[id].ban_reason;
  savePlayers(players);
  res.json({ ok: true });
});

app.get('/players', (req, res) => {
  const players = loadPlayers();
  const list = Object.entries(players).map(([id, p]) => ({
    playerId: id, key: p.key, nick: p.nick || id,
    status: p.status,
    expires: p.expires ? new Date(p.expires).toLocaleString('ru') : '∞',
    created: p.created ? new Date(p.created).toLocaleString('ru') : '—'
  }));
  res.json({ count: list.length, players: list });
});

app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  const msg = req.body.message;
  if (!msg || String(msg.chat.id) !== ADMIN_ID) return res.json({});
  const text  = (msg.text || '').trim();
  const parts = text.split(' ');
  const cmd   = parts[0];

  if (cmd === '/ban' && parts[1]) {
    const id = parts[1].toUpperCase();
    const reason = parts.slice(2).join(' ') || 'Нарушение правил';
    const players = loadPlayers();
    if (!players[id]) { sendTelegram(ADMIN_ID, `❌ <code>${id}</code> не найден`); return res.json({}); }
    players[id].status = 'banned';
    players[id].ban_reason = reason;
    savePlayers(players);
    sendTelegram(ADMIN_ID, `🔨 <code>${id}</code> заблокирован`);
  }
  else if (cmd === '/unban' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    if (!players[id]) { sendTelegram(ADMIN_ID, `❌ Не найден`); return res.json({}); }
    players[id].status = 'ok';
    delete players[id].ban_reason;
    savePlayers(players);
    sendTelegram(ADMIN_ID, `✅ <code>${id}</code> разблокирован`);
  }
  else if (cmd === '/info' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    const p = players[id];
    if (!p) { sendTelegram(ADMIN_ID, `❌ Не найден`); return res.json({}); }
    const exp = p.expires ? new Date(p.expires).toLocaleString('ru') : '∞';
    const icon = p.status === 'banned' ? '🔨' : p.status === 'frozen' ? '❄️' : '✅';
    sendTelegram(ADMIN_ID, `👤 <b>${id}</b>\n🔑 <code>${p.key}</code>\n📅 ${exp}\n${icon} ${p.status}`);
  }
  else if (cmd === '/players') {
    const players = loadPlayers();
    const list = Object.entries(players);
    let txt = `👥 <b>Игроки (${list.length})</b>\n\n`;
    list.slice(0, 20).forEach(([id, p]) => {
      const icon = p.status === 'banned' ? '🔨' : '✅';
      txt += `${icon} <code>${id}</code> — <code>${p.key}</code>\n`;
    });
    sendTelegram(ADMIN_ID, txt);
  }
  else if (cmd === '/help') {
    sendTelegram(ADMIN_ID, `📋 <b>Команды</b>\n\n/ban ID\n/unban ID\n/info ID\n/players`);
  }
  res.json({});
});

app.get('/set-webhook', (req, res) => {
  const url = `https://king-signal-server.onrender.com/webhook/${BOT_TOKEN}`;
  https.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res.json(JSON.parse(d)));
  });
});

app.get('/', (req, res) => res.json({ status: 'KING SIGNAL OK' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server на порту ${PORT}`);
  setTimeout(() => {
    const url = `https://king-signal-server.onrender.com/webhook/${BOT_TOKEN}`;
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`, () => {});
  }, 3000);
});
