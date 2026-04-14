const express = require('express');
const cors    = require('cors');
const fs      = require('fs');
const https   = require('https');
const TelegramBot = require('node-telegram-bot-api');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN    = process.env.BOT_TOKEN || '8778762497:AAEpXb9BCdyztC1YQRJaGTSL4IIGrZC8dJ0';
const ADMIN_ID     = process.env.ADMIN_ID  || '8572856251';
const PLAYERS_FILE = './players.json';
const STATE_FILE   = './state.json';

// ─── FILE HELPERS ─────────────────────────────────────────────────────────────
function loadPlayers() {
  try { return JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8')); }
  catch { return {}; }
}
function savePlayers(d) { fs.writeFileSync(PLAYERS_FILE, JSON.stringify(d, null, 2)); }

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { maintenance: false, maintenanceMsg: '🔧 Технические работы. Скоро вернёмся!', onlineBase: 800 }; }
}
function saveState(d) { fs.writeFileSync(STATE_FILE, JSON.stringify(d, null, 2)); }

// ─── TELEGRAM HELPER ──────────────────────────────────────────────────────────
function tg(chatId, text, extra = {}) {
  bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...extra }).catch(() => {});
}

// ─── SHARED ONLINE COUNTER ────────────────────────────────────────────────────
let onlineValue = 800;
setInterval(() => {
  const delta = Math.floor(Math.random() * 16) - 7;
  onlineValue = Math.max(200, Math.min(1892, onlineValue + delta));
}, 60000);

// ─── API ROUTES ───────────────────────────────────────────────────────────────
app.get('/online', (req, res) => res.json({ online: onlineValue }));

app.get('/status', (req, res) => {
  const s = loadState();
  res.json({ maintenance: s.maintenance, maintenanceMsg: s.maintenanceMsg, online: onlineValue });
});

app.get('/check', (req, res) => {
  const state = loadState();
  if (state.maintenance) return res.json({ status: 'maintenance', message: state.maintenanceMsg });
  const { key, player_id } = req.query;
  if (!key || !player_id) return res.json({ status: 'error', message: '✕ Введи Айди и Ключ' });
  const players = loadPlayers();
  const id = player_id.trim().toUpperCase();
  const k  = key.trim().toUpperCase();
  const p  = players[id];
  if (!p) return res.json({ status: 'error', message: '✕ Айди не найден' });
  if (p.key !== k) return res.json({ status: 'error', message: '✕ Неверный ключ' });
  if (p.status === 'banned')  return res.json({ status: 'banned',  message: p.ban_reason || 'Аккаунт заблокирован.' });
  if (p.status === 'frozen')  return res.json({ status: 'frozen',  message: 'Аккаунт временно заморожен.' });
  if (p.expires && new Date(p.expires) < new Date()) return res.json({ status: 'expired' });
  const expiresIn = p.expires ? new Date(p.expires).getTime() - Date.now() : null;
  res.json({ status: 'ok', key: p.key, playerId: id, expiresIn });
});

app.post('/addplayer', (req, res) => {
  const { playerId, key, days } = req.body;
  if (!playerId || !key) return res.json({ ok: false, message: 'Нужен playerId и key' });
  const players = loadPlayers();
  const id = playerId.trim().toUpperCase();
  const k  = key.trim().toUpperCase();
  if (players[id]) return res.json({ ok: false, message: 'Этот Айди уже существует' });
  const expires = (days && days > 0) ? new Date(Date.now() + days * 86400000).toISOString() : null;
  players[id] = { key: k, status: 'ok', expires, created: new Date().toISOString() };
  savePlayers(players);
  res.json({ ok: true, playerId: id, key: k });
});

app.post('/ban', (req, res) => {
  const players = loadPlayers();
  const id = (req.body.playerId || '').toUpperCase();
  if (!players[id]) return res.json({ ok: false });
  players[id].status = 'banned';
  players[id].ban_reason = req.body.reason || 'Нарушение правил';
  savePlayers(players);
  res.json({ ok: true });
});

app.post('/unban', (req, res) => {
  const players = loadPlayers();
  const id = (req.body.playerId || '').toUpperCase();
  if (!players[id]) return res.json({ ok: false });
  players[id].status = 'ok';
  delete players[id].ban_reason;
  savePlayers(players);
  res.json({ ok: true });
});

