/**
 * httpCheck.js —— HTTP 层验收套件（Day 19，M4 开篇）
 *
 * 与 dbCheck.js（服务层探针）互补：本套件以「临时数据库 + 独立端口」拉起真实的
 * app.js 子进程，用 HTTP 请求逐项验收端到端行为——路由、鉴权、上传、限流、
 * 安全响应头、CSRF、会话生命周期都在真实 HTTP 栈上验证。
 *
 * 零新依赖：Node ≥ 20 内置 fetch / FormData / Blob（engines 要求 node>=20）。
 *
 * 覆盖（随里程碑递增）：
 *   Day 19：页面可达 / 鉴权守卫 / 注册登录（重复 409 同形 + 等时）/ 任务 CRUD /
 *           multipart 打卡上传与照片鉴权（未登录 401）/ 广场分页取整 /
 *           双人组队-共同任务-双人打卡-统计全链路 / 管理员守卫与公共任务管理 /
 *           登录回跳消毒 / 登出后会话失效 / 未知 API 404
 *   Day 20：CSP / HSTS（仅 HTTPS）/ 关 X-Powered-By / CSRF Origin 校验 /
 *           登录时序等化 / 图片尺寸深检
 *
 * 运行：node httpCheck.js（或 npm test）
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const TMP_DB = path.join(__dirname, 'data', '.tmp-httpcheck.db');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** 浏览器 PNG 魔数 + IHDR，宽高可自定义（深检用例可伪造超大尺寸） */
function makePngBytes(width, height) {
  const buf = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8); // IHDR 数据长度
  buf.write('IHDR', 12, 'ascii');
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  buf.writeUInt8(8, 24); // bit depth
  buf.writeUInt8(6, 25); // color type RGBA
  buf.writeUInt32BE(0, 26); // CRC 占位（本项目校验只读头，CRC 不参与）
  return buf;
}
const VALID_PNG = makePngBytes(1, 1);

async function request(method, p, { cookie, json, form, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.Cookie = cookie;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    h['Content-Length'] = Buffer.byteLength(JSON.stringify(json));
  }
  const reqBody = form ? form : raw !== undefined ? raw : json !== undefined ? JSON.stringify(json) : undefined;
  const res = await fetch(BASE + p, { method, headers: h, body: reqBody });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch (_) {
    body = text;
  }
  return { status: res.status, headers: res.headers, text, body };
}

function cookieOf(res) {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function multipart(fields) {
  const fd = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value && value.__file) {
      fd.append(name, new Blob([value.bytes], { type: value.type }), value.name);
    } else {
      fd.append(name, String(value));
    }
  }
  return fd;
}

