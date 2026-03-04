const express = require('express');
const cors = require('cors');
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');

// ══════════════════════════════════════════════
//  КОНФИГ
// ══════════════════════════════════════════════
const BOT_TOKEN    = process.env.BOT_TOKEN    || '8639490181:AAHlTgtVDsRuohlt0ZgcGV2h0J4vz7o5pLQ';
const ADMIN_ID     = process.env.ADMIN_ID     || '6697505756';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO  = process.env.GITHUB_REPO  || 'sadi05are/king-signal-server';
const GITHUB_FILE  = 'players.json';
const PORT         = process.env.PORT || 3000;

// ══════════════════════════════════════════════
//  GITHUB — хранилище игроков
// ══════════════════════════════════════════════
let _cache = {};
let _cacheSha = null;
let _cacheTime = 0;

async function loadPlayers() {
  if (Date.now() - _cacheTime < 15000) return _cache;
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
    );
    const content = Buffer.from(res.data.content, 'base64').toString('utf8');
    _cache = JSON.parse(content);
    _cacheSha = res.data.sha;
    _cacheTime = Date.now();
    return _cache;
  } catch (e) {
    if (e.response && e.response.status === 404) return {};
    return _cache;
  }
}

async function savePlayers(players) {
  try {
    // Берём свежий SHA
    const r = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
    ).catch(() => ({ data: { sha: null } }));
    const sha = r.data.sha || _cacheSha;
    const content = Buffer.from(JSON.stringify(players, null, 2)).toString('base64');
    const body = { message: 'update players', content };
    if (sha) body.sha = sha;
    await axios.put(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`,
      body,
      { headers: { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' } }
    );
    _cache = players;
    _cacheTime = Date.now();
    return true;
  } catch (e) {
    console.error('GitHub save error:', e.response?.data || e.message);
    return false;
  }
}

// ══════════════════════════════════════════════
//  EXPRESS API
// ══════════════════════════════════════════════
const app = express();
app.use(cors());
app.use(express.json());

// Проверка ключа / вход
app.get('/check', async (req, res) => {
  const { key = '', player_id = '' } = req.query;
  const players = await loadPlayers();

  let player = null, pid = null;
  for (const [id, data] of Object.entries(players)) {
    if (data.key && data.key.toUpperCase() === key.toUpperCase()) {
      if (player_id && id.toUpperCase() !== player_id.toUpperCase()) continue;
      player = data; pid = id; break;
    }
  }

  if (!player) return res.json({ status: 'invalid', message: '✕ НЕВЕРНЫЙ КЛЮЧ ИЛИ АЙДИ' });

  const status = player.status || 'ok';
  if (status === 'banned')  return res.json({ status: 'banned',       message: player.ban_reason || 'Ключ заблокирован' });
  if (status === 'frozen')  return res.json({ status: 'frozen',       message: 'Ключ заморожен. Обратись к @vivoxz' });
  if (status === 'maintenance') return res.json({ status: 'maintenance', message: 'Технические работы. Скоро вернёмся!' });

  let expiresIn = null;
  if (player.expires) {
    const diff = new Date(player.expires) - new Date();
    if (diff <= 0) return res.json({ status: 'expired' });
    expiresIn = diff;
  }

  return res.json({ status: 'ok', key: player.key, playerId: pid, nick: player.nick || '', balance: player.balance || 0, expiresIn });
});

// Баланс
app.get('/balance', async (req, res) => {
  const players = await loadPlayers();
  const pid = (req.query.player_id || '').toUpperCase();
  if (!players[pid]) return res.status(404).json({ error: 'not found' });
  res.json({ balance: players[pid].balance || 0 });
});

// Регистрация
app.post('/register', async (req, res) => {
  const { key = '', nick = '' } = req.body;
  const players = await loadPlayers();
  const KEY = key.toUpperCase().trim();
  const NICK = nick.toUpperCase().trim().replace(/[^A-Z0-9]/g, '');

  if (!NICK || NICK.length < 2) return res.json({ ok: false, message: '✕ НИК СЛИШКОМ КОРОТКИЙ' });

  let matchedPid = null, matchedPlayer = null;
  for (const [id, data] of Object.entries(players)) {
    if ((data.key || '').toUpperCase() === KEY) {
      matchedPid = id; matchedPlayer = data; break;
    }
  }

  if (!matchedPlayer) return res.json({ ok: false, message: '✕ КЛЮЧ НЕ НАЙДЕН — обратись к @vivoxz' });
  if (matchedPlayer.registered) return res.json({ ok: false, message: '✕ КЛЮЧ УЖЕ ИСПОЛЬЗОВАН' });

  const status = matchedPlayer.status || 'ok';
  if (status === 'banned') return res.json({ ok: false, message: '✕ КЛЮЧ ЗАБЛОКИРОВАН' });
  if (matchedPlayer.expires && new Date() > new Date(matchedPlayer.expires))
    return res.json({ ok: false, message: '✕ КЛЮЧ ИСТЁК' });

  // Генерируем ID: NICK0001
  const base = NICK.slice(0, 8);
  let counter = 1, newPid;
  while (true) {
    newPid = `${base}${String(counter).padStart(4, '0')}`;
    if (!players[newPid]) break;
    counter++;
  }

  const playerData = { ...matchedPlayer, nick: NICK, registered: true, reg_time: new Date().toISOString() };
  if (matchedPid !== newPid) delete players[matchedPid];
  players[newPid] = playerData;
  await savePlayers(players);

  // Уведомляем admin
  try {
    bot.sendMessage(ADMIN_ID,
      `🆕 *НОВЫЙ ИГРОК*\n\n👤 ID: \`${newPid}\`\n🎮 Ник: ${NICK}\n🔑 Ключ: \`${KEY}\`\n📅 ${new Date().toLocaleString('ru')}`,
      { parse_mode: 'Markdown' }
    );
  } catch {}

  res.json({ ok: true, playerId: newPid, key: KEY });
});

