/**
 * 单人打卡路由（Day 6；Day 10 上传逻辑抽至 src/middleware/upload.js 复用）
 *
 * 模块说明（全部需登录）：
 *   GET  /api/checkins          我的单人打卡记录（limit ≤ 50 / offset 分页，关联任务标题；
 *                               Day 7 增加 category / date 筛选，并返回符合条件的 total）
 *   GET  /api/checkins/stats    打卡统计（累计 / 今日 / 连续天数 / 近 7 天，Day 7）
 *   POST /api/checkins          提交打卡（multipart/form-data：taskId + note + photos[]）
 *
 * 上传约定：见 src/middleware/upload.js（双人打卡路由同样复用）
 */
const express = require('express');

const { requireAuth } = require('../middleware/auth');
const {
  uploadPhotos,
  findNonImageFiles,
  cleanupUploadedPhotos,
  multerErrorResponse,
} = require('../middleware/upload');
const { createRateLimiter } = require('../middleware/rateLimit');
const checkinService = require('../services/checkin.service');

const router = express.Router();
router.use(requireAuth);

/** 单人打卡每日上限（按用户）：同日多次打卡的产品语义保留，仅封顶防滥用（磁盘填充） */
const checkinDailyLimiter = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 30,
  keyFn: (req) => 'checkin:' + req.user.id,
  message: '今天提交的打卡太多了，明天再来吧',
});

/** Multer / 业务错误 → 友好 JSON；其余 500 兜底 */
function sendError(prefix, res, err) {
  const multerErr = multerErrorResponse(err);
  if (multerErr) {
    return res.status(multerErr.status).json({ message: multerErr.message, errors: multerErr.errors });
  }
  if (err && err.status) {
    return res.status(err.status).json({ message: err.message, errors: err.errors });
  }
  console.error(`[${prefix}]`, err);
  res.status(500).json({ message: '服务器开小差了，请稍后再试' });
}

router.get('/', (req, res) => {
  try {
    res.json(checkinService.listMyCheckins(req.user.id, req.query));
  } catch (err) {
    sendError('checkins/list', res, err);
  }
});

router.get('/stats', (req, res) => {
  try {
    res.json({ stats: checkinService.myCheckinStats(req.user.id) });
  } catch (err) {
    sendError('checkins/stats', res, err);
  }
});

router.post('/', checkinDailyLimiter, (req, res) => {
  if (!req.is('multipart/form-data')) {
    return res.status(400).json({ message: '请使用 multipart/form-data 提交打卡表单' });
  }
  uploadPhotos.array('photos', checkinService.MAX_PHOTOS)(req, res, async (multerErr) => {
    if (multerErr) return sendError('checkins/upload', res, multerErr);

    const files = req.files || [];
    // 魔数校验：伪装 Content-Type 的非图片内容（如 HTML）直接拒绝并清理
    const badFiles = await findNonImageFiles(files);
    if (badFiles.length) {
      cleanupUploadedPhotos(files);
      return res.status(400).json({
        message: '仅支持真实 JPG / PNG 图片',
        errors: { photos: '文件内容不是有效的 JPG / PNG 图片' },
      });
    }
    try {
      const checkin = checkinService.createSoloCheckin(req.user, {
        taskId: req.body.taskId,
        note: req.body.note,
        photos: files.map((f) => `uploads/${f.filename}`),
      });
      res.status(201).json({ message: '打卡成功', checkin });
    } catch (err) {
      cleanupUploadedPhotos(files); // 业务校验没过，不留孤儿图片
      sendError('checkins/create', res, err);
    }
  });
});

module.exports = router;
