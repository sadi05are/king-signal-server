const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// ════════════════════════════════════════
// CONFIG — заполни свои данные
// ════════════════════════════════════════
const BOT_TOKEN   = process.env.BOT_TOKEN   || '8725490737:AAHXj6SxyleGvi77Qykcx_GS68pk03pwXxQ';
const ADMIN_ID    = process.env.ADMIN_ID    || '6697505756';
const PORT        = process.env.PORT || 3000;

// ════════════════════════════════════════
// DATABASE (в памяти, сохраняется пока сервер работает)
// ════════════════════════════════════════
let db = {
  maintenance: false,       // глобальный режим тех.работ
  maintenanceMsg: 'Бот временно недоступен из-за высокой нагрузки на серверы. Мы работаем над этим — совсем скоро всё заработает!',
  bannedKeys: new Set(),    // забаненные ключи
  frozenKeys: new Set(),    // замороженные ключи (временно)
  activations: {},          // { key: { activatedAt, lastSeen } }
};

// Все валидные ключи
const VALID_KEYS = new Set([
  'KING01XBET','KING02XBET','KING03XBET','KING04XBET','KING05XBET',
  'ALPHA1KGSL','ALPHA2KGSL','ALPHA3KGSL','ALPHA4KGSL','ALPHA5KGSL',
  'BETA01KGSL','BETA02KGSL','BETA03KGSL','BETA04KGSL','BETA05KGSL',
  'DELTA1KGSL','DELTA2KGSL','DELTA3KGSL','DELTA4KGSL','DELTA5KGSL',
  'OMEGA1KGSL','OMEGA2KGSL','OMEGA3KGSL','OMEGA4KGSL','OMEGA5KGSL',
  'LUCKY1JKOP','LUCKY2JKOP','LUCKY3JKOP','LUCKY4JKOP','LUCKY5JKOP',
  'CRASH1JKOP','CRASH2JKOP','CRASH3JKOP','CRASH4JKOP','CRASH5JKOP',
  'PRIME1KGSL','PRIME2KGSL','PRIME3KGSL','PRIME4KGSL','PRIME5KGSL',
  'ULTRA1KGSL','ULTRA2KGSL','ULTRA3KGSL','ULTRA4KGSL','ULTRA5KGSL',
  'SIGMA1KGSL','SIGMA2KGSL','SIGMA3KGSL','SIGMA4KGSL','SIGMA5KGSL',
  'ZETA01KGSL','ZETA02KGSL','ZETA03KGSL','ZETA04KGSL','ZETA05KGSL',
  'NOVA01KGSL','NOVA02KGSL','NOVA03KGSL','NOVA04KGSL','NOVA05KGSL',
  'STAR01KGSL','STAR02KGSL','STAR03KGSL','STAR04KGSL','STAR05KGSL',
  'MOON01KGSL','MOON02KGSL','MOON03KGSL','MOON04KGSL','MOON05KGSL',
  'FIRE01KGSL','FIRE02KGSL','FIRE03KGSL','FIRE04KGSL','FIRE05KGSL',
  'GOLD01KGSL','GOLD02KGSL','GOLD03KGSL','GOLD04KGSL','GOLD05KGSL',
  'VIP001KGSL','VIP002KGSL','VIP003KGSL','VIP004KGSL','VIP005KGSL',
  'PRO0001KGS','PRO0002KGS','PRO0003KGS','PRO0004KGS','PRO0005KGS',
  'GHAL71JKOP','JOPGD68JA1','NALGSYO71H','ACE001KGSL','ACE002KGSL',
  'APEX01KGSL','APEX02KGSL','APEX03KGSL','APEX04KGSL','APEX05KGSL',
]);

const SPECIAL_EXPIRY = { 'NALGSYO71H': 10 * 60 * 60 * 1000 };
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

function getExpiry(key) {
  return SPECIAL_EXPIRY[key] || SEVEN_DAYS;
}