// Запрос пополнения
app.post('/deposit/request', async (req, res) => {
  const { playerId } = req.body;
  try {
    bot.sendMessage(ADMIN_ID,
      `💰 *ЗАПРОС ПОПОЛНЕНИЯ*\n\n👤 Игрок: \`${playerId}\`\n📅 ${new Date().toLocaleString('ru')}\n\nИспользуй /topup для начисления`,
      { parse_mode: 'Markdown' }
    );
  } catch {}
  res.json({ ok: true });
});

// Заявка на вывод
app.post('/withdraw/request', async (req, res) => {
  const { playerId, amount, bank, cardNumber } = req.body;
  const players = await loadPlayers();
  const pid = (playerId || '').toUpperCase();
  if (!players[pid]) return res.json({ ok: false, message: 'Игрок не найден' });

  const bal = players[pid].balance || 0;
  if (amount > bal) return res.json({ ok: false, message: 'Недостаточно средств' });
  if (amount <= 0)  return res.json({ ok: false, message: 'Неверная сумма' });

  players[pid].balance = Math.round((bal - amount) * 100) / 100;
  if (!players[pid].withdrawals) players[pid].withdrawals = [];
  players[pid].withdrawals.push({ amount, bank, card: cardNumber, time: new Date().toISOString(), status: 'pending' });
  await savePlayers(players);

  try {
    bot.sendMessage(ADMIN_ID,
      `📤 *ЗАЯВКА НА ВЫВОД*\n\n👤 Игрок: \`${pid}\`\n💸 Сумма: *${amount} KGS*\n🏦 Банк: ${bank}\n💳 Карта: \`${cardNumber}\`\n📅 ${new Date().toLocaleString('ru')}`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '✅ Выплатил', callback_data: `wd_done:${pid}:${amount}` },
            { text: '❌ Отклонить', callback_data: `wd_reject:${pid}:${amount}` }
          ]]
        }
      }
    );
  } catch {}

  res.json({ ok: true });
});