app.post('/freeze', (req, res) => {
  const players = loadPlayers();
  const id = (req.body.playerId || '').toUpperCase();
  if (!players[id]) return res.json({ ok: false });
  players[id].status = 'frozen';
  savePlayers(players);
  res.json({ ok: true });
});

app.post('/unfreeze', (req, res) => {
  const players = loadPlayers();
  const id = (req.body.playerId || '').toUpperCase();
  if (!players[id]) return res.json({ ok: false });
  players[id].status = 'ok';
  savePlayers(players);
  res.json({ ok: true });
});

app.post('/maintenance', (req, res) => {
  const state = loadState();
  state.maintenance = !!req.body.enabled;
  if (req.body.message) state.maintenanceMsg = req.body.message;
  saveState(state);
  res.json({ ok: true, maintenance: state.maintenance });
});

app.get('/players', (req, res) => {
  const players = loadPlayers();
  const list = Object.entries(players).map(([id, p]) => ({
    playerId: id, key: p.key, status: p.status,
    expires: p.expires ? new Date(p.expires).toLocaleString('ru') : '∞',
    created: p.created ? new Date(p.created).toLocaleString('ru') : '—',
    ban_reason: p.ban_reason || null
  }));
  res.json({ count: list.length, players: list });
});

app.get('/', (req, res) => res.json({ ok: true, service: 'KING SIGNAL', online: onlineValue }));

// ─── POLLING BOT ──────────────────────────────────────────────────────────────
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const pendingAdd = {};

