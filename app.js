const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');

const { initDb } = require('./src/db/db');
const { seedIfEmpty } = require('./src/db/seed');
const { findPublicById } = require('./src/services/user.service');
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

// Day 3 决策：session 存 Cookie，有效期 7 天，httpOnly + SameSite=Lax
// （CSRF token 与速率限制按计划在 Day 20 专项加固）
const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
app.use(
  cookieSession({
    name: 'sid',
    keys: [process.env.SESSION_SECRET || 'dev-only-secret-please-change-me'],
    maxAge: SESSION_MAX_AGE,
    sameSite: 'lax',
    httpOnly: true,
    path: '/',
  })
);
if (!process.env.SESSION_SECRET) {
  console.warn('[warn] 未设置 SESSION_SECRET，当前使用开发默认值；部署前请务必设置。');
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 每个请求装载当前用户（供模板与守卫使用）
app.use((req, res, next) => {
  res.locals.currentUser = null;
  if (req.session && req.session.userId) {
    res.locals.currentUser = findPublicById(req.session.userId);
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