// Смена ключа
app.post('/change-key', async (req, res) => {
  const { playerId, oldKey, newKey } = req.body;
  const players = await loadPlayers();
  const pid = (playerId || '').toUpperCase();
  if (!players[pid]) return res.json({ ok: false, message: 'Игрок не найден' });
  if ((players[pid].key || '').toUpperCase() !== oldKey.toUpperCase())
    return res.json({ ok: false, message: 'Старый ключ неверный' });
  for (const [id, data] of Object.entries(players)) {
    if (id !== pid && (data.key || '').toUpperCase() === newKey.toUpperCase())
      return res.json({ ok: false, message: 'Ключ уже занят' });
  }
  players[pid].key = newKey.toUpperCase();
  await savePlayers(players);
  res.json({ ok: true });
});

// ══════════════════════════════════════════════
//  TELEGRAM BOT
// ══════════════════════════════════════════════
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Состояния диалогов
const state = {};

function setState(id, s) { state[id] = s; }
function getState(id) { return state[id] || {}; }
function clearState(id) { delete state[id]; }

function isAdmin(id) { return String(id) === String(ADMIN_ID); }

bot.onText(/\/start/, (msg) => {
  if (!isAdmin(msg.chat.id)) return bot.sendMessage(msg.chat.id, '⛔ Нет доступа');
  bot.sendMessage(msg.chat.id,
    `👑 *KING SIGNAL — АДМИН ПАНЕЛЬ*\n\n` +
    `📋 *Команды:*\n` +
    `• /addplayer — Добавить нового игрока\n` +
    `• /topup — Пополнить баланс\n` +
    `• /deduct — Вычесть баланс\n` +
    `• /players — Список игроков\n` +
    `• /player ИД — Инфо об игроке\n` +
    `• /setkey ИД КЛЮЧ — Сменить ключ\n` +
    `• /ban ИД — Заблокировать\n` +
    `• /unban ИД — Разблокировать\n` +
    `• /cancel — Отмена`,
    { parse_mode: 'Markdown' }
  );
});

// /addplayer
bot.onText(/\/addplayer/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  setState(msg.chat.id, { step: 'addplayer_key' });
  bot.sendMessage(msg.chat.id, '➕ *ДОБАВИТЬ ИГРОКА*\n\nВведи ключ для нового игрока (напр. `KINGKEY123`):', { parse_mode: 'Markdown' });
});

// /topup
bot.onText(/\/topup/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  setState(msg.chat.id, { step: 'topup_id' });
  bot.sendMessage(msg.chat.id, '💰 *ПОПОЛНЕНИЕ*\n\nВведи ID игрока:', { parse_mode: 'Markdown' });
});

// /deduct
bot.onText(/\/deduct/, (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  setState(msg.chat.id, { step: 'deduct_id' });
  bot.sendMessage(msg.chat.id, '📤 *ВЫЧЕТ БАЛАНСА*\n\nВведи ID игрока:', { parse_mode: 'Markdown' });
});

// /players
bot.onText(/\/players/, async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  const players = await loadPlayers();
  const keys = Object.keys(players);
  if (!keys.length) return bot.sendMessage(msg.chat.id, '📋 Игроков пока нет');
  const lines = ['👥 *СПИСОК ИГРОКОВ*\n'];
  for (const pid of keys.slice(0, 20)) {
    const p = players[pid];
    const icon = p.status === 'banned' ? '🚫' : p.status === 'frozen' ? '❄️' : '✅';
    lines.push(`${icon} \`${pid}\` — ${p.balance || 0} KGS${p.nick ? ' · ' + p.nick : ''}`);
  }
  if (keys.length > 20) lines.push(`\n...и ещё ${keys.length - 20}`);
  bot.sendMessage(msg.chat.id, lines.join('\n'), { parse_mode: 'Markdown' });
});

// /player ID
bot.onText(/\/player (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const pid = match[1].toUpperCase();
  const players = await loadPlayers();
  if (!players[pid]) return bot.sendMessage(msg.chat.id, `❌ Игрок \`${pid}\` не найден`, { parse_mode: 'Markdown' });
  const p = players[pid];
  let exp = 'Бессрочно';
  if (p.expires) {
    const diff = new Date(p.expires) - new Date();
    exp = diff <= 0 ? '❌ ИСТЁК' : `✅ ${Math.ceil(diff / 86400000)} дней`;
  }
  bot.sendMessage(msg.chat.id,
    `👤 *${pid}*\n🎮 Ник: ${p.nick || '—'}\n🔑 Ключ: \`${p.key}\`\n💰 Баланс: *${p.balance || 0} KGS*\n📊 Статус: ${p.status || 'ok'}\n📅 Срок: ${exp}`,
    { parse_mode: 'Markdown' }
  );
});

