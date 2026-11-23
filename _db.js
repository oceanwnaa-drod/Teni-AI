// Gọi Supabase (PostgREST) bằng service key. Chỉ chạy trên máy chủ, khóa không bao giờ gửi xuống trình duyệt.
function cfg() {
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_KEY;
  if (!u || !k) throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_KEY');
  return { u: u.replace(/\/+$/, ''), k };
}

async function sb(method, table, opt) {
  const { q = '', body, prefer } = opt || {};
  const { u, k } = cfg();
  const headers = { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const r = await fetch(`${u}/rest/v1/${table}${q ? '?' + q : ''}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let d = null;
  try { d = t ? JSON.parse(t) : null; } catch (e) { /* không phải JSON */ }
  if (!r.ok) {
    const e = new Error((d && d.message) || 'Lỗi cơ sở dữ liệu ' + r.status);
    e.status = r.status; e.pg = d && d.code;
    throw e;
  }
  return d;
}

const eq = (v) => 'eq.' + encodeURIComponent(v);
const quoted = (arr) => '(' + arr.map((x) => '"' + String(x).replace(/["\\]/g, '') + '"').join(',') + ')';

module.exports = {
  eq, quoted,
  select: (t, q) => sb('GET', t, { q }),
  insert: (t, rows) => sb('POST', t, { body: rows, prefer: 'return=representation' }),
  upsert: (t, rows, onConflict) => sb('POST', t, { q: 'on_conflict=' + onConflict, body: rows, prefer: 'resolution=merge-duplicates,return=representation' }),
  patch: (t, q, body) => sb('PATCH', t, { q, body, prefer: 'return=representation' }),
  del: (t, q) => sb('DELETE', t, { q, prefer: 'return=minimal' }),
};
