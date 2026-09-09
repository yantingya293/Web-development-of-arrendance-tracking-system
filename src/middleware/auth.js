/**
 * 鉴权中间件（Day 3）
 *
 * 模块说明：
 *   requireAuth      API 守卫：未登录返回 401 JSON
 *   requireAdmin     API 守卫：未登录 401，非管理员 403
 *   requireAuthPage  页面守卫：未登录重定向 /login（带 next 回跳参数）
 *   requireAdminPage 页面守卫：未登录跳登录；已登录非管理员渲染 403
 */
const { findPublicById } = require('../services/user.service');

function loginRedirect(req, res) {
  const next = encodeURIComponent(req.originalUrl || '/');
  res.redirect(`/login?next=${next}`);
}

function requireAuth(req, res, next) {
  const user = req.session && req.session.userId ? findPublicById(req.session.userId) : null;
  if (!user) return res.status(401).json({ message: '未登录或会话已过期' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, (err) => {
    if (err) return next(err);
    if (req.user.role !== 'admin') {
      return res.status(403).json({ message: '需要管理员权限' });
    }
    next();
  });
}

function requireAuthPage(req, res, next) {
  const user = req.session && req.session.userId ? findPublicById(req.session.userId) : null;
  if (!user) return loginRedirect(req, res);
  req.user = user;
  next();
}

function requireAdminPage(req, res, next) {
  const user = req.session && req.session.userId ? findPublicById(req.session.userId) : null;
  if (!user) return loginRedirect(req, res);
  if (user.role !== 'admin') {
    return res.status(403).render('error', {
      title: '无权访问',
      code: 403,
      message: '该页面仅管理员可访问。',
    });
  }
  req.user = user;
  next();
}

module.exports = { requireAuth, requireAdmin, requireAuthPage, requireAdminPage };
