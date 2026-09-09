/**
 * 用户鉴权路由（Day 3）
 *
 * 模块说明：
 *   POST /api/auth/register  注册（校验 + bcrypt 哈希，成功后自动登录）
 *   POST /api/auth/login     登录（session 写入 userId）
 *   POST /api/auth/logout    退出登录（销毁 session）
 *   GET  /api/auth/me        当前登录用户信息（requireAuth 保护）
 */
const express = require('express');
const { registerUser, authenticate, findPublicById } = require('../services/user.service');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/register', (req, res) => {
  try {
    const { nickname, account, password } = req.body || {};
    const user = registerUser({ nickname, account, password });
    req.session.userId = user.id; // 注册成功即登录
    res.status(201).json({ message: '注册成功', user });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message, errors: err.errors });
    }
    console.error('[auth/register]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

router.post('/login', (req, res) => {
  const { account, password } = req.body || {};
  const user = authenticate(account, password);
  if (!user) {
    return res.status(401).json({ message: '账号或密码错误' });
  }
  req.session.userId = user.id;
  res.json({ message: '登录成功', user });
});

router.post('/logout', (req, res) => {
  req.session = null; // cookie-session：置 null 即清除会话 Cookie
  res.json({ message: '已退出登录' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
