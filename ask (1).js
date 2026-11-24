// "Hỏi Teni": gia sư AI. Khóa API chỉ nằm trên máy chủ (biến ANTHROPIC_API_KEY), trình duyệt không bao giờ thấy.
// Chỉ người đã đăng nhập mới hỏi được, và mỗi người có giới hạn số câu hỏi mỗi ngày để không bị lạm dụng.
const { readSession } = require('./_auth');
const db = require('./_db');

const MODEL = process.env.AI_MODEL || 'claude-haiku-5-5';
const GMODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const DAILY = Math.max(1, Math.min(500, parseInt(process.env.AI_DAILY_LIMIT, 10) || 30));
const SYSTEM =
  'Bạn là Teni, một chú rùa gia sư thân thiện giúp học sinh Việt Nam (lớp 6 đến lớp 12). ' +
  'Luôn trả lời bằng tiếng Việt, ngắn gọn, dễ hiểu, giọng ấm áp. ' +
  'Khi học sinh hỏi bài, hãy giải thích từng bước và gợi ý để các em tự hiểu, đừng chỉ đưa đáp án. ' +
  'Nếu câu hỏi không liên quan đến học tập, nhẹ nhàng kéo lại chủ đề học. ' +
  'Không nói nội dung không phù hợp với học sinh. Nếu không chắc chắn, hãy nói thật là chưa chắc và khuyên hỏi giáo viên. ' +
  'Không dùng ký hiệu định dạng markdown nặng; có thể dùng xuống dòng và số thứ tự đơn giản.';

const fail = (res, c, m) => res.status(c).json({ error: m });

function cleanMessages(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const m of arr.slice(-10)) {
    const role = m && m.role === 'assistant' ? 'assistant' : m && m.role === 'user' ? 'user' : null;
    const content = String((m && m.content) || '').trim().slice(0, 1200);
    if (!role || !content) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += '\n' + content;
    else out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return fail(res, 405, 'Method not allowed');
  let email;
  try { email = readSession(req); } catch (e) { console.error('ask auth:', e.message); return fail(res, 500, 'Lỗi máy chủ.'); }
  if (!email) return fail(res, 401, 'Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.');

  const gkey = process.env.GEMINI_API_KEY;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!gkey && !key) return fail(res, 503, 'Teni AI chưa được bật trên máy chủ.');

  const b = req.body || {};
  const messages = cleanMessages(b.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return fail(res, 400, 'Hãy nhập câu hỏi.');
  const subject = String(b.subject || '').trim().slice(0, 40);

  // giới hạn mỗi ngày (giờ Việt Nam)
  const day = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  let used = 0;
  try {
    const r = await db.select('ai_usage', `email=${db.eq(email)}&day=${db.eq(day)}&select=n&limit=1`);
    used = (r && r[0] && r[0].n) || 0;
    if (used >= DAILY) return fail(res, 429, `Hôm nay bạn đã hỏi ${DAILY} câu rồi. Mai quay lại hỏi tiếp nhé!`);
    await db.upsert('ai_usage', [{ email, day, n: used + 1 }], 'email,day');
  } catch (e) {
    console.error('ask usage:', e.message);
    return fail(res, 500, 'Lỗi máy chủ.');
  }

  try {
    const sys = SYSTEM + (subject ? ` Học sinh đang xem môn: ${subject}.` : '');
    let r;
    if (gkey) {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GMODEL}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': gkey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: 800 },
        }),
      });
    } else {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: MODEL, max_tokens: 600, system: sys, messages }),
      });
    }
    const t = await r.text();
    let d = null;
    try { d = JSON.parse(t); } catch (e) { /* không phải JSON */ }
    if (!r.ok) {
      console.error('ask api', r.status, d && d.error && d.error.message);
      if (r.status === 429 || r.status === 529 || r.status === 503) return fail(res, 503, 'Teni đang bận, bạn thử lại sau ít phút nhé.');
      return fail(res, 502, 'Teni chưa trả lời được, hãy thử lại sau.');
    }
    const text = gkey
      ? ((d && d.candidates && d.candidates[0] && d.candidates[0].content && d.candidates[0].content.parts) || []).map((x) => x.text || '').join('\n').trim()
      : ((d && d.content) || []).filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();
    if (!text) return fail(res, 502, 'Teni chưa trả lời được, hãy thử lại sau.');
    return res.status(200).json({ reply: text, left: Math.max(0, DAILY - used - 1) });
  } catch (e) {
    console.error('ask fetch:', e.message);
    return fail(res, 502, 'Teni chưa trả lời được, hãy thử lại sau.');
  }
};