bot.on('message', (msg) => {
  if (String(msg.chat.id) !== String(ADMIN_ID)) return;
  const text  = (msg.text || '').trim();
  const parts = text.split(' ');
  const cmd   = parts[0].toLowerCase();
  const uid   = ADMIN_ID;
  const fsm   = pendingAdd[uid];

  // ── FSM /addplayer steps
  if (fsm) {
    if (text === '/cancel') {
      delete pendingAdd[uid];
      return tg(uid, '❌ Отменено.');
    }
    if (fsm.step === 'id') {
      pendingAdd[uid].playerId = text.toUpperCase();
      pendingAdd[uid].step = 'key';
      tg(uid, `✅ Айди: <code>${text.toUpperCase()}</code>\n\n2️⃣ Введи <b>ключ</b> для этого игрока:`);
    } else if (fsm.step === 'key') {
      pendingAdd[uid].key = text.toUpperCase();
      pendingAdd[uid].step = 'days';
      tg(uid, `✅ Ключ: <code>${text.toUpperCase()}</code>\n\n3️⃣ Введи <b>количество дней</b> (0 = бессрочный):`);
    } else if (fsm.step === 'days') {
      const days = parseInt(text) || 0;
      const { playerId, key } = pendingAdd[uid];
      delete pendingAdd[uid];
      const players = loadPlayers();
      const id = playerId.toUpperCase();
      const k  = key.toUpperCase();
      if (players[id]) return tg(uid, `❌ Айди <code>${id}</code> уже существует!`);
      const expires = days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null;
      players[id] = { key: k, status: 'ok', expires, created: new Date().toISOString() };
      savePlayers(players);
      tg(uid,
        `✅ <b>Игрок добавлен!</b>\n\n` +
        `🆔 Айди: <code>${id}</code>\n` +
        `🔑 Ключ: <code>${k}</code>\n` +
        `📅 Срок: <b>${days > 0 ? days + ' дней' : 'Бессрочный'}</b>\n\n` +
        `📨 Отправь игроку:\n———————————————\n` +
        `🆔 <code>${id}</code>\n🔑 <code>${k}</code>\n———————————————`
      );
    }
    return;
  }

  if (cmd === '/start') {
    tg(uid,
      `👑 <b>KING SIGNAL — ADMIN</b>\n\n` +
      `/addplayer — добавить игрока\n` +
      `/players — список игроков\n` +
      `/info ID — инфо об игроке\n` +
      `/ban ID — заблокировать\n` +
      `/unban ID — разблокировать\n` +
      `/freeze ID — заморозить\n` +
      `/unfreeze ID — разморозить\n` +
      `/maintenance — вкл/выкл тех. работы\n` +
      `/stats — статистика`,
      { reply_markup: JSON.stringify({ inline_keyboard: [
        [{ text: '👥 Игроки', callback_data: 'list_players' }, { text: '📊 Статистика', callback_data: 'stats' }],
        [{ text: '🔧 Тех. работы', callback_data: 'toggle_maintenance' }]
      ] }) }
    );
  }
  else if (cmd === '/addplayer') {
    pendingAdd[uid] = { step: 'id' };
    tg(uid, `➕ <b>Добавление игрока</b>\n\n1️⃣ Введи <b>Айди</b> нового игрока:\n(или /cancel для отмены)`);
  }
  else if (cmd === '/ban' && parts[1]) {
    const id = parts[1].toUpperCase();
    const reason = parts.slice(2).join(' ') || 'Нарушение правил';
    const players = loadPlayers();
    if (!players[id]) return tg(uid, `❌ <code>${id}</code> не найден`);
    players[id].status = 'banned';
    players[id].ban_reason = reason;
    savePlayers(players);
    tg(uid, `🔨 <code>${id}</code> заблокирован\n📝 Причина: ${reason}`);
  }
  else if (cmd === '/unban' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    if (!players[id]) return tg(uid, `❌ Не найден`);
    players[id].status = 'ok';
    delete players[id].ban_reason;
    savePlayers(players);
    tg(uid, `✅ <code>${id}</code> разблокирован`);
  }
  else if (cmd === '/freeze' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    if (!players[id]) return tg(uid, `❌ Не найден`);
    players[id].status = 'frozen';
    savePlayers(players);
    tg(uid, `❄️ <code>${id}</code> заморожен`);
  }
  else if (cmd === '/unfreeze' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    if (!players[id]) return tg(uid, `❌ Не найден`);
    players[id].status = 'ok';
    savePlayers(players);
    tg(uid, `✅ <code>${id}</code> разморожен`);
  }
  else if (cmd === '/maintenance') {
    const state = loadState();
    state.maintenance = !state.maintenance;
    saveState(state);
    const icon = state.maintenance ? '🔴' : '🟢';
    tg(uid,
      `${icon} Тех. работы: <b>${state.maintenance ? 'ВКЛЮЧЕНЫ' : 'ВЫКЛЮЧЕНЫ'}</b>`,
      { reply_markup: JSON.stringify({ inline_keyboard: [[
        { text: state.maintenance ? '🟢 Выключить' : '🔴 Включить', callback_data: 'toggle_maintenance' }
      ]] }) }
    );
  }
  else if (cmd === '/info' && parts[1]) {
    const id = parts[1].toUpperCase();
    const players = loadPlayers();
    const p = players[id];
    if (!p) return tg(uid, `❌ Не найден`);
    const icon = p.status === 'banned' ? '🔨' : p.status === 'frozen' ? '❄️' : '✅';
    const exp = p.expires ? new Date(p.expires).toLocaleString('ru') : '∞';
    tg(uid,
      `${icon} <b>${id}</b>\n` +
      `🔑 Ключ: <code>${p.key}</code>\n` +
      `📅 До: ${exp}\n` +
      `📌 Статус: <b>${p.status}</b>` +
      (p.ban_reason ? `\n📝 Причина: ${p.ban_reason}` : ''),
      { reply_markup: JSON.stringify({ inline_keyboard: [[
        p.status === 'banned'
          ? { text: '✅ Разблокировать', callback_data: `unban:${id}` }
          : { text: '🔨 Заблокировать', callback_data: `ban:${id}` },
        p.status === 'frozen'
          ? { text: '✅ Разморозить', callback_data: `unfreeze:${id}` }
          : { text: '❄️ Заморозить', callback_data: `freeze:${id}` }
      ]] }) }
    );
  }
  else if (cmd === '/players') {
    const players = loadPlayers();
    const list = Object.entries(players);
    let txt = `👥 <b>Игроки (${list.length})</b>\n${'─'.repeat(24)}\n`;
    list.slice(0, 25).forEach(([id, p]) => {
      const ic = p.status === 'banned' ? '🔨' : p.status === 'frozen' ? '❄️' : '✅';
      txt += `${ic} <code>${id}</code> — <code>${p.key}</code>\n`;
    });
    if (list.length > 25) txt += `\n<i>...ещё ${list.length - 25}</i>`;
    tg(uid, txt);
  }
  else if (cmd === '/stats') {
    const players = loadPlayers();
    const list = Object.values(players);
    const total   = list.length;
    const active  = list.filter(p => p.status === 'ok').length;
    const banned  = list.filter(p => p.status === 'banned').length;
    const frozen  = list.filter(p => p.status === 'frozen').length;
    const expired = list.filter(p => p.expires && new Date(p.expires) < new Date()).length;
    const state = loadState();
    tg(uid,
      `📊 <b>Статистика KING SIGNAL</b>\n${'─'.repeat(24)}\n` +
      `👥 Всего игроков: <b>${total}</b>\n` +
      `✅ Активных: <b>${active}</b>\n` +
      `🔨 Заблокировано: <b>${banned}</b>\n` +
      `❄️ Заморожено: <b>${frozen}</b>\n` +
      `⏳ Просрочено: <b>${expired}</b>\n` +
      `🔧 Тех. работы: <b>${state.maintenance ? 'ВКЛ' : 'ВЫКЛ'}</b>\n` +
      `👀 Онлайн: <b>${onlineValue}</b>`
    );
  }
});

