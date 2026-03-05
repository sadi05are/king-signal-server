const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const https   = require('https');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN    = process.env.BOT_TOKEN || '8639490181:AAHlTgtVDsRuohlt0ZgcGV2h0J4vz7o5pLQ';
const ADMIN_ID     = process.env.ADMIN_ID  || '6697505756';
const PLAYERS_FILE = './players.json';

// ── Создать файл если нет ──
if (!fs.existsSync(PLAYERS_FILE)) {
  fs.writeFileSync(PLAYERS_FILE, '{}');
}

function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
  catch { return {}; }
}
function savePlayers(data) {
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(data, null, 2));
}

function sendTg(chatId, text) {
  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
  });
  req.on('error', () => {});
  req.write(body); req.end();
}

// ── Состояния диалога ──
const states = {};

// ── WEBHOOK ────────────────────────────────────
app.post(`/webhook/${BOT_TOKEN}`, (req, res) => {
  res.json({});
  const msg = req.body.message;
  if (!msg) return;

  const chatId = String(msg.chat.id);
  const text   = (msg.text || '').trim();
  const isAdmin = chatId === String(ADMIN_ID);

  // /start
  if (text === '/start') {
    if (isAdmin) {
      sendTg(chatId,
        `👑 <b>KING SIGNAL — ADMIN</b>\n\n` +
        `/addplayer — добавить игрока\n` +
        `/players — список игроков\n` +
        `/info ID — инфо об игроке\n` +
        `/ban ID — заблокировать\n` +
        `/unban ID — разблокировать\n` +
        `/balance ID СУММА — изменить баланс\n` +
        `/delete ID — удалить игрока`
      );
    } else {
      sendTg(chatId, `👑 <b>KING SIGNAL</b>\n\nБот только для администраторов.\nДоступ: @vivoxz`);
    }
    return;
  }

  if (!isAdmin) return;

  const parts = text.split(' ');
  const cmd   = parts[0];

  // ── КОМАНДЫ ──
  if (cmd === '/addplayer') {
    states[chatId] = { action: 'addplayer_id' };
    return sendTg(chatId, `➕ <b>ДОБАВИТЬ ИГРОКА</b>\n\nШаг 1/3 — Введи <b>Айди</b>:\n<i>Пример: PLAYER001</i>`);
  }

  if (cmd === '/players') {
    const players = loadPlayers();
    const list = Object.entries(players);
    if (!list.length) return sendTg(chatId, '👥 Игроков пока нет.');
    let txt = `👥 <b>Игроки (${list.length})</b>\n\n`;
    list.slice(0, 25).forEach(([id, p]) => {
      const icon = p.status === 'banned' ? '🔨' : p.status === 'frozen' ? '❄️' : '✅';
      const exp = p.expires ? new Date(p.expires).toLocaleDateString('ru') : '∞';
      txt += `${icon} <code>${id}</code>\n🔑 <code>${p.key}</code> | ${exp}\n\n`;
    });
    return sendTg(chatId, txt);
  }

  if (cmd === '/info' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    const p = players[id];
    if (!p) return sendTg(chatId, `❌ Игрок <code>${id}</code> не найден`);
    const icon = p.status === 'banned' ? '🔨' : p.status === 'frozen' ? '❄️' : '✅';
    const exp = p.expires ? new Date(p.expires).toLocaleString('ru') : '∞';
    return sendTg(chatId,
      `👤 <b>${id}</b>\n\n🔑 Ключ: <code>${p.key}</code>\n📅 До: ${exp}\n💰 Баланс: ${p.balance || 0} KGS\n${icon} Статус: ${p.status}${p.ban_reason ? '\n📌 Причина: ' + p.ban_reason : ''}`
    );
  }
  if (cmd === '/info' && !parts[1]) {
    states[chatId] = { action: 'info_id' };
    return sendTg(chatId, `🔍 Введи Айди игрока:`);
  }

  if (cmd === '/ban') {
    if (parts[1]) {
      const id = parts[1].toUpperCase();
      const reason = parts.slice(2).join(' ') || 'Нарушение правил';
      const players = loadPlayers();
      if (!players[id]) return sendTg(chatId, `❌ <code>${id}</code> не найден`);
      players[id].status = 'banned';
      players[id].ban_reason = reason;
      savePlayers(players);
      return sendTg(chatId, `🔨 Игрок <code>${id}</code> заблокирован\nПричина: ${reason}`);
    }
    states[chatId] = { action: 'ban_id' };
    return sendTg(chatId, `🔨 Введи Айди для блокировки:`);
  }

  if (cmd === '/unban') {
    if (parts[1]) {
      const id = parts[1].toUpperCase();
      const players = loadPlayers();
      if (!players[id]) return sendTg(chatId, `❌ <code>${id}</code> не найден`);
      players[id].status = 'ok';
      delete players[id].ban_reason;
      savePlayers(players);
      return sendTg(chatId, `✅ Игрок <code>${id}</code> разблокирован`);
    }
    states[chatId] = { action: 'unban_id' };
    return sendTg(chatId, `✅ Введи Айди для разблокировки:`);
  }

  if (cmd === '/balance' && parts[1] && parts[2]) {
    const id = parts[1].toUpperCase();
    const amount = Number(parts[2]);
    const players = loadPlayers();
    if (!players[id]) return sendTg(chatId, `❌ <code>${id}</code> не найден`);
    players[id].balance = amount;
    savePlayers(players);
    return sendTg(chatId, `💰 Баланс <code>${id}</code> установлен: <b>${amount} KGS</b>`);
  }

  if (cmd === '/delete' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    if (!players[id]) return sendTg(chatId, `❌ <code>${id}</code> не найден`);
    delete players[id];
    savePlayers(players);
    return sendTg(chatId, `🗑 Игрок <code>${id}</code> удалён`);
  }

  if (cmd === '/help') {
    return sendTg(chatId,
      `📋 <b>Команды:</b>\n\n/addplayer\n/players\n/info ID\n/ban ID причина\n/unban ID\n/balance ID СУММА\n/delete ID`
    );
  }

  // ── ДИАЛОГ (без команды) ──
  const state = states[chatId];
  if (!state || text.startsWith('/')) return;

  if (state.action === 'addplayer_id') {
    states[chatId] = { action: 'addplayer_key', playerId: text.toUpperCase() };
    return sendTg(chatId, `✅ Айди: <b>${text.toUpperCase()}</b>\n\nШаг 2/3 — Введи <b>Ключ</b>:\n<i>Пример: KING-ABC123</i>`);
  }
  if (state.action === 'addplayer_key') {
    states[chatId] = { action: 'addplayer_days', playerId: state.playerId, key: text.toUpperCase() };
    return sendTg(chatId, `✅ Ключ: <b>${text.toUpperCase()}</b>\n\nШаг 3/3 — На сколько <b>дней</b>?\n<i>0 = бессрочный</i>`);
  }
  if (state.action === 'addplayer_days') {
    const days = parseInt(text, 10);
    if (isNaN(days) || days < 0) return sendTg(chatId, '❌ Введи число (например: 30 или 0)');
    const { playerId, key } = state;
    delete states[chatId];
    const players = loadPlayers();
    if (players[playerId]) return sendTg(chatId, `❌ Айди <code>${playerId}</code> уже существует`);
    const expires = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
    players[playerId] = { key, balance: 0, status: 'ok', expires, registered: true, created: new Date().toISOString(), nick: playerId };
    savePlayers(players);
    const expText = days > 0 ? `${days} дней` : 'Бессрочный';
    return sendTg(chatId,
      `✅ <b>ИГРОК ДОБАВЛЕН!</b>\n\n🆔 Айди: <code>${playerId}</code>\n🔑 Ключ: <code>${key}</code>\n📅 Срок: <b>${expText}</b>\n\n📨 Отправь игроку:\n———————————\n🆔 Айди: <code>${playerId}</code>\n🔑 Ключ: <code>${key}</code>\n———————————`
    );
  }
  if (state.action === 'ban_id') {
    delete states[chatId];
    const id = text.toUpperCase();
    const players = loadPlayers();
    if (!players[id]) return sendTg(chatId, `❌ <code>${id}</code> не найден`);
    players[id].status = 'banned'; players[id].ban_reason = 'Нарушение правил';
    savePlayers(players);
    return sendTg(chatId, `🔨 <code>${id}</code> заблокирован`);
  }
  if (state.action === 'unban_id') {
    delete states[chatId];
    const id = text.toUpperCase();
    const players = loadPlayers();
    if (!players[id]) return sendTg(chatId, `❌ <code>${id}</code> не найден`);
    players[id].status = 'ok'; delete players[id].ban_reason;
    savePlayers(players);
    return sendTg(chatId, `✅ <code>${id}</code> разблокирован`);
  }
  if (state.action === 'info_id') {
    delete states[chatId];
    const id = text.toUpperCase();
    const players = loadPlayers();
    const p = players[id];
    if (!p) return sendTg(chatId, `❌ <code>${id}</code> не найден`);
    const icon = p.status === 'banned' ? '🔨' : '✅';
    const exp = p.expires ? new Date(p.expires).toLocaleString('ru') : '∞';
    return sendTg(chatId, `👤 <b>${id}</b>\n🔑 <code>${p.key}</code>\n📅 ${exp}\n💰 ${p.balance || 0} KGS\n${icon} ${p.status}`);
  }
});