// ════════════════════════════════════════
// API — проверка ключа (вызывается из HTML)
// ════════════════════════════════════════
app.get('/check', (req, res) => {
  const key = (req.query.key || '').toUpperCase().trim();

  // Глобальный режим тех.работ
  if (db.maintenance) {
    return res.json({ status: 'maintenance', message: db.maintenanceMsg });
  }

  // Ключ не существует
  if (!VALID_KEYS.has(key)) {
    return res.json({ status: 'invalid' });
  }

  // Забанен
  if (db.bannedKeys.has(key)) {
    return res.json({ status: 'banned', message: 'Ваш ключ заблокирован. Обратитесь: @vivoxz' });
  }

  // Заморожен
  if (db.frozenKeys.has(key)) {
    return res.json({ status: 'frozen', message: 'Ваш ключ временно заморожен. Попробуйте позже.' });
  }

  // Запись активации
  const now = Date.now();
  if (!db.activations[key]) {
    db.activations[key] = { activatedAt: now, lastSeen: now };
    // Уведомить админа о новой активации
    sendTg(ADMIN_ID, `🔑 <b>Новая активация!</b>\nКлюч: <code>${key}</code>`);
  } else {
    db.activations[key].lastSeen = now;
  }

  // Проверка срока
  const act = db.activations[key];
  const elapsed = now - act.activatedAt;
  const expiry = getExpiry(key);
  if (elapsed >= expiry) {
    return res.json({ status: 'expired' });
  }

  const remMs = expiry - elapsed;
  return res.json({
    status: 'ok',
    key,
    activatedAt: act.activatedAt,
    expiresIn: remMs,
  });
});

// ════════════════════════════════════════
// TELEGRAM BOT
// ════════════════════════════════════════
async function sendTg(chatId, text) {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch(e) { console.error('TG error:', e.message); }
}