bot.on('callback_query', (cb) => {
  if (String(cb.from.id) !== String(ADMIN_ID)) return;
  const data = cb.data;
  const uid  = ADMIN_ID;
  const players = loadPlayers();

  if (data === 'toggle_maintenance') {
    const state = loadState();
    state.maintenance = !state.maintenance;
    saveState(state);
    const icon = state.maintenance ? '🔴' : '🟢';
    tg(uid, `${icon} Тех. работы: <b>${state.maintenance ? 'ВКЛЮЧЕНЫ' : 'ВЫКЛЮЧЕНЫ'}</b>`);
  }
  else if (data === 'stats') {
    const list = Object.values(players);
    tg(uid,
      `📊 Игроков: <b>${list.length}</b>\n` +
      `✅ Активных: <b>${list.filter(p => p.status === 'ok').length}</b>\n` +
      `🔨 Бан: <b>${list.filter(p => p.status === 'banned').length}</b>\n` +
      `❄️ Заморожено: <b>${list.filter(p => p.status === 'frozen').length}</b>`
    );
  }
  else if (data === 'list_players') {
    const list = Object.entries(players).slice(0, 15);
    let txt = `👥 <b>Игроки (${Object.keys(players).length})</b>\n\n`;
    list.forEach(([id, p]) => {
      const ic = p.status === 'banned' ? '🔨' : p.status === 'frozen' ? '❄️' : '✅';
      txt += `${ic} <code>${id}</code>\n`;
    });
    tg(uid, txt);
  }
  else if (data.startsWith('ban:')) {
    const id = data.split(':')[1];
    if (!players[id]) return;
    players[id].status = 'banned';
    players[id].ban_reason = 'Заблокирован администратором';
    savePlayers(players);
    tg(uid, `🔨 <code>${id}</code> заблокирован`);
  }
  else if (data.startsWith('unban:')) {
    const id = data.split(':')[1];
    if (!players[id]) return;
    players[id].status = 'ok';
    delete players[id].ban_reason;
    savePlayers(players);
    tg(uid, `✅ <code>${id}</code> разблокирован`);
  }
  else if (data.startsWith('freeze:')) {
    const id = data.split(':')[1];
    if (!players[id]) return;
    players[id].status = 'frozen';
    savePlayers(players);
    tg(uid, `❄️ <code>${id}</code> заморожен`);
  }
  else if (data.startsWith('unfreeze:')) {
    const id = data.split(':')[1];
    if (!players[id]) return;
    players[id].status = 'ok';
    savePlayers(players);
    tg(uid, `✅ <code>${id}</code> разморожен`);
  }

  bot.answerCallbackQuery(cb.id).catch(() => {});
});

bot.on('polling_error', (err) => console.error('Polling error:', err.message));

// ─── START SERVER ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ KING SIGNAL Server на порту ${PORT}`);
  console.log(`🤖 Бот запущен в режиме polling`);
});
    
