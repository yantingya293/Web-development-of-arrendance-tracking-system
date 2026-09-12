/**
 * 双人打卡路由（Day 10）
 *
 * 模块说明（全部需登录）：
 *   GET  /api/duo-checkins   当前队伍的双人打卡记录（双方可见；taskId 筛选 + 分页）
 *   POST /api/duo-checkins   提交双人打卡（multipart/form-data：duoTaskId + note + photos[]）
 *
 * 上传约定与单人打卡一致（见 src/middleware/upload.js）；
 * 每日一次约束在服务层（应用层预检 + duo_checkins 唯一索引兜底）。
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
const duoCheckinService = require('../services/duoCheckin.service');

const router = express.Router();
router.use(requireAuth);

/** 双人打卡每日上限（按用户，跨任务合计）：单任务每日一次由唯一索引兜底，此处封顶防滥用 */
const duoCheckinDailyLimiter = createRateLimiter({
  windowMs: 24 * 60 * 60 * 1000,
  max: 30,
  keyFn: (req) => 'duo-checkin:' + req.user.id,
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
    res.json(duoCheckinService.listDuoCheckins(req.user, req.query));
  } catch (err) {
    sendError('duoCheckins/list', res, err);
  }
});

router.post('/', duoCheckinDailyLimiter, (req, res) => {
  if (!req.is('multipart/form-data')) {
    return res.status(400).json({ message: '请使用 multipart/form-data 提交打卡表单' });
  }
  uploadPhotos.array('photos', 3)(req, res, async (multerErr) => {
    if (multerErr) return sendError('duoCheckins/upload', res, multerErr);

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
      const checkin = duoCheckinService.createDuoCheckin(req.user, {
        duoTaskId: req.body.duoTaskId,
        note: req.body.note,
        photos: files.map((f) => `uploads/${f.filename}`),
      });
      res.status(201).json({ message: '打卡成功，搭档已收到通知', checkin });
    } catch (err) {
      cleanupUploadedPhotos(files); // 业务校验没过，不留孤儿图片
      sendError('duoCheckins/create', res, err);
    }
  });
});

module.exports = router;
