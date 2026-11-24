// Máy chủ cho tài khoản, không gian học tập, bài học và thông báo.
// Mọi thao tác đều kiểm tra phiên đăng nhập và vai trò trước khi ghi vào Supabase.
const crypto = require('crypto');
const db = require('./_db');
const { readSession } = require('./_auth');
const { isGmail } = require('./_otp');

const SUBJECTS = ['toan', 'van', 'anh', 'ly', 'hoa', 'sinh', 'su', 'dia'];
const CODE_RE = /^TENI-[A-Z0-9]{4}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

// ====== Tệp theo môn ======
const FILE_TYPES = {
  pdf: 'application/pdf', doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
};
const FILE_MAX = 3 * 1048576; // 3 MB mỗi tệp (giới hạn body của Vercel là 4,5 MB)
const FILE_PER_SPACE = 150;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function fail(http, msg) { const e = new Error(msg); e.http = http; return e; }
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function newCode() {
  let s = '';
  for (let i = 0; i < 4; i++) s += ALPHA[crypto.randomInt(0, ALPHA.length)];
  return 'TENI-' + s;
}

function codeOf(b) {
  const c = String(b.code || '').trim().toUpperCase();
  if (!CODE_RE.test(c)) throw fail(400, 'Mã không gian không hợp lệ.');
  return c;
}

async function getMember(code, email) {
  const r = await db.select('members', `space_code=${db.eq(code)}&email=${db.eq(email)}&limit=1`);
  return r && r[0] || null;
}

// Trả về thành viên đang hoạt động, hoặc báo lỗi nếu không đủ quyền.
async function need(code, email, roles) {
  const m = await getMember(code, email);
  if (!m || m.status !== 'active') throw fail(403, 'Bạn không thuộc không gian này.');
  if (roles && roles.indexOf(m.role) < 0) throw fail(403, 'Bạn không có quyền làm việc này.');
  return m;
}

function shape(space, m) {
  return { status: m.status, role: m.role || null, want: m.want_role || null, code: space.code, name: space.name, owner: space.owner === m.email };
}


const EVENT_KINDS = ['tab_hidden', 'window_blur', 'fullscreen_exit', 'gaze', 'noface', 'noise', 'cam_declined', 'cam_error', 'cam_lost', 'snap', 'reopen'];
const ALERT_KINDS = ['tab_hidden', 'window_blur', 'fullscreen_exit', 'gaze', 'noface', 'noise', 'cam_declined', 'cam_error', 'cam_lost'];

async function getExam(code, id) {
  if (!ID_RE.test(String(id))) throw fail(400, 'Mã bài không hợp lệ.');
  const ex = (await db.select('exams', `id=${db.eq(id)}&space_code=${db.eq(code)}&limit=1`))[0];
  if (!ex) throw fail(404, 'Không tìm thấy bài kiểm tra.');
  return ex;
}
function cleanAnswers(a, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const v = Array.isArray(a) ? a[i] : null; out.push(Number.isInteger(v) && v >= 0 && v < 6 ? v : null); }
  return out;
}
function addEvent(exam_id, email, kind, detail, secs, snap) {
  return db.insert('exam_events', [{ exam_id, email, kind, detail, secs, snap, at: Date.now() }]);
}

