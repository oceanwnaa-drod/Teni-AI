// Phiên đăng nhập: chữ ký HMAC (cùng OTP_SECRET), sống 7 ngày. Không lưu gì phía máy chủ.
const crypto = require('crypto');
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret() {
  const s = process.env.OTP_SECRET;
  if (!s || s.length < 16) throw new Error('Thiếu OTP_SECRET (ít nhất 16 ký tự)');
  return s;
}
const sig = (email, exp) => crypto.createHmac('sha256', secret()).update(`session|${email}|${exp}`).digest('hex');

function makeSession(email) {
  const exp = Date.now() + TTL_MS;
  return `${Buffer.from(email).toString('base64url')}.${exp}.${sig(email, exp)}`;
}

function readSession(req) {
  const h = String((req.headers && req.headers.authorization) || '');
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [e64, expStr, s] = t.split('.');
  if (!e64 || !expStr || !s) return null;
  let email;
  try { email = Buffer.from(e64, 'base64url').toString(); } catch (e) { return null; }
  const exp = Number(expStr);
  if (!exp || Date.now() > exp) return null;
  const good = Buffer.from(sig(email, exp)), got = Buffer.from(s);
  if (good.length !== got.length || !crypto.timingSafeEqual(good, got)) return null;
  return email;
}

module.exports = { makeSession, readSession };
