const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN || '8639490181:AAHlTgtVDsRuohlt0ZgcGV2h0J4vz7o5pLQ';
const ADMIN_ID  = process.env.ADMIN_ID  || '6697505756';
const PORT      = process.env.PORT || 3000;

let db = {
  maintenance: false,
  maintenanceMsg: 'Бот временно недоступен. Скоро всё заработает!',
  bannedKeys: new Set(),
  frozenKeys: new Set(),
  activations: {},
};

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
function getExpiry(key) { return SPECIAL_EXPIRY[key] || SEVEN_DAYS; }

// ── CHECK KEY API ──
app.get('/check', (req, res) => {
  const key = (req.query.key || '').toUpperCase().trim();

  if (db.maintenance)
    return res.json({ status: 'maintenance', message: db.maintenanceMsg });

  if (!VALID_KEYS.has(key))
    return res.json({ status: 'invalid' });

  if (db.bannedKeys.has(key))
    return res.json({ status: 'banned', message: 'Ваш ключ заблокирован. Обратитесь: @vivoxz' });

  if (db.frozenKeys.has(key))
    return res.json({ status: 'frozen', message: 'Ваш ключ временно заморожен. Попробуйте позже.' });

  const now = Date.now();
  if (!db.activations[key]) {
    db.activations[key] = { activatedAt: now, lastSeen: now };
    sendTg(ADMIN_ID, `🔑 <b>Новая активация!</b>\nКлюч: <code>${key}</code>`);
  } else {
    db.activations[key].lastSeen = now;
  }

  const elapsed = now - db.activations[key].activatedAt;
  const expiry = getExpiry(key);
  if (elapsed >= expiry) return res.json({ status: 'expired' });

  return res.json({ status: 'ok', key, activatedAt: db.activations[key].activatedAt, expiresIn: expiry - elapsed });
});

