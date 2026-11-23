// Tạo và kiểm tra mã bằng chữ ký HMAC, không cần cơ sở dữ liệu.
const crypto = require('crypto');

const TTL_MS = 10 * 60 * 1000; // mã sống 10 phút

function secret() {
  const s = process.env.OTP_SECRET;
  if (!s || s.length < 16) throw new Error('Thiếu OTP_SECRET (ít nhất 16 ký tự)');
  return s;
}

function sign(email, code, exp) {
  return crypto.createHmac('sha256', secret()).update(`${email}|${code}|${exp}`).digest('hex');
}

function makeCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function makeToken(email, code) {
  const exp = Date.now() + TTL_MS;
  return `${exp}.${sign(email, code, exp)}`;
}

function checkToken(email, code, token) {
  const [expStr, sig] = String(token || '').split('.');
  const exp = Number(expStr);
  if (!exp || !sig || Date.now() > exp) return false;
  const good = Buffer.from(sign(email, code, exp));
  const got = Buffer.from(sig);
  return good.length === got.length && crypto.timingSafeEqual(good, got);
}

function isGmail(e) {
  return /^[^\s@]+@gmail\.com$/i.test(e) && e.length <= 254;
}

module.exports = { makeCode, makeToken, checkToken, isGmail };