const actions = {
  async 'account.get'(b, email) {
    const r = await db.select('accounts', `email=${db.eq(email)}&limit=1`);
    return { name: r && r[0] ? r[0].name : null };
  },

  async 'account.set'(b, email) {
    const name = str(b.name, 60);
    if (!name) throw fail(400, 'Vui lòng nhập họ và tên.');
    await db.upsert('accounts', [{ email, name }], 'email');
    return { name };
  },

  async 'space.create'(b, email) {
    const name = str(b.name, 60);
    if (!name) throw fail(400, 'Hãy đặt tên cho không gian.');
    const mine = await db.select('spaces', `owner=${db.eq(email)}&select=code`);
    if (mine.length >= 10) throw fail(429, 'Bạn đã tạo quá nhiều không gian.');
    for (let i = 0; i < 8; i++) {
      const code = newCode();
      try {
        await db.insert('spaces', [{ code, name, owner: email }]);
      } catch (e) {
        if (e.status === 409) continue;
        throw e;
      }
      await db.insert('members', [{ space_code: code, email, role: 'ql', status: 'active' }]);
      return { code, name };
    }
    throw fail(500, 'Không tạo được mã, hãy thử lại.');
  },

  async 'space.join'(b, email) {
    const code = codeOf(b);
    const sp = (await db.select('spaces', `code=${db.eq(code)}&limit=1`))[0];
    if (!sp) throw fail(404, 'Không tìm thấy không gian với mã này.');
    let m = await getMember(code, email);
    if (!m) {
      await db.insert('members', [{ space_code: code, email, status: 'pending' }]);
      return { status: 'pending', name: sp.name, code };
    }
    if (m.status === 'invited') {
      const r = await db.patch('members', `space_code=${db.eq(code)}&email=${db.eq(email)}`, { status: 'active' });
      m = r[0];
    }
    return shape(sp, m);
  },

  async 'space.me'(b, email) {
    const code = codeOf(b);
    const sp = (await db.select('spaces', `code=${db.eq(code)}&limit=1`))[0];
    const m = sp && await getMember(code, email);
    if (!m) throw fail(404, 'Bạn không thuộc không gian này.');
    return shape(sp, m);
  },

  // Học sinh tự chọn vai trò. Chọn Học sinh vào ngay; chọn Giáo viên thì chờ người quản lý xác nhận.
  async 'space.setrole'(b, email) {
    const code = codeOf(b);
    const m = await need(code, email);
    if (m.role) throw fail(409, 'Bạn đã có vai trò trong không gian này.');
    const role = b.role === 'gv' ? 'gv' : b.role === 'hs' ? 'hs' : null;
    if (!role) throw fail(400, 'Hãy chọn Giáo viên hoặc Học sinh.');
    const patch = role === 'hs' ? { role: 'hs', want_role: null } : { want_role: 'gv' };
    await db.patch('members', `space_code=${db.eq(code)}&email=${db.eq(email)}`, patch);
    return role === 'hs' ? { role: 'hs' } : { role: null, want: 'gv' };
  },

  async 'space.members'(b, email) {
    const code = codeOf(b);
    const me = await need(code, email, ['ql', 'gv']);
    const rows = await db.select('members', `space_code=${db.eq(code)}&select=email,role,want_role,status&order=created_at.asc`);
    return { members: me.role === 'ql' ? rows : rows.filter((r) => r.status === 'active') };
  },

  async 'space.invite'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql']);
    const target = str(b.email, 254).toLowerCase();
    if (!isGmail(target)) throw fail(400, 'Vui lòng nhập Gmail hợp lệ.');
    const m = await getMember(code, target);
    if (m && m.status === 'active') throw fail(409, 'Gmail này đã là thành viên.');
    if (m) await db.patch('members', `space_code=${db.eq(code)}&email=${db.eq(target)}`, { status: m.status === 'pending' ? 'active' : 'invited' });
    else await db.insert('members', [{ space_code: code, email: target, status: 'invited' }]);
    return { ok: true };
  },

  // kind 'join' = duyệt yêu cầu vào; kind 'teacher' = xác nhận làm giáo viên
  async 'space.decide'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql']);
    const target = str(b.email, 254).toLowerCase();
    const m = await getMember(code, target);
    if (!m) throw fail(404, 'Không tìm thấy thành viên.');
    const q = `space_code=${db.eq(code)}&email=${db.eq(target)}`;
    if (b.kind === 'teacher') {
      if (m.status !== 'active' || m.want_role !== 'gv') throw fail(409, 'Thành viên này không có yêu cầu làm giáo viên.');
      await db.patch('members', q, b.ok ? { role: 'gv', want_role: null } : { role: 'hs', want_role: null });
    } else {
      if (m.status !== 'pending') throw fail(409, 'Yêu cầu này không còn chờ duyệt.');
      if (b.ok) await db.patch('members', q, { status: 'active' });
      else await db.del('members', q);
    }
    return { ok: true };
  },

  async 'lessons.get'(b, email) {
    const code = codeOf(b);
    await need(code, email);
    const rows = await db.select('lessons', `space_code=${db.eq(code)}&select=id,subject,title,pos&order=pos.asc`);
    const out = {};
    SUBJECTS.forEach((s) => { out[s] = []; });
    rows.forEach((r) => { if (out[r.subject]) out[r.subject].push({ id: r.id, t: r.title }); });
    return { lessons: out };
  },

  async 'lessons.set'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql', 'gv']);
    if (SUBJECTS.indexOf(b.subject) < 0) throw fail(400, 'Môn học không hợp lệ.');
    if (!Array.isArray(b.list) || b.list.length > 500) throw fail(400, 'Danh sách bài học không hợp lệ.');
    const seen = {};
    const rows = b.list.map((l, i) => {
      const id = String(l && l.id);
      if (!ID_RE.test(id) || seen[id]) throw fail(400, 'Mã bài học không hợp lệ.');
      seen[id] = 1;
      return { space_code: code, id, subject: b.subject, title: str(l.t, 80), pos: i };
    });
    if (rows.length) await db.upsert('lessons', rows, 'space_code,id');
    const keep = rows.length ? `&id=not.in.${db.quoted(rows.map((r) => r.id))}` : '';
    await db.del('lessons', `space_code=${db.eq(code)}&subject=${db.eq(b.subject)}${keep}`);
    return { ok: true, count: rows.length };
  },


  // ====== Tệp theo môn: giáo viên đăng, học sinh xem và tải ======
  async 'files.list'(b, email) {
    const code = codeOf(b);
    await need(code, email);
    const rows = await db.select('subject_files', `space_code=${db.eq(code)}&select=id,subject,name,size,by_name,created_at&order=created_at.desc&limit=${FILE_PER_SPACE}`);
    const out = {};
    SUBJECTS.forEach((x) => { out[x] = []; });
    rows.forEach((r) => { if (out[r.subject]) out[r.subject].push({ id: r.id, name: r.name, size: r.size, by: r.by_name, at: Date.parse(r.created_at) }); });
    return { files: out };
  },

  async 'files.add'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql', 'gv']);
    if (SUBJECTS.indexOf(b.subject) < 0) throw fail(400, 'Môn học không hợp lệ.');
    const name = str(b.name, 120).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!name || !Object.prototype.hasOwnProperty.call(FILE_TYPES, ext)) throw fail(400, 'Chỉ nhận PDF, Word, PowerPoint, Excel, TXT, PNG, JPG.');
    const data = String(b.data || '');
    if (!data || data.length > Math.ceil(FILE_MAX * 4 / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw fail(400, 'Tệp không hợp lệ hoặc lớn hơn 3 MB.');
    const size = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
    if (size > FILE_MAX) throw fail(400, 'Tệp lớn hơn 3 MB.');
    const have = await db.select('subject_files', `space_code=${db.eq(code)}&select=id&limit=${FILE_PER_SPACE + 1}`);
    if (have.length >= FILE_PER_SPACE) throw fail(400, 'Đã đủ ' + FILE_PER_SPACE + ' tệp, hãy xóa bớt tệp cũ.');
    const acc = (await db.select('accounts', `email=${db.eq(email)}&limit=1`))[0];
    const id = 'f' + crypto.randomBytes(8).toString('hex');
    await db.insert('subject_files', [{ space_code: code, id, subject: b.subject, name, mime: FILE_TYPES[ext], size, data, by_name: str((acc && acc.name) || email.split('@')[0], 60) }]);
    return { ok: true, file: { id, name, size, at: Date.now() } };
  },

  async 'files.get'(b, email) {
    const code = codeOf(b);
    await need(code, email);
    if (!ID_RE.test(String(b.id))) throw fail(400, 'Mã tệp không hợp lệ.');
    const r = (await db.select('subject_files', `space_code=${db.eq(code)}&id=${db.eq(b.id)}&select=name,mime,data&limit=1`))[0];
    if (!r) throw fail(404, 'Không tìm thấy tệp.');
    return { name: r.name, mime: r.mime, data: r.data };
  },

  async 'files.del'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql', 'gv']);
    if (!ID_RE.test(String(b.id))) throw fail(400, 'Mã tệp không hợp lệ.');
    await db.del('subject_files', `space_code=${db.eq(code)}&id=${db.eq(b.id)}`);
    return { ok: true };
  },

  async 'notice.add'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql', 'gv']);
    const title = str(b.title, 60), body = str(b.body, 300);
    if (!title || !body) throw fail(400, 'Hãy nhập tiêu đề và nội dung.');
    const acc = (await db.select('accounts', `email=${db.eq(email)}&limit=1`))[0];
    await db.insert('notices', [{ space_code: code, title, body, by_name: str(b.by || (acc && acc.name) || email.split('@')[0], 60) }]);
    return { ok: true };
  },

  async 'notice.list'(b, email) {
    const code = codeOf(b);
    await need(code, email);
    const rows = await db.select('notices', `space_code=${db.eq(code)}&select=title,body,by_name,created_at&order=created_at.desc&limit=5`);
    return { notices: rows.map((r) => ({ t: r.title, b: r.body, by: r.by_name, at: Date.parse(r.created_at) })) };
  },
  // ====== Kiểm tra & giám sát ======
  async 'exam.create'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql', 'gv']);
    const title = str(b.title, 70);
    if (!title) throw fail(400, 'Hãy nhập tên bài kiểm tra.');
    const subject = SUBJECTS.indexOf(b.subject) >= 0 ? b.subject : '';
    const starts = Number(b.starts_at), minutes = Math.floor(Number(b.minutes));
    if (!Number.isFinite(starts) || starts < 1e12 || starts > 4e12) throw fail(400, 'Ngày giờ chưa hợp lệ.');
    if (!(minutes >= 5 && minutes <= 240)) throw fail(400, 'Thời gian làm bài từ 5 đến 240 phút.');
    if (!Array.isArray(b.questions) || b.questions.length < 1 || b.questions.length > 100) throw fail(400, 'Bài kiểm tra cần từ 1 đến 100 câu hỏi.');
    const questions = b.questions.map((q, i) => {
      const text = str(q && q.q, 300);
      const o = Array.isArray(q && q.o) ? q.o.map((x) => str(x, 150)) : [];
      const a = Number(q && q.a);
      if (!text) throw fail(400, 'Câu ' + (i + 1) + ' chưa có nội dung.');
      if (o.length < 2 || o.length > 6 || o.some((x) => !x)) throw fail(400, 'Câu ' + (i + 1) + ' cần 2–6 đáp án, không để trống.');
      if (!Number.isInteger(a) || a < 0 || a >= o.length) throw fail(400, 'Câu ' + (i + 1) + ' chưa chọn đáp án đúng.');
      return { q: text, o, a };
    });
    const id = crypto.randomBytes(6).toString('hex');
    await db.insert('exams', [{ id, space_code: code, title, subject, class_name: str(b.class_name, 40), starts_at: Math.floor(starts), minutes, require_cam: !!b.require_cam, questions, created_by: email }]);
    return { id };
  },

  // Giáo viên/quản lý: danh sách đề (kèm số câu). Học sinh: đề của không gian và trạng thái bài làm của mình (không có đáp án).
  async 'exam.list'(b, email) {
    const code = codeOf(b);
    const me = await need(code, email);
    const rows = await db.select('exams', `space_code=${db.eq(code)}&select=id,title,subject,class_name,starts_at,minutes,require_cam,questions&order=starts_at.desc&limit=100`);
    const exams = rows.map((r) => ({ id: r.id, title: r.title, subject: r.subject, cls: r.class_name, at: Number(r.starts_at), min: r.minutes, cam: !!r.require_cam, n: (r.questions || []).length }));
    if (me.role === 'hs') {
      const mine = await db.select('exam_attempts', `email=${db.eq(email)}&select=exam_id,status,score,total`);
      const by = {}; mine.forEach((a) => { by[a.exam_id] = a; });
      exams.forEach((x) => { const a = by[x.id]; x.my = a ? { status: a.status, score: a.score, total: a.total } : null; });
    } else if (me.role !== 'ql' && me.role !== 'gv') throw fail(403, 'Bạn chưa có vai trò trong không gian này.');
    return { exams, now: Date.now() };
  },

  async 'exam.delete'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql', 'gv']);
    if (!ID_RE.test(String(b.id))) throw fail(400, 'Mã bài không hợp lệ.');
    await db.del('exams', `id=${db.eq(b.id)}&space_code=${db.eq(code)}`);
    return { ok: true };
  },

  // Học sinh bắt đầu / làm tiếp. Máy chủ kiểm tra khung giờ, bắt buộc camera nếu đề yêu cầu, và không bao giờ gửi đáp án.
  async 'exam.start'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['hs']);
    const ex = await getExam(code, b.id);
    const now = Date.now(), end = Number(ex.starts_at) + ex.minutes * 60000;
    let at = (await db.select('exam_attempts', `exam_id=${db.eq(ex.id)}&email=${db.eq(email)}&limit=1`))[0];
    if (at && at.status === 'submitted') return { status: 'submitted', score: at.score, total: at.total };
    if (now < Number(ex.starts_at)) throw fail(409, 'Bài kiểm tra chưa đến giờ bắt đầu.');
    if (now > end) throw fail(409, 'Bài kiểm tra đã kết thúc.');
    const cam = b.cam === 'agreed' ? 'agreed' : b.cam === 'declined' ? 'declined' : 'none';
    if (ex.require_cam && cam !== 'agreed') throw fail(403, 'Bài kiểm tra này bắt buộc bật camera.');
    if (!at) {
      at = (await db.insert('exam_attempts', [{ exam_id: ex.id, email, status: 'doing', started_at: now, answers: [], cam }]))[0];
      if (cam === 'declined') await addEvent(ex.id, email, 'cam_declined', 'Không đồng ý bật camera', 0, null);
    } else {
      await db.patch('exam_attempts', `exam_id=${db.eq(ex.id)}&email=${db.eq(email)}`, { cam });
      await addEvent(ex.id, email, 'reopen', 'Mở lại bài làm', 0, null);
    }
    return {
      status: 'doing', deadline: end, now, cam: !!ex.require_cam, answers: at.answers || [],
      exam: { id: ex.id, title: ex.title, minutes: ex.minutes, questions: ex.questions.map((q) => ({ q: q.q, o: q.o })) },
    };
  },

  async 'exam.save'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['hs']);
    const ex = await getExam(code, b.id);
    const at = (await db.select('exam_attempts', `exam_id=${db.eq(ex.id)}&email=${db.eq(email)}&limit=1`))[0];
    if (!at || at.status !== 'doing') throw fail(409, 'Bài làm đã nộp hoặc chưa bắt đầu.');
    if (Date.now() > Number(ex.starts_at) + ex.minutes * 60000 + 60000) throw fail(409, 'Đã hết giờ.');
    await db.patch('exam_attempts', `exam_id=${db.eq(ex.id)}&email=${db.eq(email)}`, { answers: cleanAnswers(b.answers, ex.questions.length) });
    return { ok: true };
  },

  async 'exam.submit'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['hs']);
    const ex = await getExam(code, b.id);
    const at = (await db.select('exam_attempts', `exam_id=${db.eq(ex.id)}&email=${db.eq(email)}&limit=1`))[0];
    if (!at) throw fail(409, 'Bạn chưa bắt đầu bài này.');
    if (at.status === 'submitted') return { status: 'submitted', score: at.score, total: at.total };
    const ans = b.answers === undefined ? (at.answers || []) : cleanAnswers(b.answers, ex.questions.length);
    let score = 0;
    ex.questions.forEach((q, i) => { if (ans[i] === q.a) score++; });
    await db.patch('exam_attempts', `exam_id=${db.eq(ex.id)}&email=${db.eq(email)}`, { status: 'submitted', submitted_at: Date.now(), answers: ans, score, total: ex.questions.length });
    return { status: 'submitted', score, total: ex.questions.length };
  },

  // Học sinh gửi cảnh báo (chuyển tab, thoát toàn màn hình, nhìn lệch, ồn...). Máy chủ chỉ ghi lại, giáo viên quyết định.
  async 'exam.event'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['hs']);
    const ex = await getExam(code, b.id);
    if (EVENT_KINDS.indexOf(b.kind) < 0) throw fail(400, 'Loại sự kiện không hợp lệ.');
    const at = (await db.select('exam_attempts', `exam_id=${db.eq(ex.id)}&email=${db.eq(email)}&limit=1`))[0];
    if (!at || at.status !== 'doing') return { ok: false };
    let snap = null;
    if (b.snap) {
      snap = String(b.snap);
      if (snap.indexOf('data:image/jpeg;base64,') !== 0 || snap.length > 20000 || !/^[A-Za-z0-9+/=,:;\/-]+$/.test(snap)) snap = null;
    }
    const used = await db.select('exam_events', `exam_id=${db.eq(ex.id)}&email=${db.eq(email)}&kind=neq.snap&select=id`);
    if (b.kind !== 'snap' && used.length >= 600) return { ok: false };
    if (b.kind === 'snap') {
      if (!snap) return { ok: false };
      await db.del('exam_events', `exam_id=${db.eq(ex.id)}&email=${db.eq(email)}&kind=eq.snap`);
    }
    await addEvent(ex.id, email, b.kind, str(b.detail, 120), Math.max(0, Math.min(86400, Math.floor(Number(b.secs) || 0))), snap);
    return { ok: true };
  },

  // Giáo viên: danh sách học sinh với trạng thái, tiến độ, số cảnh báo và ảnh gần nhất.
  async 'exam.monitor'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql', 'gv']);
    const ex = await getExam(code, b.id);
    const total = ex.questions.length;
    const [mem, ats, evs, snaps] = await Promise.all([
      db.select('members', `space_code=${db.eq(code)}&role=eq.hs&status=eq.active&select=email`),
      db.select('exam_attempts', `exam_id=${db.eq(ex.id)}&select=email,status,answers,score,total,cam,started_at,submitted_at`),
      db.select('exam_events', `exam_id=${db.eq(ex.id)}&kind=neq.snap&select=email,kind,at&order=at.asc`),
      db.select('exam_events', `exam_id=${db.eq(ex.id)}&kind=eq.snap&select=email,snap,at`),
    ]);
    const A = {}; ats.forEach((a) => { A[a.email] = a; });
    const E = {}; evs.forEach((e) => { (E[e.email] = E[e.email] || []).push(e); });
    const SN = {}; snaps.forEach((s) => { SN[s.email] = s; });
    const emails = mem.map((m) => m.email); ats.forEach((a) => { if (emails.indexOf(a.email) < 0) emails.push(a.email); });
    const accs = emails.length ? await db.select('accounts', `email=in.${db.quoted(emails)}&select=email,name`) : [];
    const nameOf = {}; accs.forEach((a) => { nameOf[a.email] = a.name; });
    const rows = emails.map((em) => {
      const a = A[em], es = E[em] || [];
      const alerts = es.filter((e) => ALERT_KINDS.indexOf(e.kind) >= 0);
      const done = a ? (a.answers || []).filter((v) => v !== null && v !== undefined).length : 0;
      return {
        email: em, name: nameOf[em] || em.split('@')[0],
        status: !a ? 'none' : a.status, cam: a ? a.cam : 'none', done, total,
        score: a && a.status === 'submitted' ? a.score : null,
        alerts: alerts.length, last: alerts.length ? alerts[alerts.length - 1].kind : null, lastAt: alerts.length ? Number(alerts[alerts.length - 1].at) : null,
        snap: SN[em] ? SN[em].snap : null, snapAt: SN[em] ? Number(SN[em].at) : null,
      };
    });
    return { exam: { id: ex.id, title: ex.title, cls: ex.class_name, subject: ex.subject, at: Number(ex.starts_at), min: ex.minutes, cam: !!ex.require_cam, n: total }, rows, now: Date.now() };
  },

  // Giáo viên: dòng thời gian của một học sinh (kèm ảnh chụp khi có cảnh báo).
  async 'exam.events'(b, email) {
    const code = codeOf(b);
    await need(code, email, ['ql', 'gv']);
    const ex = await getExam(code, b.id);
    const target = str(b.email, 254).toLowerCase();
    const rows = await db.select('exam_events', `exam_id=${db.eq(ex.id)}&email=${db.eq(target)}&select=kind,detail,secs,snap,at&order=at.asc`);
    return { events: rows.slice(-150).map((r) => ({ kind: r.kind, detail: r.detail, secs: r.secs, snap: r.snap, at: Number(r.at) })) };
  },
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  let email;
  try { email = readSession(req); } catch (e) { console.error('auth:', e.message); return res.status(500).json({ error: 'Lỗi máy chủ.' }); }
  if (!email) return res.status(401).json({ error: 'Phiên đăng nhập đã hết hạn, hãy đăng nhập lại.' });
  const b = req.body || {};
  const fn = Object.prototype.hasOwnProperty.call(actions, b.action) ? actions[b.action] : null;
  if (!fn) return res.status(400).json({ error: 'Yêu cầu không hợp lệ.' });
  try {
    return res.status(200).json(await fn(b, email));
  } catch (e) {
    if (e.http) return res.status(e.http).json({ error: e.message });
    console.error('app', b.action, e.message);
    return res.status(500).json({ error: 'Lỗi máy chủ.' });
  }
};
