const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');

const { initDb } = require('./src/db/db');
const { seedIfEmpty } = require('./src/db/seed');
const { getSessionUser } = require('./src/services/user.service');
const { requireAuth } = require('./src/middleware/auth');
const { sameOriginGuard } = require('./src/middleware/csrf');
const { createRateLimiter } = require('./src/middleware/rateLimit');
const { UPLOAD_DIR } = require('./src/middleware/upload');
const authRoutes = require('./src/routes/auth.routes');
const taskRoutes = require('./src/routes/task.routes');
const checkinRoutes = require('./src/routes/checkin.routes');
const teamRoutes = require('./src/routes/team.routes');
const duoTaskRoutes = require('./src/routes/duoTask.routes');
const duoCheckinRoutes = require('./src/routes/duoCheckin.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const galleryRoutes = require('./src/routes/gallery.routes');
const statsRoutes = require('./src/routes/stats.routes');
const adminRoutes = require('./src/routes/admin.routes');
const pageRoutes = require('./src/routes/page.routes');

// Day 2：启动即建库 + 补种（幂等）
initDb();
seedIfEmpty();

const app = express();
const PORT = process.env.PORT || 3000;

// Day 20：不暴露 Express 指纹（X-Powered-By 响应头）
app.disable('x-powered-by');

// Day 3 决策（安全加固后）：会话密钥绝不回退到源码硬编码值——
// 源码里的默认密钥等于公开密钥，任何人都能用它伪造任意用户（含管理员）的会话 Cookie。
//   * 已设置 SESSION_SECRET（≥32 字符且非已知占位值） → 使用之（多实例 / 重启后会话保持）
//   * 生产环境未设置               → 拒绝启动
//   * 开发环境未设置               → 每次启动生成随机临时密钥（不可伪造；重启后会话失效，开发可接受）
// 显式设置了占位值（照抄示例文件）或过短密钥时一律拒绝启动——已知 / 可猜密钥等于会话完全失守，
// 不区分开发与生产（开发不设置即可获得随机临时密钥，无需占位值）。
const SESSION_SECRET = process.env.SESSION_SECRET;
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  'please_change_me_to_a_random_long_string', // .env.example 历史占位值
  'dev-only-secret-please-change-me', // 历史版本硬编码回退值
]);
if (
  SESSION_SECRET &&
  (KNOWN_PLACEHOLDER_SECRETS.has(SESSION_SECRET) || SESSION_SECRET.length < 32)
) {
  console.error(
    '[fatal] SESSION_SECRET 为已知占位值或长度不足 32 字符，拒绝启动。' +
      '请设置为 ≥32 字符的随机字符串（如 openssl rand -hex 32 的输出）。'
  );
  process.exit(1);
}
if (!SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.error('[fatal] 生产环境必须设置 SESSION_SECRET（用于会话签名），拒绝启动。');
  process.exit(1);
}
if (!SESSION_SECRET) {
  console.warn('[warn] 未设置 SESSION_SECRET，本次启动使用随机临时密钥：重启后所有登录态失效（生产环境必须设置）。');
}
const sessionKeys = [SESSION_SECRET || crypto.randomBytes(32).toString('hex')];

// Day 3 决策：session 存 Cookie，有效期 7 天，httpOnly + SameSite=Lax
// （CSRF token 与全局速率限制按计划在 Day 20 专项加固，登录/注册接口已先行接入）
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
app.use(
  cookieSession({
    name: 'sid',
    keys: sessionKeys,
    maxAge: SESSION_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    path: '/',
  })
);
// Secure 标志按请求判定：仅在 HTTPS 连接上携带（反代终结 TLS 时需同时设置 trust proxy，
// 静态写死 true 会在纯 HTTP 部署时抛 "Cannot send secure cookie" —— 故走 sessionOptions 动态开关）
app.use((req, res, next) => {
  req.sessionOptions.secure = req.secure || req.protocol === 'https';
  next();
});

