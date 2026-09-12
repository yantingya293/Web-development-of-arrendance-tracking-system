const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieSession = require('cookie-session');

const { initDb } = require('./src/db/db');
const { seedIfEmpty } = require('./src/db/seed');
const { getSessionUser } = require('./src/services/user.service');
const authRoutes = require('./src/routes/auth.routes');
const taskRoutes = require('./src/routes/task.routes');
const checkinRoutes = require('./src/routes/checkin.routes');
const teamRoutes = require('./src/routes/team.routes');
const duoTaskRoutes = require('./src/routes/duoTask.routes');
const duoCheckinRoutes = require('./src/routes/duoCheckin.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const pageRoutes = require('./src/routes/page.routes');

// Day 2：启动即建库 + 补种（幂等）
initDb();
seedIfEmpty();

const app = express();
const PORT = process.env.PORT || 3000;

// Day 3 决策（安全加固后）：会话密钥绝不回退到源码硬编码值——
// 源码里的默认密钥等于公开密钥，任何人都能用它伪造任意用户（含管理员）的会话 Cookie。
//   * 已设置 SESSION_SECRET        → 使用之（多实例 / 重启后会话保持）
//   * 生产环境未设置               → 拒绝启动
//   * 开发环境未设置               → 每次启动生成随机临时密钥（不可伪造；重启后会话失效，开发可接受）
const SESSION_SECRET = process.env.SESSION_SECRET;
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
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes); // Day 5：单人任务 CRUD
app.use('/api/checkins', checkinRoutes); // Day 6：单人打卡（照片上传）
app.use('/api/team', teamRoutes); // Day 8：双人组队（邀请 / 接受 / 拒绝 / 解绑）
app.use('/api/duo-tasks', duoTaskRoutes); // Day 9：双人共同任务 CRUD
app.use('/api/duo-checkins', duoCheckinRoutes); // Day 10：双人打卡（每日一次 + 搭档通知）
app.use('/api/notifications', notificationRoutes); // Day 10：站内通知（协作动态）
app.use('/', pageRoutes);

// 404 兜底
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: '接口不存在' });
  }
  res.status(404).render('error', { title: '页面不存在', code: 404, message: '你访问的页面不存在。' });
});

// 统一错误处理
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ message: '服务器内部错误' });
  }
  res.status(500).render('error', { title: '服务器错误', code: 500, message: '服务器开小差了，请稍后再试。' });
});

app.listen(PORT, () => {
  console.log(`学习打卡网页已启动: http://localhost:${PORT}`);
});