// ── REST API ───────────────────────────────────
app.get('/check', (req, res) => {
  const { key, player_id } = req.query;
  if (!key || !player_id) return res.json({ status: 'error', message: 'Введи Айди и ключ' });
  const players = loadPlayers();
  const p = players[player_id.toUpperCase()];
  if (!p) return res.json({ status: 'error', message: '✕ Айди не найден' });
  if (p.key !== key.toUpperCase()) return res.json({ status: 'error', message: '✕ Неверный ключ' });
  if (p.status === 'banned')   return res.json({ status: 'banned',      message: p.ban_reason || 'Аккаунт заблокирован.' });
  if (p.status === 'frozen')   return res.json({ status: 'frozen',      message: 'Аккаунт заморожен.' });
  if (p.expires && new Date(p.expires) < new Date()) return res.json({ status: 'expired' });
  res.json({ status: 'ok', key: p.key, playerId: player_id.toUpperCase(), nick: p.nick || null, balance: p.balance || 0 });
});

app.post('/addplayer', (req, res) => {
  const { playerId, key, days } = req.body;
  if (!playerId || !key) return res.json({ ok: false, message: 'Нужен playerId и key' });
  const players = loadPlayers();
  const id = playerId.toUpperCase(), k = key.toUpperCase();
  if (players[id]) return res.json({ ok: false, message: 'Айди уже существует' });
  const expires = days && days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
  players[id] = { key: k, balance: 0, status: 'ok', expires, registered: true, created: new Date().toISOString(), nick: id };
  savePlayers(players);
  res.json({ ok: true, playerId: id, key: k, expires });
});

