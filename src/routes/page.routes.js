/**
 * 页面路由（Day 3 建立，Day 4 补齐顶栏导航可达页）
 *
 * 模块说明：
 *   GET /          首页（Day 4：四大板块骨架；Day 5：单人任务板块接入数据）
 *   GET /login     登录页（已登录则回首页）
 *   GET /register  注册页（已登录则回首页）
 *   GET /me        个人中心（登录可见，Day 7 接入打卡统计，Day 13 / 14 继续完善）
 *   GET /admin     管理员后台占位页（仅 admin，Day 14 细化）
 *   GET /duo       双人协作广场占位页（Day 8 实现）
 *   GET /gallery   全员打卡广场占位页（Day 12 实现）
 *   GET /history   历史记录页（Day 7 实现，登录可见）
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

// 顶栏导航页（Day 4 建立占位，按里程碑逐步替换为真实页面）
router.get('/duo', (req, res) => {
  res.render('coming-soon', {
    title: '双人协作广场',
    active: 'duo',
    heading: '双人协作广场',
    message: '绑定搭档、发布共同任务与协作进度可视化将在 Day 8 / 9 上线。',
  });
});

router.get('/gallery', (req, res) => {
  res.render('coming-soon', {
    title: '全员打卡广场',
    active: 'gallery',
    heading: '全员打卡广场',
    message: '单人 / 双人公开成果展示与筛选将在 Day 12 上线。',
  });
});

// 历史记录（Day 7）：打卡统计 + 日期分组列表 + 分类 / 日期筛选（登录可见）
router.get('/history', requireAuthPage, (req, res) => {
  res.render('history', { title: '历史记录', active: 'history' });
});

module.exports = router;
