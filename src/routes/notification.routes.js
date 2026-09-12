/**
 * 站内通知路由（Day 10）
 *
 * 模块说明（全部需登录）：
 *   GET  /api/notifications           我的最新通知（默认 10 条，payload 已解析）
 *   POST /api/notifications/read-all  我的全部未读通知标记已读
 *
 * 说明：组队邀请的接受 / 拒绝走 /api/team/invites/:id/*（Day 8），
 * 本路由只负责通知的展示与已读管理。
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const notificationService = require('../services/notification.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  try {
    res.json({ notifications: notificationService.listMyNotifications(req.user.id, req.query.limit) });
  } catch (err) {
    console.error('[notifications/list]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

router.post('/read-all', (req, res) => {
  try {
    const changed = notificationService.markAllRead(req.user.id);
    res.json({ message: `已将 ${changed} 条通知标记为已读`, changed });
  } catch (err) {
    console.error('[notifications/readAll]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

module.exports = router;