app.post('/ban',   (req, res) => { const {playerId,reason}=req.body; const p=loadPlayers(); const id=(playerId||'').toUpperCase(); if(!p[id])return res.json({ok:false,message:'Не найден'}); p[id].status='banned'; p[id].ban_reason=reason||'Нарушение правил'; savePlayers(p); res.json({ok:true}); });
app.post('/unban', (req, res) => { const {playerId}=req.body; const p=loadPlayers(); const id=(playerId||'').toUpperCase(); if(!p[id])return res.json({ok:false,message:'Не найден'}); p[id].status='ok'; delete p[id].ban_reason; savePlayers(p); res.json({ok:true}); });

app.get('/players', (req, res) => {
  const players = loadPlayers();
  const list = Object.entries(players).map(([id, p]) => ({
    playerId: id, key: p.key, nick: p.nick || id, status: p.status,
    balance: p.balance || 0,
    expires: p.expires ? new Date(p.expires).toLocaleString('ru') : '∞',
    created: p.created ? new Date(p.created).toLocaleString('ru') : '—'
  }));
  res.json({ count: list.length, players: list });
});

app.get('/', (req, res) => res.json({ status: 'KING SIGNAL OK ✅' }));

// ── SET WEBHOOK ────────────────────────────────
app.get('/set-webhook', (req, res) => {
  const url = `https://king-signal-server.onrender.com/webhook/${BOT_TOKEN}`;
  https.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => { try { res.json(JSON.parse(d)); } catch { res.send(d); } });
  });
});

app.get('/del-webhook', (req, res) => {
  https.get(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`, r => {
    let d = ''; r.on('data', c => d += c); r.on('end', () => res.send(d));
  });
});

// ── START ──────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ KING SIGNAL запущен :${PORT}`);
  // Установить webhook автоматически
  setTimeout(() => {
    const url = `https://king-signal-server.onrender.com/webhook/${BOT_TOKEN}`;
    https.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${encodeURIComponent(url)}`, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => console.log('Webhook:', d));
    });
  }, 3000);
});
// НЕ делаем require('./bot.js') — всё в одном файле!
                          