// ── TELEGRAM ──
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

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  const msg = req.body?.message;
  if (!msg) return;

  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();

  if (chatId !== String(ADMIN_ID)) {
    return sendTg(chatId, '⛔ Нет доступа.');
  }

  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = (parts[1] || '').toUpperCase();
  const arg2 = parts.slice(1).join(' ');

  if (cmd === '/help' || cmd === '/start') {
    return sendTg(chatId,
      `👑 <b>KING SIGNAL — Панель</b>\n\n` +
      `/ban КЛЮЧ — заблокировать\n` +
      `/unban КЛЮЧ — разблокировать\n` +
      `/freeze КЛЮЧ — заморозить\n` +
      `/unfreeze КЛЮЧ — разморозить\n` +
      `/info КЛЮЧ — инфо о ключе\n` +
      `/keys — все активные ключи\n` +
      `/maintenance on — включить тех.работы\n` +
      `/maintenance off — выключить тех.работы\n` +
      `/setmsg ТЕКСТ — изменить сообщение\n` +
      `/status — статус сервиса`
    );
  }

  if (cmd === '/ban') {
    if (!arg) return sendTg(chatId, '❌ /ban КЛЮЧ');
    db.bannedKeys.add(arg);
    db.frozenKeys.delete(arg);
    return sendTg(chatId, `🚫 Ключ <code>${arg}</code> ЗАБЛОКИРОВАН.\n\nПользователь увидит это СРАЗУ при следующей проверке.`);
  }

  if (cmd === '/unban') {
    db.bannedKeys.delete(arg);
    return sendTg(chatId, `✅ Ключ <code>${arg}</code> разблокирован.`);
  }

  if (cmd === '/freeze') {
    if (!arg) return sendTg(chatId, '❌ /freeze КЛЮЧ');
    db.frozenKeys.add(arg);
    return sendTg(chatId, `❄️ Ключ <code>${arg}</code> ЗАМОРОЖЕН.\n\nПользователь увидит это СРАЗУ.`);
  }

  if (cmd === '/unfreeze') {
    db.frozenKeys.delete(arg);
    return sendTg(chatId, `✅ Ключ <code>${arg}</code> разморожен.`);
  }

  if (cmd === '/info') {
    if (!arg) return sendTg(chatId, '❌ /info КЛЮЧ');
    if (!VALID_KEYS.has(arg)) return sendTg(chatId, `❌ Ключ не существует.`);
    const act = db.activations[arg];
    const banned = db.bannedKeys.has(arg) ? '🚫 БАН' : '';
    const frozen = db.frozenKeys.has(arg) ? '❄️ ЗАМОРОЖЕН' : '';
    const flags = [banned, frozen].filter(Boolean).join(' ') || '✅ Активен';
    if (!act) return sendTg(chatId, `🔑 <code>${arg}</code>\nСтатус: не использовался`);
    const days = Math.ceil((getExpiry(arg) - (Date.now() - act.activatedAt)) / 86400000);
    return sendTg(chatId,
      `🔑 <code>${arg}</code>\n${flags}\n` +
      `Активирован: ${new Date(act.activatedAt).toLocaleString('ru')}\n` +
      `Последний вход: ${new Date(act.lastSeen).toLocaleString('ru')}\n` +
      `Осталось: ${days > 0 ? days + ' дн.' : 'истёк'}`
    );
  }

  if (cmd === '/keys') {
    const list = Object.entries(db.activations);
    if (!list.length) return sendTg(chatId, '📋 Активаций пока нет.');
    const lines = list.map(([k,v]) => {
      const b = db.bannedKeys.has(k) ? '🚫' : db.frozenKeys.has(k) ? '❄️' : '✅';
      return `${b} <code>${k}</code> — ${new Date(v.lastSeen).toLocaleDateString('ru')}`;
    });
    return sendTg(chatId, `📋 <b>Ключи (${list.length}):</b>\n\n` + lines.join('\n'));
  }

  if (cmd === '/maintenance') {
    const sub = (parts[1] || '').toLowerCase();
    if (sub === 'on') {
      db.maintenance = true;
      return sendTg(chatId, `🔧 <b>Тех.работы ВКЛЮЧЕНЫ.</b>\nВсе пользователи видят заглушку.`);
    }
    if (sub === 'off') {
      db.maintenance = false;
      return sendTg(chatId, `✅ <b>Тех.работы ВЫКЛЮЧЕНЫ.</b>\nСервис работает нормально.`);
    }
    return sendTg(chatId, `Сейчас: ${db.maintenance ? '🔧 ВКЛ' : '✅ ВЫКЛ'}\n\n/maintenance on\n/maintenance off`);
  }

  if (cmd === '/setmsg') {
    if (!arg2) return sendTg(chatId, '❌ /setmsg ТЕКСТ');
    db.maintenanceMsg = arg2;
    return sendTg(chatId, `✅ Сообщение обновлено:\n"${arg2}"`);
  }

  if (cmd === '/status') {
    return sendTg(chatId,
      `📊 <b>Статус:</b>\n\n` +
      `Тех.работы: ${db.maintenance ? '🔧 ВКЛ' : '✅ ВЫКЛ'}\n` +
      `Забанено: ${db.bannedKeys.size}\n` +
      `Заморожено: ${db.frozenKeys.size}\n` +
      `Активаций: ${Object.keys(db.activations).length}`
    );
  }

  sendTg(chatId, '❓ Неизвестная команда. /help');
});

app.get('/', (req, res) => res.json({ status: 'King Signal API running', maintenance: db.maintenance }));

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  if (BOT_TOKEN) {
    const webhookUrl = (process.env.RENDER_EXTERNAL_URL || 'https://king-signal-server.onrender.com') + '/webhook';
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${webhookUrl}`)
      .then(r => r.json())
      .then(d => console.log('✅ Webhook:', d.description))
      .catch(e => console.error('Webhook error:', e.message));
  }
});
