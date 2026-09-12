/**
 * 个人数据统计路由（Day 13）
 *
 * 模块说明（全部需登录）：
 *   GET  /api/stats/dashboard         个人中心数据看板（任务完成率 / 分类分布 / 打卡日历）
 *   GET  /api/stats/dashboard?month=YYYY-MM  查看指定月份的日历（缺省当前月，非法格式回退当前月）
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const statsService = require('../services/stats.service');

const router = express.Router();
router.use(requireAuth);

router.get('/dashboard', (req, res) => {
  try {
    res.json({ dashboard: statsService.myDashboard(req.user.id, req.query) });
  } catch (err) {
    console.error('[stats/dashboard]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

module.exports = router;
