const nodemailer = require('nodemailer');
const { makeCode, makeToken, isGmail } = require('./_otp');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  if (!isGmail(email)) return res.status(400).json({ error: 'Vui lòng dùng địa chỉ Gmail hợp lệ.' });

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return res.status(500).json({ error: 'Máy chủ chưa cấu hình gửi mail.' });

  try {
    const code = makeCode();
    const token = makeToken(email, code);
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass: pass.replace(/\s+/g, '') },
    });
    await transporter.sendMail({
      from: `"Teni AI" <${user}>`,
      to: email,
      subject: `Mã xác nhận Teni AI: ${code}`,
      text: `Mã xác nhận Teni AI của bạn là ${code}. Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.`,
      html:
        `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #dcebd2;border-radius:16px">` +
        `<h2 style="color:#2f7d32;margin:0 0 8px">Teni AI</h2>` +
        `<p style="color:#333">Mã xác nhận của bạn là:</p>` +
        `<p style="font-size:34px;font-weight:800;letter-spacing:8px;background:#f1f8ea;border-radius:12px;text-align:center;padding:14px;margin:12px 0;color:#2f7d32">${code}</p>` +
        `<p style="color:#666;font-size:13px">Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p></div>`,
    });
    return res.status(200).json({ ok: true, token });
  } catch (e) {
    console.error('send-code failed:', e && e.message);
    return res.status(500).json({ error: 'Không gửi được email. Hãy thử lại sau.' });
  }
};
