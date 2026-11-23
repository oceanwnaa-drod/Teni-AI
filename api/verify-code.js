const { checkToken, isGmail } = require('./_otp');
const { makeSession } = require('./_auth');
const db = require('./_db');

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const code = String(b.code || '').replace(/\D/g, '');
  if (!isGmail(email) || code.length !== 6) return res.status(400).json({ error: 'Dữ liệu không hợp lệ.' });
  try {
    // Giới hạn số lần đoán mã (cần cơ sở dữ liệu)
    let row = null;
    const rows = await db.select('otp_fails', `email=${db.eq(email)}&limit=1`);
    row = rows && rows[0];
    const lockedNow = row && row.n >= MAX_FAILS && Date.now() < Date.parse(row.until);
    if (lockedNow) return res.status(429).json({ error: 'Nhập sai quá nhiều lần. Hãy thử lại sau 15 phút.' });
    const prev = row && !(row.n >= MAX_FAILS) ? row.n : 0;

    if (checkToken(email, code, b.token)) {
      if (row) await db.del('otp_fails', `email=${db.eq(email)}`);
      return res.status(200).json({ ok: true, session: makeSession(email) });
    }
    await db.upsert('otp_fails', [{ email, n: prev + 1, until: new Date(Date.now() + LOCK_MS).toISOString() }], 'email');
    return res.status(401).json({ error: 'Mã sai hoặc đã hết hạn.' });
  } catch (e) {
    console.error('verify-code failed:', e && e.message);
    return res.status(500).json({ error: 'Lỗi máy chủ.' });
  }
};
