/**
 * 全员打卡广场路由（Day 12）
 *
 * 模块说明（全部需登录）：
 *   GET  /api/gallery        全站打卡流（单人 + 双人合并，时间倒序；scope 筛选 + 分页）
 *   GET  /api/gallery/stats  广场统计（全站累计 / 今日打卡 / 今日参与人数）
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const galleryService = require('../services/gallery.service');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  try {
    res.json(galleryService.listGallery(req.query));
  } catch (err) {
    console.error('[gallery/list]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

router.get('/stats', (req, res) => {
  try {
    res.json({ stats: galleryService.galleryStats() });
  } catch (err) {
    console.error('[gallery/stats]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

module.exports = router;