// 基础安全响应头（nosniff：封死 MIME 嗅探型上传滥用；DENY：防点击劫持）
// Day 20：补 CSP 与 HSTS。
// CSP：全站脚本 / 样式 / 图片 / 接口均为同源资源（主题引导已外置为
// /js/theme-init.js，无内联脚本与内联事件），故策略可收紧到 'self'；
// img-src 加 data: 兜底前端可能的内联占位图。
// HSTS：仅在 HTTPS 请求上携带（纯 HTTP 部署时浏览器会忽略，但干净起见不发）。
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self'; " +
  "img-src 'self' data:; " +
  "connect-src 'self'; " +
  "font-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "form-action 'self'; " +
  'frame-ancestors \'none\'';
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
  if (req.secure || req.protocol === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));
// Day 18：打卡照片与头像移出公开静态目录——/uploads/* 必须登录后才能访问。
// 存储目录在 data/uploads（upload.js 启动时自动把老 public/uploads 迁移过去），
// express.static 自带路径穿越防护，requireAuth 在其前统一挡未登录请求。
// 注意必须挂在 public 静态之前，避免旧文件残留在 public/uploads 时被直出。
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// 每个请求装载当前用户（供模板与守卫使用）。
// getSessionUser 同时校验会话签发时间（iat）不早于用户的 session_not_before：
// 修改密码会把 session_not_before 推到当前时刻，盗取/残留的旧 Cookie 全部立即作废。
app.use((req, res, next) => {
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    const user = getSessionUser(req.session);
    if (!user) {
      req.session = null; // 已作废的会话：清掉 Cookie，按未登录处理
    } else {
      res.locals.currentUser = user;
    }
  }
  next();
});

// Day 20：CSRF 防护——状态变更请求校验 Origin/Referer 同源（缺头放行，见 csrf.js 说明）
app.use(sameOriginGuard);

// Day 20：全局 API 限流（纵深兜底）——各敏感接口已有细分限流（登录/注册/改密/打卡），
// 这里按 IP 对整个 /api 兜底，防单点滥用与脚本扫库；阈值远高于正常用量。
const globalApiLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  max: 300,
  keyFn: (req) => 'global:' + req.ip,
  message: '请求过于频繁，请稍后再试',
});
app.use('/api', globalApiLimiter);

app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes); // Day 5：单人任务 CRUD
app.use('/api/checkins', checkinRoutes); // Day 6：单人打卡（照片上传）
app.use('/api/team', teamRoutes); // Day 8：双人组队（邀请 / 接受 / 拒绝 / 解绑）
app.use('/api/duo-tasks', duoTaskRoutes); // Day 9：双人共同任务 CRUD
app.use('/api/duo-checkins', duoCheckinRoutes); // Day 10：双人打卡（每日一次 + 搭档通知）
app.use('/api/notifications', notificationRoutes); // Day 10：站内通知（协作动态）
app.use('/api/gallery', galleryRoutes); // Day 12：全员打卡广场（成果展示）
app.use('/api/stats', statsRoutes); // Day 13：个人数据统计（看板）
app.use('/api/admin', adminRoutes); // Day 14：管理员后台（全站统计 / 用户列表 / 公共任务）
app.use('/', pageRoutes);

// 404 兜底
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: '接口不存在' });
  }
  res.status(404).render('error', { title: '页面不存在', code: 404, message: '你访问的页面不存在。' });
});

// 统一错误处理
// Day 21：尊重错误对象自带的 status（body-parser 的 400/413、multer/框架错误等），
// 不再把可预期的客户端错误一律 500；5xx 一律收敛为通用文案避免泄漏内部细节。
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  const parsed = Number(err && (err.status || err.statusCode));
  const status = Number.isInteger(parsed) && parsed >= 400 && parsed < 600 ? parsed : 500;
  const message = status >= 500 ? '服务器开小差了，请稍后再试。' : err.message || '请求不合法';
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ message });
  }
  res.status(status).render('error', {
    title: status >= 500 ? '服务器错误' : '请求无效',
    code: status,
    message,
  });
});

const HOST = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
app.listen(PORT, HOST, () => {
  // Day 21：开发模式默认只绑本机回环——开发实例带默认便利口令，不应意外暴露到局域网
  console.log(
    `学习打卡网页已启动: http://localhost:${PORT}` +
      (HOST === '127.0.0.1'
        ? '（开发模式仅本机可访问；如需局域网/虚拟机访问请设 HOST=0.0.0.0）'
        : `（监听 ${HOST}:${PORT}）`)
  );
});
