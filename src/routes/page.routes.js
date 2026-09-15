/**
 * 页面路由（Day 3 建立，Day 4 补齐顶栏导航可达页）
 *
 * 模块说明：
 *   GET /          首页（Day 4：四大板块骨架；Day 5：单人任务板块接入数据）
 *   GET /login     登录页（已登录则回首页）
 *   GET /register  注册页（已登录则回首页）
 *   GET /me        个人中心（登录可见，Day 7 接入打卡统计，Day 13 / 14 继续完善）
 *   GET /admin     管理员后台占位页（仅 admin，Day 14 细化）
 *   GET /duo       双人协作广场（Day 8：组队绑定；Day 9：共同任务；Day 10：双方打卡）
 *   GET /gallery   全员打卡广场（Day 12 实现：全站单人 + 双人打卡成果展示）
 *   GET /history   历史记录页（Day 7 实现，登录可见）
 */
const express = require('express');
const { requireAuthPage, requireAdminPage } = require('../middleware/auth');

const router = express.Router();

/** 登录后回跳地址：仅接受本站相对路径（防开放重定向钓鱼）。
    1. 先剥控制字符（编码后的换行 / 空字节可干扰校验与后续跳转）；
    2. 拒绝 // 与 /\ 开头（浏览器视作协议相对地址跳外站）；
    3. 最后用 URL 解析器兜底：以假想本站为基准解析，解析结果若带出外部
       origin（任何反斜杠 / 编码变体）一律回首页，不做字符串 prefix 判断。 */
function safeNext(raw) {
  if (typeof raw !== 'string') return '/';
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, '');
  if (!cleaned.startsWith('/')) return '/';
  if (cleaned.startsWith('//') || cleaned.startsWith('/\\')) return '/';
  const BASE = 'http://checkin.internal';
  let resolved;
  try {
    resolved = new URL(cleaned, BASE);
  } catch (_) {
    return '/';
  }
  if (resolved.origin !== BASE) return '/';
  return cleaned;
}

router.get('/', (req, res) => {
  res.render('index', { title: '学习打卡网页', active: 'home' });
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', {
    title: '登录',
    active: '',
    registered: req.query.registered === '1',
    next: safeNext(req.query.next),
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
// 双人协作广场（Day 8）：组队绑定区接入真实数据，共同任务在 Day 9 上线
router.get('/duo', (req, res) => {
  res.render('duo', { title: '双人协作广场', active: 'duo' });
});

// 全员打卡广场（Day 12）：全站打卡成果展示与筛选（登录可见，未登录跳登录页）
router.get('/gallery', requireAuthPage, (req, res) => {
  res.render('gallery', { title: '全员打卡广场', active: 'gallery' });
});

// 历史记录（Day 7）：打卡统计 + 日期分组列表 + 分类 / 日期筛选（登录可见）
router.get('/history', requireAuthPage, (req, res) => {
  res.render('history', { title: '历史记录', active: 'history' });
});

module.exports = Object.assign(router, { safeNext });