// Webhook от Telegram
app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const msg = req.body?.message;
  if (!msg) return;

  const chatId = String(msg.chat.id);
  const text   = (msg.text || '').trim();

  // Только админ
  if (chatId !== String(ADMIN_ID)) {
    return sendTg(chatId, '⛔ Нет доступа.');
  }

  const parts = text.split(' ');
  const cmd   = parts[0].toLowerCase();
  const arg   = (parts[1] || '').toUpperCase();
  const arg2  = parts.slice(1).join(' '); // для длинных сообщений

  // ── /help ──
  if (cmd === '/help' || cmd === '/start') {
    return sendTg(chatId,
      `👑 <b>KING SIGNAL — Панель управления</b>\n\n` +
      `<b>Ключи:</b>\n` +
      `/ban КЛЮЧ — заблокировать ключ\n` +
      `/unban КЛЮЧ — разблокировать\n` +
      `/freeze КЛЮЧ — заморозить (временно)\n` +
      `/unfreeze КЛЮЧ — разморозить\n` +
      `/info КЛЮЧ — инфо о ключе\n` +
      `/keys — список активных ключей\n\n` +
      `<b>Сервис:</b>\n` +
      `/maintenance on — включить тех.работы\n` +
      `/maintenance off — выключить\n` +
      `/setmsg ТЕКСТ — изменить сообщение тех.работ\n` +
      `/status — текущий статус сервиса`
    );
  }

  // ── /ban ──
  if (cmd === '/ban') {
    if (!arg) return sendTg(chatId, '❌ Укажи ключ: /ban ALPHA1KGSL');
    if (!VALID_KEYS.has(arg)) return sendTg(chatId, `❌ Ключ <code>${arg}</code> не существует.`);
    db.bannedKeys.add(arg);
    db.frozenKeys.delete(arg);
    return sendTg(chatId, `🚫 Ключ <code>${arg}</code> <b>заблокирован</b>.`);
  }

  // ── /unban ──
  if (cmd === '/unban') {
    if (!arg) return sendTg(chatId, '❌ Укажи ключ: /unban ALPHA1KGSL');
    db.bannedKeys.delete(arg);
    return sendTg(chatId, `✅ Ключ <code>${arg}</code> <b>разблокирован</b>.`);
  }

  // ── /freeze ──
  if (cmd === '/freeze') {
    if (!arg) return sendTg(chatId, '❌ Укажи ключ: /freeze ALPHA1KGSL');
    if (!VALID_KEYS.has(arg)) return sendTg(chatId, `❌ Ключ <code>${arg}</code> не существует.`);
    db.frozenKeys.add(arg);
    return sendTg(chatId, `❄️ Ключ <code>${arg}</code> <b>заморожен</b>.`);
  }

  // ── /unfreeze ──
  if (cmd === '/unfreeze') {
    if (!arg) return sendTg(chatId, '❌ Укажи ключ: /unfreeze ALPHA1KGSL');
    db.frozenKeys.delete(arg);
    return sendTg(chatId, `✅ Ключ <code>${arg}</code> <b>разморожен</b>.`);
  }

  // ── /info ──
  if (cmd === '/info') {
    if (!arg) return sendTg(chatId, '❌ Укажи ключ: /info ALPHA1KGSL');
    if (!VALID_KEYS.has(arg)) return sendTg(chatId, `❌ Ключ не существует.`);
    const act = db.activations[arg];
    const banned  = db.bannedKeys.has(arg) ? '🚫 ЗАБЛОКИРОВАН' : '';
    const frozen  = db.frozenKeys.has(arg) ? '❄️ ЗАМОРОЖЕН' : '';
    const flags   = [banned, frozen].filter(Boolean).join(' ') || '✅ Активен';
    if (!act) return sendTg(chatId, `🔑 <code>${arg}</code>\nСтатус: не использовался`);
    const days = Math.ceil((getExpiry(arg) - (Date.now() - act.activatedAt)) / 86400000);
    const actDate = new Date(act.activatedAt).toLocaleString('ru');
    const seenDate = new Date(act.lastSeen).toLocaleString('ru');
    return sendTg(chatId,
      `🔑 <code>${arg}</code>\n` +
      `Статус: ${flags}\n` +
      `Активирован: ${actDate}\n` +
      `Последний вход: ${seenDate}\n` +
      `Осталось: ${days > 0 ? days + ' дн.' : 'истёк'}`
    );
  }

  // ── /keys ──
  if (cmd === '/keys') {
    const list = Object.entries(db.activations);
    if (list.length === 0) return sendTg(chatId, '📋 Активаций пока нет.');
    const lines = list.map(([k, v]) => {
      const b = db.bannedKeys.has(k) ? '🚫' : db.frozenKeys.has(k) ? '❄️' : '✅';
      const d = new Date(v.lastSeen).toLocaleDateString('ru');
      return `${b} <code>${k}</code> — ${d}`;
    });
    return sendTg(chatId, `📋 <b>Активные ключи (${list.length}):</b>\n\n` + lines.join('\n'));
  }

  // ── /maintenance ──
  if (cmd === '/maintenance') {
    if (arg.toLowerCase() === 'on') {
      db.maintenance = true;
      return sendTg(chatId, `🔧 <b>Тех.работы включены.</b>\nВсе пользователи видят экран обслуживания.`);
    }
    if (arg.toLowerCase() === 'off') {
      db.maintenance = false;
      return sendTg(chatId, `✅ <b>Тех.работы выключены.</b>\nСервис снова работает.`);
    }
    return sendTg(chatId, 'Используй: /maintenance on или /maintenance off');
  }

  // ── /setmsg ──
  if (cmd === '/setmsg') {
    if (!arg2) return sendTg(chatId, '❌ Укажи текст: /setmsg Бот не работает...');
    db.maintenanceMsg = arg2;
    return sendTg(chatId, `✅ Сообщение обновлено:\n"${arg2}"`);
  }

  // ── /status ──
  if (cmd === '/status') {
    const maint = db.maintenance ? '🔧 ВКЛ' : '✅ ВЫКЛ';
    return sendTg(chatId,
      `📊 <b>Статус сервиса:</b>\n\n` +
      `Тех.работы: ${maint}\n` +
      `Забанено ключей: ${db.bannedKeys.size}\n` +
      `Заморожено ключей: ${db.frozenKeys.size}\n` +
      `Всего активаций: ${Object.keys(db.activations).length}`
    );
  }

  sendTg(chatId, '❓ Неизвестная команда. Напиши /help');
});

// ════════════════════════════════════════
// START
// ════════════════════════════════════════
app.get('/', (req, res) => res.json({ status: 'King Signal API running' }));

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  // Установить webhook
  if (BOT_TOKEN) {
    const webhookUrl = process.env.RENDER_EXTERNAL_URL + '/webhook';
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`)
      .then(() => console.log('✅ Webhook set:', webhookUrl))
      .catch(e => console.error('Webhook error:', e.message));
  }
});
