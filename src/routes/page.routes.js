/**
 * 页面路由（Day 3）
 *
 * 模块说明：
 *   GET /          首页（导航 + 用户区，业务板块 Day 4 起填充）
 *   GET /login     登录页（已登录则回首页）
 *   GET /register  注册页（已登录则回首页）
 *   GET /me        个人中心占位页（登录可见，Day 7 / 13 完善）
 *   GET /admin     管理员后台占位页（仅 admin，Day 14 细化）
 */
const express = require('express');
const { requireAuthPage, requireAdminPage } = require('../middleware/auth');

const router = express.Router();

router.get('/', (req, res) => {
  res.render('index', { title: '学习打卡网页', active: 'home' });
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', {
    title: '登录',
    active: '',
    registered: req.query.registered === '1',
    next: typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/',
  });
});

router.get('/register', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('register', { title: '注册', active: '' });
});

router.get('/me', requireAuthPage, (req, res) => {
  res.render('me', { title: '个人中心', active: 'me' });
});

router.get('/admin', requireAdminPage, (req, res) => {
  res.render('admin', { title: '管理员后台', active: '' });
});

module.exports = router;
