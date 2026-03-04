const express = require('express');
const { MongoClient } = require('mongodb');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://YOUR_USER:YOUR_PASS@cluster.mongodb.net/kingsignal';
const BOT_TOKEN = process.env.BOT_TOKEN || '8639490181:AAHlTgtVDsRuohlt0ZgcGV2h0J4vz7o5pLQ';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || ''; // заполни свой Telegram ID

let db;
MongoClient.connect(MONGO_URI).then(client => {
  db = client.db('kingsignal');
  console.log('✅ MongoDB подключён');
}).catch(err => console.error('❌ MongoDB ошибка:', err));

// Отправка сообщения в Telegram
async function sendTelegram(chatId, text, parse_mode = 'HTML') {
  const fetch = (await import('node-fetch')).default;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode })
  });
}

// ─── ПРОВЕРКА КЛЮЧА + АЙДИ ───────────────────────────────────────────────────
app.get('/check', async (req, res) => {
  const key = (req.query.key || '').toUpperCase().trim();
  const playerId = (req.query.player_id || '').toUpperCase().trim();

  if (!key) return res.json({ status: 'invalid' });

  try {
    const record = await db.collection('keys').findOne({ key });
    if (!record) return res.json({ status: 'invalid' });

    if (record.status === 'maintenance') return res.json({ status: 'maintenance', message: record.message || 'Технические работы' });
    if (record.status === 'banned') return res.json({ status: 'banned', message: record.message || 'Ваш ключ заблокирован.' });
    if (record.status === 'frozen') return res.json({ status: 'frozen', message: record.message || 'Ваш ключ заморожен.' });

    const now = Date.now();
    if (record.expiresAt && record.expiresAt < now) return res.json({ status: 'expired' });

    // Если указан playerId — проверяем или привязываем
    if (playerId) {
      if (record.playerId && record.playerId !== playerId) {
        return res.json({ status: 'invalid', message: 'Айди не совпадает с ключом.' });
      }
      if (!record.playerId) {
        await db.collection('keys').updateOne({ key }, { $set: { playerId } });
      }
    } else if (!record.playerId) {
      return res.json({ status: 'need_player_id' });
    }

    // Получаем или создаём профиль игрока
    const pid = playerId || record.playerId;
    let player = await db.collection('players').findOne({ playerId: pid });
    if (!player) {
      await db.collection('players').insertOne({ playerId: pid, balance: 0, key, createdAt: now });
      player = { playerId: pid, balance: 0 };
    }

    return res.json({
      status: 'ok',
      key: record.key,
      playerId: pid,
      expiresIn: record.expiresAt ? record.expiresAt - now : null,
      balance: player.balance || 0
    });
  } catch (e) {
    console.error(e);
    res.json({ status: 'error' });
  }
});

// ─── ПОЛУЧИТЬ БАЛАНС ─────────────────────────────────────────────────────────
app.get('/balance', async (req, res) => {
  const playerId = (req.query.player_id || '').toUpperCase().trim();
  if (!playerId) return res.json({ balance: 0 });
  try {
    const player = await db.collection('players').findOne({ playerId });
    res.json({ balance: player ? player.balance : 0 });
  } catch (e) {
    res.json({ balance: 0 });
  }
});

// ─── ЗАПРОС НА ПОПОЛНЕНИЕ (от игрока) ────────────────────────────────────────
app.post('/deposit/request', async (req, res) => {
  const { playerId } = req.body;
  if (!playerId) return res.json({ ok: false });
  // Просто уведомляем админа — фактическое зачисление через бота
  if (ADMIN_CHAT_ID) {
    await sendTelegram(ADMIN_CHAT_ID,
      `💰 <b>ЗАПРОС ПОПОЛНЕНИЯ</b>\n\nАйди игрока: <code>${playerId}</code>\n\nЧтобы начислить баланс введи:\n/deposit ${playerId} [сумма]`
    );
  }
  res.json({ ok: true });
});

// ─── ЗАПРОС НА ВЫВОД (от игрока) ─────────────────────────────────────────────
app.post('/withdraw/request', async (req, res) => {
  const { playerId, amount, bank, cardNumber } = req.body;
  if (!playerId || !amount || !bank) return res.json({ ok: false, message: 'Не все поля заполнены' });

  try {
    const player = await db.collection('players').findOne({ playerId: playerId.toUpperCase() });
    if (!player) return res.json({ ok: false, message: 'Игрок не найден' });
    if ((player.balance || 0) < amount) return res.json({ ok: false, message: 'Недостаточно средств' });

    // Замораживаем сумму (резерв)
    await db.collection('players').updateOne(
      { playerId: playerId.toUpperCase() },
      { $inc: { balance: -amount }, $push: { withdrawHistory: { amount, bank, cardNumber, status: 'pending', date: Date.now() } } }
    );

    if (ADMIN_CHAT_ID) {
      await sendTelegram(ADMIN_CHAT_ID,
        `📤 <b>ЗАЯВКА НА ВЫВОД</b>\n\n` +
        `Айди: <code>${playerId.toUpperCase()}</code>\n` +
        `Сумма: <b>${amount} KGS</b>\n` +
        `Банк: <b>${bank}</b>\n` +
        `Карта/Номер: <code>${cardNumber || '—'}</code>\n\n` +
        `Для подтверждения: /confirm_withdraw ${playerId.toUpperCase()}\n` +
        `Для отмены (вернуть): /cancel_withdraw ${playerId.toUpperCase()} ${amount}`
      );
    }

    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.json({ ok: false, message: 'Ошибка сервера' });
  }
});

// ─── НАЧИСЛИТЬ БАЛАНС (от бота) ───────────────────────────────────────────────
app.post('/admin/deposit', async (req, res) => {
  const { secret, playerId, amount } = req.body;
  if (secret !== process.env.ADMIN_SECRET) return res.status(403).json({ ok: false });
  try {
    const pid = playerId.toUpperCase();
    const result = await db.collection('players').findOneAndUpdate(
      { playerId: pid },
      { $inc: { balance: Number(amount) } },
      { returnDocument: 'after', upsert: true }
    );
    res.json({ ok: true, balance: result.balance });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ─── ПОМЕНЯТЬ КЛЮЧ ────────────────────────────────────────────────────────────
app.post('/change-key', async (req, res) => {
  const { playerId, oldKey, newKey } = req.body;
  if (!playerId || !oldKey || !newKey) return res.json({ ok: false, message: 'Не все поля' });
  try {
    const pid = playerId.toUpperCase().trim();
    const ok = (await db.collection('keys').findOne({ key: oldKey.toUpperCase(), playerId: pid }));
    if (!ok) return res.json({ ok: false, message: 'Неверный текущий ключ или айди' });
    const newRecord = await db.collection('keys').findOne({ key: newKey.toUpperCase() });
    if (!newRecord) return res.json({ ok: false, message: 'Новый ключ не найден' });
    if (newRecord.playerId && newRecord.playerId !== pid) return res.json({ ok: false, message: 'Новый ключ уже занят' });
    await db.collection('keys').updateOne({ key: oldKey.toUpperCase() }, { $unset: { playerId: '' } });
    await db.collection('keys').updateOne({ key: newKey.toUpperCase() }, { $set: { playerId: pid } });
    await db.collection('players').updateOne({ playerId: pid }, { $set: { key: newKey.toUpperCase() } });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, message: 'Ошибка сервера' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