// /setkey ID KEY
bot.onText(/\/setkey (\S+) (\S+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const pid = match[1].toUpperCase(), newKey = match[2].toUpperCase();
  const players = await loadPlayers();
  if (!players[pid]) return bot.sendMessage(msg.chat.id, '❌ Игрок не найден');
  for (const [id, d] of Object.entries(players))
    if (id !== pid && (d.key || '').toUpperCase() === newKey)
      return bot.sendMessage(msg.chat.id, '❌ Ключ уже занят');
  const old = players[pid].key;
  players[pid].key = newKey;
  await savePlayers(players);
  bot.sendMessage(msg.chat.id, `✅ Ключ сменён!\n\`${old}\` → \`${newKey}\``, { parse_mode: 'Markdown' });
});

// /ban ID
bot.onText(/\/ban (\S+)(.*)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const pid = match[1].toUpperCase(), reason = (match[2] || '').trim() || 'Нарушение правил';
  const players = await loadPlayers();
  if (!players[pid]) return bot.sendMessage(msg.chat.id, '❌ Игрок не найден');
  players[pid].status = 'banned';
  players[pid].ban_reason = reason;
  await savePlayers(players);
  bot.sendMessage(msg.chat.id, `🚫 \`${pid}\` заблокирован\nПричина: ${reason}`, { parse_mode: 'Markdown' });
});

// /unban ID
bot.onText(/\/unban (\S+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const pid = match[1].toUpperCase();
  const players = await loadPlayers();
  if (!players[pid]) return bot.sendMessage(msg.chat.id, '❌ Игрок не найден');
  players[pid].status = 'ok';
  delete players[pid].ban_reason;
  await savePlayers(players);
  bot.sendMessage(msg.chat.id, `✅ \`${pid}\` разблокирован`, { parse_mode: 'Markdown' });
});

// /cancel
bot.onText(/\/cancel/, (msg) => {
  clearState(msg.chat.id);
  bot.sendMessage(msg.chat.id, '❌ Отменено');
});

// Кнопки ✅/❌ вывода
bot.on('callback_query', async (q) => {
  const [action, pid, amountStr] = q.data.split(':');
  const amount = parseFloat(amountStr);
  if (action === 'wd_done') {
    bot.editMessageText(q.message.text + '\n\n✅ *ВЫПЛАЧЕНО*', { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'Markdown' });
  } else if (action === 'wd_reject') {
    const players = await loadPlayers();
    if (players[pid]) {
      players[pid].balance = Math.round(((players[pid].balance || 0) + amount) * 100) / 100;
      await savePlayers(players);
    }
    bot.editMessageText(q.message.text + `\n\n❌ *ОТКЛОНЕНО* — ${amount} KGS возвращены`, { chat_id: q.message.chat.id, message_id: q.message.message_id, parse_mode: 'Markdown' });
  }
  bot.answerCallbackQuery(q.id);
});