async function waitReady(child) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + '/login');
      if (res.ok) return;
    } catch (_) { /* 未就绪继续等 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('应用未在 12 秒内就绪（端口 ' + PORT + '）');
}

async function main() {
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(TMP_DB + suffix, { force: true });
  }

  const child = spawn(process.execPath, ['app.js'], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: TMP_DB },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', (d) => process.stderr.write('[app] ' + d));
  const uploadedFiles = []; // 记录本次套件真实落盘的照片，结束时清理

  try {
    await waitReady(child);
    console.log(`应用已就绪: ${BASE}（临时库 ${TMP_DB}）\n`);

    /* ---------- 页面与安全响应头基线（Day 19） ---------- */
    await check('GET /login 200 HTML', async () => {
      const r = await request('GET', '/login');
      assert(r.status === 200, 'status=' + r.status);
      assert(String(r.body).includes('登录'), '页面内容异常');
    });
    await check('GET / 200（未登录首页）', async () => {
      const r = await request('GET', '/');
      assert(r.status === 200, 'status=' + r.status);
    });
    await check('安全响应头基线（nosniff / DENY / Referrer-Policy）', async () => {
      const r = await request('GET', '/login');
      assert(r.headers.get('x-content-type-options') === 'nosniff', 'nosniff 缺失');
      assert(r.headers.get('x-frame-options') === 'DENY', 'X-Frame-Options 缺失');
      assert(r.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'Referrer-Policy 缺失');
    });

    /* ---------- 鉴权守卫 ---------- */
    await check('未登录 /api/tasks → 401 JSON', async () => {
      const r = await request('GET', '/api/tasks');
      assert(r.status === 401, 'status=' + r.status);
      assert(r.body && r.body.message, '应返回 JSON 错误');
    });
    await check('未知 API → 404', async () => {
      const r = await request('GET', '/api/definitely-not-exist');
      assert(r.status === 404, 'status=' + r.status);
    });

    /* ---------- 注册 / 登录 ---------- */
    const accountA = 'httpchk_a';
    let cookieA = '';
    await check('注册成功（表单校验 400 由 dbCheck 服务层探针覆盖）', async () => {
      const ok = await request('POST', '/api/auth/register', {
        json: { nickname: '套件甲', account: accountA, password: 'passw0rd1' },
      });
      assert(ok.status === 200 || ok.status === 201, 'status=' + ok.status);
    });
    await check('重复注册 409 同形 + 等时（≥20ms）', async () => {
      const payload = { nickname: '套件甲', account: accountA, password: 'passw0rd1' };
      const t0 = Date.now();
      const d1 = await request('POST', '/api/auth/register', { json: payload });
      const dupMs = Date.now() - t0;
      const d2 = await request('POST', '/api/auth/register', { json: payload });
      assert(d1.status === 409 && d2.status === 409, '409 预期');
      assert(d1.text === d2.text, '两次重复注册响应应完全同形');
      assert(dupMs >= 20, `等时未生效（${dupMs}ms）`);
    });
    await check('登录失败 401 统一文案', async () => {
      const r = await request('POST', '/api/auth/login', {
        json: { account: accountA, password: 'wrong-pass1' },
      });
      assert(r.status === 401 && r.body.message === '账号或密码错误', JSON.stringify(r.body));
    });
    await check('登录成功下发会话 Cookie', async () => {
      const r = await request('POST', '/api/auth/login', {
        json: { account: accountA, password: 'passw0rd1' },
      });
      assert(r.status === 200, 'status=' + r.status);
      cookieA = cookieOf(r);
      assert(cookieA.includes('sid='), 'Cookie 缺失: ' + cookieA);
    });
    await check('GET /api/auth/me 返回当前用户', async () => {
      const r = await request('GET', '/api/auth/me', { cookie: cookieA });
      assert(r.status === 200 && r.body.user.account === accountA, JSON.stringify(r.body).slice(0, 120));
    });

    /* ---------- 单人任务 + 打卡上传 + 照片鉴权 ---------- */
    let taskId = 0;
    let photoRel = '';
    await check('任务创建 / 列表 / 状态流转 / 非法状态 400', async () => {
      const c = await request('POST', '/api/tasks', { cookie: cookieA, json: { title: '套件任务', category: 'daily' } });
      assert(c.status === 200 || c.status === 201, 'create status=' + c.status);
      taskId = c.body.task ? c.body.task.id : c.body.id;
      assert(taskId > 0, '无任务 id');
      const list = await request('GET', '/api/tasks', { cookie: cookieA });
      assert(list.body.tasks.some((t) => t.id === taskId), '列表未见新任务');
      const done = await request('PATCH', `/api/tasks/${taskId}/status`, { cookie: cookieA, json: { status: 'completed' } });
      assert((done.body.task || done.body).status === 'completed', '流转失败');
      const bad = await request('PATCH', `/api/tasks/${taskId}/status`, { cookie: cookieA, json: { status: 'overdue' } });
      assert(bad.status === 400, 'overdue 应不可手动设置');
    });
    await check('multipart 打卡上传成功并返回照片路径', async () => {
      const fd = multipart({ taskId, note: '套件打卡', photos: { __file: true, bytes: VALID_PNG, type: 'image/png', name: 'a.png' } });
      const r = await request('POST', '/api/checkins', { cookie: cookieA, form: fd });
      assert(r.status === 200 || r.status === 201, 'status=' + r.status + ' ' + r.text.slice(0, 120));
      photoRel = (r.body.checkin && r.body.checkin.image_paths[0]) || '';
      assert(photoRel.startsWith('uploads/'), '照片路径异常: ' + photoRel);
      uploadedFiles.push(path.join(require('./src/middleware/upload').UPLOAD_DIR, photoRel.slice('uploads/'.length)));
    });
    await check('照片鉴权：未登录 401 / 登录 200 image/png', async () => {
      const no = await request('GET', '/' + photoRel);
      assert(no.status === 401, '未登录 status=' + no.status);
      const yes = await request('GET', '/' + photoRel, { cookie: cookieA });
      assert(yes.status === 200 && yes.headers.get('content-type') === 'image/png', '登录态应可读原图');
    });
    await check('同任务同日重复打卡 → 409（每日一次，Day 21）', async () => {
      const fd = multipart({ taskId, note: '重复打卡', photos: { __file: true, bytes: VALID_PNG, type: 'image/png', name: 'dup.png' } });
      const r = await request('POST', '/api/checkins', { cookie: cookieA, form: fd });
      assert(r.status === 409 && /今天已对该任务打卡/.test(r.text), 'status=' + r.status + ' ' + r.text.slice(0, 120));
    });

    /* ---------- 广场 ---------- */
    await check('广场列表 + limit 小数取整钳制（不 500）', async () => {
      const g = await request('GET', '/api/gallery', { cookie: cookieA });
      assert(g.status === 200 && g.body.total >= 1, '广场应有数据');
      const g2 = await request('GET', '/api/gallery?limit=1.7&offset=abc', { cookie: cookieA });
      assert(g2.status === 200 && g2.body.checkins.length <= 1, 'limit=1.7 应钳制为 1');
    });

    /* ---------- 双人全链路 ---------- */
    const accountB = 'httpchk_b';
    let cookieB = '';
    let inviteId = 0;
    let duoTaskId = 0;
    await check('双人链路：注册 B → A 邀请 → B 接受成组', async () => {
      const reg = await request('POST', '/api/auth/register', {
        json: { nickname: '套件乙', account: accountB, password: 'passw0rd1' },
      });
      assert(reg.status === 200 || reg.status === 201, 'B 注册失败');
      const loginB = await request('POST', '/api/auth/login', {
        json: { account: accountB, password: 'passw0rd1' },
      });
      cookieB = cookieOf(loginB);
      const inv = await request('POST', '/api/team/invites', { cookie: cookieA, json: { account: accountB } });
      assert(inv.status === 200 || inv.status === 201, '邀请失败: ' + inv.text.slice(0, 120));
      const viewB = await request('GET', '/api/team', { cookie: cookieB });
      inviteId = viewB.body.invites[0] && viewB.body.invites[0].id;
      assert(inviteId > 0, 'B 未收到邀请');
      const acc = await request('POST', `/api/team/invites/${inviteId}/accept`, { cookie: cookieB });
      assert(acc.status === 200, '接受失败: ' + acc.text.slice(0, 120));
      const teamA = await request('GET', '/api/team', { cookie: cookieA });
      assert(teamA.body.team && teamA.body.team.partner.account === accountB, 'A 侧未见搭档');
    });
    await check('共同任务 + 双人打卡 + 协作统计', async () => {
      const dt = await request('POST', '/api/duo-tasks', { cookie: cookieA, json: { title: '套件共同任务' } });
      assert(dt.status === 200 || dt.status === 201, '共同任务创建失败');
      duoTaskId = (dt.body.task || dt.body).id;
      const dc = await request('POST', '/api/duo-checkins', {
        cookie: cookieA,
        form: multipart({ duoTaskId, note: '套件双人打卡', photos: { __file: true, bytes: VALID_PNG, type: 'image/png', name: 'b.png' } }),
      });
      assert(dc.status === 200 || dc.status === 201, '双人打卡失败: ' + dc.text.slice(0, 120));
      if (dc.body.checkin) {
        const rel = dc.body.checkin.image_paths[0];
        if (rel) uploadedFiles.push(path.join(require('./src/middleware/upload').UPLOAD_DIR, rel.slice('uploads/'.length)));
      }
      const stats = await request('GET', '/api/duo-checkins/stats', { cookie: cookieA });
      const statsBody = stats.body.stats || stats.body;
      assert(
        stats.status === 200 && statsBody.tasks && statsBody.tasks.total >= 1,
        '协作统计异常: ' + stats.status + ' ' + String(stats.text).slice(0, 160)
      );
    });
    await check('邀请限流：认证后枚举通道超阈值 429（Day 21 复测加固）', async () => {
      let saw429 = false;
      for (let i = 0; i < 25 && !saw429; i++) {
        const r = await request('POST', '/api/team/invites', {
          cookie: cookieA,
          json: { account: 'no_such_probe_' + i },
        });
        if (r.status === 429) saw429 = true;
      }
      assert(saw429, '20 次/小时阈值未触发 429');
    });

    /* ---------- 管理员 ---------- */
    await check('管理员守卫：普通用户 403 / 管理员 200', async () => {
      const asUser = await request('GET', '/api/admin/overview', { cookie: cookieA });
      assert(asUser.status === 403, '普通用户 status=' + asUser.status);
      const loginAdmin = await request('POST', '/api/auth/login', {
        json: { account: 'admin', password: 'admin123' },
      });
      const cookieAdmin = cookieOf(loginAdmin);
      assert(loginAdmin.status === 200, 'admin 登录失败: ' + loginAdmin.text.slice(0, 120));
      const overview = await request('GET', '/api/admin/overview', { cookie: cookieAdmin });
      const ovBody = (overview.body.overview || overview.body);
      assert(
        overview.status === 200 && ovBody.users && typeof ovBody.users.total === 'number',
        '概览异常: ' + overview.status + ' ' + String(overview.text).slice(0, 160)
      );
      const users = await request('GET', '/api/admin/users?limit=2.9', { cookie: cookieAdmin });
      assert(users.status === 200 && users.body.users.length <= 2, 'limit=2.9 未钳制');
      const pt = await request('POST', '/api/admin/public-tasks', {
        cookie: cookieAdmin,
        json: { title: '套件公共任务', category: 'daily' },
      });
      assert(pt.status === 200 || pt.status === 201, '公共任务发布失败');
      const pid = (pt.body.task || pt.body).id;
      const del = await request('DELETE', `/api/admin/public-tasks/${pid}`, { cookie: cookieAdmin });
      assert(del.status === 200, '公共任务删除失败');
    });

    /* ---------- 回跳 / 登出 ---------- */
    await check('登录回跳消毒：next=//evil.com → /', async () => {
      const r = await request('GET', '/login?next=%2F%2Fevil.com');
      assert(r.status === 200 && r.text.includes('data-next="/"'), '回跳未消毒');
    });
    await check('登出后会话立即失效', async () => {
      const out = await request('POST', '/api/auth/logout', { cookie: cookieA });
      assert(out.status === 200, '登出 status=' + out.status);
      const after = await request('GET', '/api/tasks', { cookie: cookieA });
      assert(after.status === 401, '登出后仍可访问');
    });
    await check('已作废 Cookie 重放：页面正常渲染且可重新登录（Day 21 回归）', async () => {
      const stale = cookieA; // 上一项已作废，但仍签名有效
      const login = await request('GET', '/login', { cookie: stale });
      assert(login.status === 200, 'GET /login status=' + login.status);
      const reg = await request('GET', '/register', { cookie: stale });
      assert(reg.status === 200, 'GET /register status=' + reg.status);
      const relogin = await request('POST', '/api/auth/login', {
        json: { account: accountA, password: 'passw0rd1' },
        cookie: stale,
      });
      assert(relogin.status === 200, '持旧 Cookie 重新登录 status=' + relogin.status);
      cookieA = cookieOf(relogin);
      const me = await request('GET', '/api/auth/me', { cookie: cookieA });
      assert(me.status === 200 && me.body.user.account === accountA, '新会话未生效');
    });

    /* ---------- Day 20：安全专项 ---------- */
    await check('CSP 响应头 + X-Powered-By 已移除', async () => {
      const r = await request('GET', '/login');
      const csp = r.headers.get('content-security-policy') || '';
      assert(csp.includes("script-src 'self'"), 'CSP 缺失或不含 script-src self: ' + csp);
      assert(csp.includes("frame-ancestors 'none'"), 'CSP 缺 frame-ancestors');
      assert(!r.headers.get('x-powered-by'), 'X-Powered-By 仍在暴露框架指纹');
      assert(!r.text.includes('<script>'), '页面仍有内联脚本（CSP self 下会被拦）');
    });
    await check('HSTS 仅 HTTPS 携带（HTTP 下不发送）', async () => {
      const r = await request('GET', '/login');
      assert(!r.headers.get('strict-transport-security'), 'HTTP 响应不应携带 HSTS');
    });
    await check('登录时序等化：不存在的账号也走 bcrypt（≥20ms）', async () => {
      const t0 = Date.now();
      await request('POST', '/api/auth/login', { json: { account: 'no_such_user', password: 'passw0rd1' } });
      const ms = Date.now() - t0;
      assert(ms >= 20, `等时未生效（${ms}ms，未含 bcrypt 比较）`);
    });
    await check('CSRF：跨源 Origin 被拒 / 同源放行 / 缺头放行', async () => {
      const evil = await request('POST', '/api/tasks', {
        cookie: cookieB,
        json: { title: '跨站请求' },
        headers: { Origin: 'https://evil.example' },
      });
      assert(evil.status === 403, '跨源 Origin status=' + evil.status);
      const same = await request('POST', '/api/tasks', {
        cookie: cookieB,
        json: { title: '同源请求' },
        headers: { Origin: BASE },
      });
      assert(same.status === 200 || same.status === 201, '同源 Origin 被误拒: ' + same.status);
      const noOrigin = await request('GET', '/api/team', { cookie: cookieB });
      assert(noOrigin.status === 200, 'GET 不受 CSRF 守卫影响');
    });
    await check('图片尺寸深检：伪造超大尺寸 PNG 被拒（400）', async () => {
      const fd = multipart({ taskId, note: '超大尺寸', photos: { __file: true, bytes: makePngBytes(20000, 1), type: 'image/png', name: 'huge.png' } });
      const r = await request('POST', '/api/checkins', { cookie: cookieB, form: fd });
      assert(r.status === 400, '超大尺寸 status=' + r.status);
    });
    /* ---------- Day 21 复测（v1.0.3）：白盒扫描三项修复 ---------- */
    await check('头像对象级鉴权：本人/搭档/管理员 200，无关用户 403，照片维持登录可见', async () => {
      const spare = await request('POST', '/api/auth/register', {
        json: { nickname: '无关用户', account: 'httpchk_spare', password: 'passw0rd1' },
      });
      assert(spare.status === 200 || spare.status === 201, 'spare 注册失败: ' + spare.text.slice(0, 100));
      const cookieSpare = cookieOf(spare);

      const up = await request('POST', '/api/auth/avatar', {
        cookie: cookieA,
        form: multipart({ avatar: { __file: true, bytes: VALID_PNG, type: 'image/png', name: 'av.png' } }),
      });
      assert(up.status === 200, '头像上传失败: ' + up.status + ' ' + up.text.slice(0, 120));
      const avatarRel = up.body.user && up.body.user.avatar_path;
      assert(avatarRel && avatarRel.startsWith('uploads/avatars/'), 'avatar_path 异常: ' + avatarRel);

      const own = await request('GET', '/' + avatarRel, { cookie: cookieA });
      assert(
        own.status === 200 && own.headers.get('cache-control') === 'private, max-age=0',
        '本人访问异常: ' + own.status + ' cc=' + own.headers.get('cache-control')
      );
      const partnerView = await request('GET', '/' + avatarRel, { cookie: cookieB });
      assert(partnerView.status === 200, '搭档访问应 200: ' + partnerView.status);
      const loginAdmin = await request('POST', '/api/auth/login', {
        json: { account: 'admin', password: 'admin123' },
      });
      const adminView = await request('GET', '/' + avatarRel, { cookie: cookieOf(loginAdmin) });
      assert(adminView.status === 200, '管理员访问应 200: ' + adminView.status);
      const other = await request('GET', '/' + avatarRel, { cookie: cookieSpare });
      assert(other.status === 403, '无关用户应 403: ' + other.status);
      const anon = await request('GET', '/' + avatarRel);
      assert(anon.status === 401, '未登录应 401: ' + anon.status);
      const photo = await request('GET', '/' + photoRel, { cookie: cookieSpare });
      assert(photo.status === 200, '打卡照片应维持登录可见（广场 by design）');

      await request('DELETE', '/api/auth/avatar', { cookie: cookieA }); // 清理头像文件
    });
    await check('头像非规范路径绕过封堵（./、%2e、%2f、.. 变体全部拒绝）', async () => {
      // 原生 http 发送路径（fetch 会规范化 /./ 与 %2e，掩盖 CWE-180 类缺陷）
      const rawGet = (p, cookie) =>
        new Promise((resolve, reject) => {
          const req = require('http').request(
            { host: '127.0.0.1', port: PORT, path: p, method: 'GET', headers: { Cookie: cookie } },
            (res) => {
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => resolve({ status: res.statusCode, ct: res.headers['content-type'], body: Buffer.concat(chunks) }));
            }
          );
          req.on('error', reject);
          req.end();
        });

      const loginSpare = await request('POST', '/api/auth/login', {
        json: { account: 'httpchk_spare', password: 'passw0rd1' },
      });
      const cookieSpare = cookieOf(loginSpare);
      const loginAdmin = await request('POST', '/api/auth/login', {
        json: { account: 'admin', password: 'admin123' },
      });
      const cookieAdmin = cookieOf(loginAdmin);
      const upAd = await request('POST', '/api/auth/avatar', {
        cookie: cookieAdmin,
        form: multipart({ avatar: { __file: true, bytes: VALID_PNG, type: 'image/png', name: 'ad.png' } }),
      });
      assert(upAd.status === 200, 'admin 头像上传失败: ' + upAd.status);
      const adRel = upAd.body.user.avatar_path;
      const fname = adRel.split('/').pop();

      const variants = [
        '/uploads/./avatars/' + fname,
        '/uploads/././avatars/' + fname,
        '/uploads/%2e/avatars/' + fname,
        '/uploads/%2E/avatars/' + fname,
        '/uploads/avatars%2f' + fname,
        '/uploads/foo/../avatars/' + fname,
        '/uploads/%2e%2favatars/' + fname,
      ];
      for (const v of variants) {
        const r = await rawGet(v, cookieSpare);
        assert(
          r.status === 403 || r.status === 404,
          `非规范路径 ${v} 绕过鉴权: ${r.status} ${r.ct}`
        );
      }
      const own = await rawGet('/uploads/avatars/' + fname, cookieAdmin);
      assert(own.status === 200, '属主访问应正常: ' + own.status);
      await request('DELETE', '/api/auth/avatar', { cookie: cookieAdmin });
    });
    await check('头像邀请方向性：发送方不可见接收方头像，接收方可见发送方，拒绝后消失', async () => {
      const loginSpare = await request('POST', '/api/auth/login', {
        json: { account: 'httpchk_spare', password: 'passw0rd1' },
      });
      const cookieSpare = cookieOf(loginSpare);
      const upS = await request('POST', '/api/auth/avatar', {
        cookie: cookieSpare,
        form: multipart({ avatar: { __file: true, bytes: VALID_PNG, type: 'image/png', name: 'sp.png' } }),
      });
      assert(upS.status === 200, 'spare 头像上传失败: ' + upS.status);
      const sRel = upS.body.user.avatar_path;

      // A-B 解绑（用普通用户做方向性测试——admin 天然全可见，无法验证边界）
      await request('DELETE', '/api/team', { cookie: cookieA });
      const upB = await request('POST', '/api/auth/avatar', {
        cookie: cookieB,
        form: multipart({ avatar: { __file: true, bytes: VALID_PNG, type: 'image/png', name: 'bv.png' } }),
      });
      assert(upB.status === 200, 'B 头像上传失败: ' + upB.status);
      const bRel = upB.body.user.avatar_path;

      // spare（发送方）邀请 B（接收方）→ 待处理期间：发送方不可见接收方头像
      const inv = await request('POST', '/api/team/invites', { cookie: cookieSpare, json: { account: accountB } });
      assert(inv.status === 201, '邀请失败: ' + inv.text.slice(0, 100));
      const denied = await request('GET', '/' + bRel, { cookie: cookieSpare });
      assert(denied.status === 403, '发送方不应可见接收方头像: ' + denied.status);
      const allowed = await request('GET', '/' + sRel, { cookie: cookieB });
      assert(allowed.status === 200, '接收方应可见发送方头像: ' + allowed.status);

      // B 拒绝邀请 → 双向授权消失
      const team = await request('GET', '/api/team', { cookie: cookieB });
      const invId = team.body.invites[0] && team.body.invites[0].id;
      assert(invId, 'B 未收到邀请');
      const dec = await request('POST', `/api/team/invites/${invId}/decline`, { cookie: cookieB });
      assert(dec.status === 200, '拒绝失败');
      const afterDenied = await request('GET', '/' + bRel, { cookie: cookieSpare });
      assert(afterDenied.status === 403, '拒绝后发送方仍可见');
      const afterAllowed = await request('GET', '/' + sRel, { cookie: cookieB });
      assert(afterAllowed.status === 403, '拒绝后接收方仍可见');

      await request('DELETE', '/api/auth/avatar', { cookie: cookieSpare });
      await request('DELETE', '/api/auth/avatar', { cookie: cookieB });
    });
    await check('损坏 multipart 表单 → 400（不再 500）', async () => {
      for (const p of ['/api/checkins', '/api/duo-checkins', '/api/auth/avatar']) {
        const r = await request('POST', p, {
          cookie: cookieA,
          raw: '',
          headers: { 'Content-Type': 'multipart/form-data; boundary=----poc' },
        });
        assert(r.status === 400, p + ' 空multipart status=' + r.status);
      }
    });
    await check('登录节流：失败超阈值 429，正确凭据始终成功（认证 DoS 回归）', async () => {
      let saw429 = false;
      for (let i = 0; i < 12; i++) {
        const r = await request('POST', '/api/auth/login', {
          json: { account: accountB, password: 'wrong-pass-' + i },
        });
        if (r.status === 429) saw429 = true;
        else assert(r.status === 401, '失败尝试应 401/429: ' + r.status);
      }
      assert(saw429, '超过阈值后未触发 429');
      const ok = await request('POST', '/api/auth/login', {
        json: { account: accountB, password: 'passw0rd1' },
      });
      assert(ok.status === 200, '正确凭据被节流拦截（认证 DoS 回归）: ' + ok.status);
    });
    await check('登录防爆破闸门：60 次/分钟/IP 后统一 429（v1.0.4，vuln-0004）', async () => {
      // 闸门按全部 /login 请求计数；套件至此已消耗约 20 次，本探针 66 次必然跨越 60
      let guardMsg = 0;
      for (let i = 0; i < 25; i++) {
        const r = await request('POST', '/api/auth/login', {
          json: { account: accountB, password: 'wrong-g1-' + i },
        });
        if (/登录请求过于频繁/.test(r.text)) guardMsg += 1;
      }
      const ok = await request('POST', '/api/auth/login', {
        json: { account: accountB, password: 'passw0rd1' },
      });
      assert(ok.status === 200, '闸门触发前正确凭据应成功: ' + ok.status);
      for (let i = 0; i < 40; i++) {
        const r = await request('POST', '/api/auth/login', {
          json: { account: accountB, password: 'wrong-g2-' + i },
        });
        if (/登录请求过于频繁/.test(r.text)) guardMsg += 1;
      }
      assert(guardMsg > 0, '60 次/分钟防爆破闸门未触发');
    });
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 600));
    for (const f of uploadedFiles) {
      try {
        fs.rmSync(f, { force: true });
      } catch (_) { /* 尽力而为 */ }
    }
    await new Promise((r) => setTimeout(r, 200));
    for (const suffix of ['', '-wal', '-shm']) {
      fs.rmSync(TMP_DB + suffix, { force: true });
    }
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.name}`);
    if (!r.ok) console.error(`  └─ ${r.err.stack || r.err}`);
  }
  console.log(`\n共 ${results.length} 项检查，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length) process.exitCode = 1;
  else console.log('\x1b[32mHTTP 层验收全部通过 ✔\x1b[0m');
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(2);
});
