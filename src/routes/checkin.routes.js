/**
 * 单人打卡路由（Day 6）
 *
 * 模块说明（全部需登录）：
 *   GET  /api/checkins          我的单人打卡记录（limit ≤ 50 / offset 分页，关联任务标题；
 *                               Day 7 增加 category / date 筛选，并返回符合条件的 total）
 *   GET  /api/checkins/stats    打卡统计（累计 / 今日 / 连续天数 / 近 7 天，Day 7）
 *   POST /api/checkins          提交打卡（multipart/form-data：taskId + note + photos[]）
 *
 * 上传约定（与 Day 4 上传区提示一致）：
 *   * 仅接受 JPG / JPEG / PNG，单张 ≤ 10MB，一次最多 3 张（字段名 photos）
 *   * 文件名由服务端生成（时间戳 + 随机串 + 白名单后缀），不信任原始文件名
 *   * 落盘 public/uploads/（静态目录直出），库内存相对路径 uploads/xxx.jpg
 *   * 业务校验失败时删除本次已落盘文件，不残留孤儿图片
 *   * 文件头魔数校验（防改后缀伪装）按计划留到 Day 20 安全专项
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const { requireAuth } = require('../middleware/auth');
const checkinService = require('../services/checkin.service');

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png' }; // 后缀只从白名单映射，不吃原始名
const MAX_FILE_SIZE = 10 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // uploads 已在 .gitignore，首次上传前确保目录存在

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = MIME_EXT[file.mimetype] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: checkinService.MAX_PHOTOS },
  fileFilter: (_req, file, cb) => {
    if (MIME_EXT[file.mimetype]) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname)); // 复用 multer 错误通道
  },
});

const router = express.Router();
router.use(requireAuth);

/** Multer 错误 → 友好 JSON；业务错误（带 status）原样返回；其余 500 兜底 */
function sendError(prefix, res, err) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: '单张照片不能超过 10MB', errors: { photos: '单张照片不能超过 10MB' } });
  }
  if (err && err.code === 'LIMIT_FILE_COUNT') {
    return res
      .status(400)
      .json({ message: `照片最多 ${checkinService.MAX_PHOTOS} 张`, errors: { photos: `照片最多 ${checkinService.MAX_PHOTOS} 张` } });
  }
  if (err && (err.code === 'LIMIT_UNEXPECTED_FILE' || err instanceof multer.MulterError)) {
    return res.status(400).json({ message: '仅支持 JPG / PNG 图片', errors: { photos: '仅支持 JPG / PNG 图片' } });
  }
  if (err && err.status) {
    return res.status(err.status).json({ message: err.message, errors: err.errors });
  }
  console.error(`[${prefix}]`, err);
  res.status(500).json({ message: '服务器开小差了，请稍后再试' });
}

/** 校验失败时清掉本次已落盘的文件（尽力而为，删除失败只记日志） */
function cleanupFiles(files) {
  for (const f of files || []) {
    fs.unlink(path.join(UPLOAD_DIR, f.filename), (err) => {
      if (err && err.code !== 'ENOENT') console.warn('[checkins/cleanup] 删除残留上传失败:', f.filename, err.message);
    });
  }
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

router.post('/', (req, res) => {
  if (!req.is('multipart/form-data')) {
    return res.status(400).json({ message: '请使用 multipart/form-data 提交打卡表单' });
  }
  upload.array('photos', checkinService.MAX_PHOTOS)(req, res, (multerErr) => {
    if (multerErr) return sendError('checkins/upload', res, multerErr);

    const files = req.files || [];
    try {
      const checkin = checkinService.createSoloCheckin(req.user, {
        taskId: req.body.taskId,
        note: req.body.note,
        photos: files.map((f) => `uploads/${f.filename}`),
      });
      res.status(201).json({ message: '打卡成功', checkin });
    } catch (err) {
      cleanupFiles(files); // 业务校验没过，不留孤儿图片
      sendError('checkins/create', res, err);
    }
  });
});

module.exports = router;