// ── Диалоги (многошаговые команды) ────────────────────────
bot.on('message', async (msg) => {
  if (!isAdmin(msg.chat.id)) return;
  if (msg.text && msg.text.startsWith('/')) return;
  const s = getState(msg.chat.id);
  if (!s.step) return;
  const text = msg.text.trim().toUpperCase();

  // ── addplayer ──
  if (s.step === 'addplayer_key') {
    s.key = text; s.step = 'addplayer_days';
    setState(msg.chat.id, s);
    return bot.sendMessage(msg.chat.id, `✅ Ключ: \`${text}\`\n\nНа сколько дней? (0 = бессрочно):`, { parse_mode: 'Markdown' });
  }
  if (s.step === 'addplayer_days') {
    const days = parseInt(text);
    if (isNaN(days) || days < 0) return bot.sendMessage(msg.chat.id, '❌ Введи число дней');
    const players = await loadPlayers();
    // Проверим уникальность ключа
    for (const d of Object.values(players))
      if ((d.key || '').toUpperCase() === s.key)
        return bot.sendMessage(msg.chat.id, '❌ Такой ключ уже занят');
    // Временный ID — игрок получит нормальный при регистрации
    const tmpId = `TMP_${Date.now()}`;
    players[tmpId] = {
      key: s.key,
      balance: 0,
      status: 'ok',
      expires: days > 0 ? new Date(Date.now() + days * 86400000).toISOString() : null,
      registered: false,
      created: new Date().toISOString()
    };
    await savePlayers(players);
    clearState(msg.chat.id);
    return bot.sendMessage(msg.chat.id,
      `✅ *Ключ добавлен!*\n\n🔑 Ключ: \`${s.key}\`\n📅 Срок: ${days > 0 ? days + ' дней' : 'Бессрочно'}\n\nИгрок вводит этот ключ на сайте при регистрации и получит свой ID`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── topup ──
  if (s.step === 'topup_id') {
    s.pid = text; s.step = 'topup_amount';
    setState(msg.chat.id, s);
    const players = await loadPlayers();
    const cur = players[text]?.balance ?? '❓';
    return bot.sendMessage(msg.chat.id, `👤 Игрок: \`${text}\`\nТекущий баланс: *${cur} KGS*\n\nСколько начислить?`, { parse_mode: 'Markdown' });
  }
  if (s.step === 'topup_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return bot.sendMessage(msg.chat.id, '❌ Введи корректную сумму');
    const players = await loadPlayers();
    if (!players[s.pid]) { clearState(msg.chat.id); return bot.sendMessage(msg.chat.id, `❌ Игрок \`${s.pid}\` не найден`, { parse_mode: 'Markdown' }); }
    players[s.pid].balance = Math.round(((players[s.pid].balance || 0) + amount) * 100) / 100;
    await savePlayers(players);
    clearState(msg.chat.id);
    return bot.sendMessage(msg.chat.id,
      `✅ *Начислено!*\n\n👤 \`${s.pid}\`\n💸 +${amount} KGS\n💰 Новый баланс: *${players[s.pid].balance} KGS*`,
      { parse_mode: 'Markdown' }
    );
  }

  // ── deduct ──
  if (s.step === 'deduct_id') {
    s.pid = text; s.step = 'deduct_amount';
    setState(msg.chat.id, s);
    const players = await loadPlayers();
    const cur = players[text]?.balance ?? '❓';
    return bot.sendMessage(msg.chat.id, `👤 Игрок: \`${text}\`\nБаланс: *${cur} KGS*\n\nСколько вычесть?`, { parse_mode: 'Markdown' });
  }
  if (s.step === 'deduct_amount') {
    const amount = parseFloat(text);
    if (isNaN(amount) || amount <= 0) return bot.sendMessage(msg.chat.id, '❌ Введи корректную сумму');
    const players = await loadPlayers();
    if (!players[s.pid]) { clearState(msg.chat.id); return bot.sendMessage(msg.chat.id, '❌ Игрок не найден'); }
    if (amount > (players[s.pid].balance || 0)) return bot.sendMessage(msg.chat.id, `❌ Недостаточно. Баланс: ${players[s.pid].balance} KGS`);
    players[s.pid].balance = Math.round(((players[s.pid].balance || 0) - amount) * 100) / 100;
    await savePlayers(players);
    clearState(msg.chat.id);
    return bot.sendMessage(msg.chat.id,
      `✅ *Вычтено!*\n\n👤 \`${s.pid}\`\n💸 -${amount} KGS\n💰 Новый баланс: *${players[s.pid].balance} KGS*`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ══════════════════════════════════════════════
//  ЗАПУСК
// ══════════════════════════════════════════════
app.listen(PORT, () => console.log(`✅ Сервер запущен на порту ${PORT}`));
console.log('✅ Telegram бот запущен');
    
