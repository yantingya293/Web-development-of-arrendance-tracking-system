/**
 * 照片上传中间件（Day 10 从单人打卡路由抽出复用）
 *
 * 模块说明：
 *   uploadPhotos           multer 实例：字段名 photos，仅 JPG / PNG，单张 ≤ 10MB，最多 3 张
 *   cleanupUploadedPhotos(files)   业务校验失败时删除本次已落盘文件（尽力而为）
 *   multerErrorResponse(err)       multer 错误 → { status, message, errors }；非 multer 错误返回 null
 *
 * 上传约定（与 Day 6 单人打卡一致）：
 *   * 文件名由服务端生成（时间戳 + 随机串 + 白名单后缀），不信任原始文件名
 *   * 落盘 public/uploads/（静态目录直出），库内存相对路径 uploads/xxx.jpg
 *   * 文件头魔数校验（防改后缀伪装）按计划留到 Day 20 安全专项
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png' }; // 后缀只从白名单映射，不吃原始名
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PHOTOS = 3;

fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // uploads 已在 .gitignore，首次上传前确保目录存在

const uploadPhotos = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => {
      const ext = MIME_EXT[file.mimetype] || '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_PHOTOS },
  fileFilter: (_req, file, cb) => {
    if (MIME_EXT[file.mimetype]) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname)); // 复用 multer 错误通道
  },
});

/** 校验失败时清掉本次已落盘的文件（删除失败只记日志） */
function cleanupUploadedPhotos(files) {
  for (const f of files || []) {
    fs.unlink(path.join(UPLOAD_DIR, f.filename), (err) => {
      if (err && err.code !== 'ENOENT') {
        console.warn('[upload/cleanup] 删除残留上传失败:', f.filename, err.message);
      }
    });
  }
}

/** multer 错误 → 友好 JSON 片段；不是 multer 错误返回 null（交给业务错误通道） */
function multerErrorResponse(err) {
  if (!err || !err.code) return null;
  if (err.code === 'LIMIT_FILE_SIZE') {
    return { status: 400, message: '单张照片不能超过 10MB', errors: { photos: '单张照片不能超过 10MB' } };
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    return {
      status: 400,
      message: `照片最多 ${MAX_PHOTOS} 张`,
      errors: { photos: `照片最多 ${MAX_PHOTOS} 张` },
    };
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err instanceof multer.MulterError) {
    return { status: 400, message: '仅支持 JPG / PNG 图片', errors: { photos: '仅支持 JPG / PNG 图片' } };
  }
  return null;
}

module.exports = { uploadPhotos, cleanupUploadedPhotos, multerErrorResponse, MAX_PHOTOS, UPLOAD_DIR };
