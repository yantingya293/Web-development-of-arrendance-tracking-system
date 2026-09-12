/**
 * 用户鉴权路由（Day 3；安全加固补改密与限流）
 *
 * 模块说明：
 *   POST /api/auth/register         注册（校验 + bcrypt 哈希，成功后自动登录）
 *   POST /api/auth/login            登录（session 写入 userId + iat）
 *   POST /api/auth/logout           退出登录（销毁 session）
 *   POST /api/auth/change-password  修改密码（需登录；成功后其他设备会话全部作废）
 *   GET  /api/auth/me               当前登录用户信息（requireAuth 保护）
 *
 * 限流（内存计数，见 src/middleware/rateLimit.js）：
 *   登录   每 IP 15 分钟 10 次【仅计失败】：成功登录不占限额（正常用户不会被锁），
 *          放缓暴破；叠加 bcrypt 异步化避免阻塞事件循环
 *   注册   每 IP 1 小时 5 次（防机器人批量注册）
 *   改密   每用户 15 分钟 5 次：被盗会话持有者可借该接口暴破旧密码——
 *          成功改密即踢掉真主人完成接管，故挂严限流（成功与否都计一次尝试）
 */
const express = require('express');
const {
  registerUser,
  authenticate,
  changePassword,
} = require('../services/user.service');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter, createFailureRateLimiter } = require('../middleware/rateLimit');

const router = express.Router();

const loginLimiter = createFailureRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => 'login:' + req.ip,
  message: '失败次数过多，请 15 分钟后再试',
});

const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyFn: (req) => 'register:' + req.ip,
  message: '注册过于频繁，请 1 小时后再试',
});

const changePwdLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyFn: (req) => 'change-pwd:' + req.user.id,
  message: '操作过于频繁，请 15 分钟后再试',
});

/** 写会话：userId + 签发时间（iat 供改密作废校验，见 user.service.getSessionUser） */
function establishSession(req, userId) {
  req.session.userId = userId;
  req.session.iat = Date.now();
}

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { nickname, account, password } = req.body || {};
    const user = await registerUser({ nickname, account, password });
    establishSession(req, user.id); // 注册成功即登录
    res.status(201).json({ message: '注册成功', user });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message, errors: err.errors });
    }
    console.error('[auth/register]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { account, password } = req.body || {};
    const user = await authenticate(account, password);
    if (!user) {
      return res.status(401).json({ message: '账号或密码错误' });
    }
    establishSession(req, user.id);
    res.json({ message: '登录成功', user });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

router.post('/logout', (req, res) => {
  req.session = null; // cookie-session：置 null 即清除会话 Cookie
  res.json({ message: '已退出登录' });
});

/** 修改密码：成功后以新 iat 续期当前会话（用户不掉线），其余设备全部登出。
 *  限流挂在 requireAuth 之后（按 req.user.id 计数） */
router.post('/change-password', requireAuth, changePwdLimiter, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    await changePassword(req.user, oldPassword, newPassword);
    establishSession(req, req.user.id);
    res.json({ message: '密码已修改，其他已登录设备已全部退出' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message, errors: err.errors });
    }
    console.error('[auth/change-password]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
