/**
 * 照片上传中间件（Day 10 从单人打卡路由抽出复用；安全加固补文件头魔数校验）
 *
 * 模块说明：
 *   uploadPhotos           multer 实例：字段名 photos，仅 JPG / PNG，单张 ≤ 10MB，最多 3 张
 *   findNonImageFiles(files)        异步读已落盘文件的头字节，返回不是 PNG/JPEG 的文件名列表
 *   hasImageMagic(buffer)            Buffer 头字节是否为 PNG / JPEG 魔数（供 dbCheck 直测）
 *   cleanupUploadedPhotos(files)   业务校验失败时删除本次已落盘文件（尽力而为）
 *   multerErrorResponse(err)       multer 错误 → { status, message, errors }；非 multer 错误返回 null
 *
 * 上传约定：
 *   * 文件名由服务端生成（时间戳 + 随机串 + 白名单后缀），不信任原始文件名
 *   * 落盘 public/uploads/（静态目录直出），库内存相对路径 uploads/xxx.jpg
 *   * 三道校验：MIME 白名单（客户端声明）→ 文件头魔数（真实内容）→ 响应头 nosniff，
 *     改后缀 / 伪装 Content-Type 的 HTML 等非图片内容会被魔数校验直接拒绝
 *   * 更深的内容检查（图片可解码性 / 尺寸上限 / 病毒扫描）按计划留到 Day 20
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '../../public/uploads');
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png' }; // 后缀只从白名单映射，不吃原始名
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PHOTOS = 3;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // \x89PNG\r\n\x1a\n
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]); // ÿØÿ

fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // uploads 已在 .gitignore，首次上传前确保目录存在

/** Buffer 头字节是否为 PNG / JPEG 魔数 */
function hasImageMagic(buf) {
  if (!buf || buf.length < 3) return false;
  if (buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return true;
  return buf.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC);
}

/** 逐一读取已落盘文件头 8 字节，返回内容不是 PNG/JPEG 的文件名列表（读取失败的文件也计入） */
async function findNonImageFiles(files) {
  const bad = [];
  for (const f of files || []) {
    let head;
    try {
      const fh = await fs.promises.open(path.join(UPLOAD_DIR, f.filename), 'r');
      try {
        const buf = Buffer.alloc(8);
        const { bytesRead } = await fh.read(buf, 0, 8, 0);
        head = buf.subarray(0, bytesRead);
      } finally {
        await fh.close();
      }
    } catch (_) {
      bad.push(f.filename);
      continue;
    }
    if (!hasImageMagic(head)) bad.push(f.filename);
  }
  return bad;
}

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

module.exports = {
  uploadPhotos,
  findNonImageFiles,
  hasImageMagic,
  cleanupUploadedPhotos,
  multerErrorResponse,
  MAX_PHOTOS,
  UPLOAD_DIR,
};
