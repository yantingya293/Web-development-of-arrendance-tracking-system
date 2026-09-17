/**
 * 上传中间件（Day 10 从单人打卡路由抽出复用；安全加固补文件头魔数校验；Day 14 补头像单图）
 *
 * 模块说明：
 *   uploadPhotos           multer 实例：字段名 photos，仅 JPG / PNG，单张 ≤ 10MB，最多 3 张
 *   uploadAvatar           multer 实例：字段名 avatar，仅 JPG / PNG，≤ 2MB，单张（Day 14）
 *   findNonImageFiles(files, dir)   异步读已落盘文件的头字节，返回不是 PNG/JPEG 的文件名列表
 *   hasImageMagic(buffer)            Buffer 头字节是否为 PNG / JPEG 魔数（供 dbCheck 直测）
 *   cleanupUploadedPhotos(files)   业务校验失败时删除本次已落盘文件（尽力而为）
 *   cleanupAvatarFile(file)        同上，针对头像目录（Day 14）
 *   removeStoredFile(relPath)      删除库中记录的相对路径文件（换头像 / 撤销头像时清旧图）
 *   multerErrorResponse(err)       multer 错误 → { status, message, errors }；非 multer 错误返回 null
 *
 * 上传约定：
 *   * 文件名由服务端生成（时间戳 + 随机串 + 白名单后缀），不信任原始文件名
 *   * 打卡照片落盘 data/uploads/，头像落盘 data/uploads/avatars/（Day 18 起移出 public
 *     公开静态目录——/uploads/* 必须登录后才能访问，见 app.js 挂载的鉴权静态路由），
 *     库内存相对路径 uploads/xxx.jpg 或 uploads/avatars/xxx.png（URL 不变，前端零改动）
 *   * 三道校验：MIME 白名单（客户端声明）→ 文件头魔数（真实内容）→ 响应头 nosniff，
 *     改后缀 / 伪装 Content-Type 的 HTML 等非图片内容会被魔数校验直接拒绝
 *   * 更深的内容检查（图片可解码性 / 尺寸上限 / 病毒扫描）按计划留到 Day 20
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

const UPLOAD_DIR = path.join(__dirname, '../../data/uploads');
const AVATAR_DIR = path.join(UPLOAD_DIR, 'avatars');
const LEGACY_UPLOAD_DIR = path.join(__dirname, '../../public/uploads'); // Day 18 之前的老目录
const MIME_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png' }; // 后缀只从白名单映射，不吃原始名
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_PHOTOS = 3;
const MAX_AVATAR_SIZE = 2 * 1024 * 1024;

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // \x89PNG\r\n\x1a\n
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]); // ÿØÿ

fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // uploads 已在 .gitignore，首次上传前确保目录存在
fs.mkdirSync(AVATAR_DIR, { recursive: true });

/* Day 18：老库的 public/uploads 整体迁移到 data/uploads（幂等，同名不覆盖）。
   目录递归合并——avatars/ 等子目录在新处已存在时逐文件搬移，不能整目录跳过，
   否则 rmSync 清理老目录时会把未搬走的文件一并删掉。
   库里的相对路径与访问 URL 均为 uploads/... 不变，仅磁盘位置变化。 */
function moveDirInto(fromDir, toDir) {
  for (const entry of fs.readdirSync(fromDir)) {
    const from = path.join(fromDir, entry);
    const to = path.join(toDir, entry);
    if (fs.statSync(from).isDirectory()) {
      fs.mkdirSync(to, { recursive: true });
      moveDirInto(from, to);
    } else if (!fs.existsSync(to)) {
      fs.renameSync(from, to);
    }
  }
}

try {
  if (fs.existsSync(LEGACY_UPLOAD_DIR)) {
    moveDirInto(LEGACY_UPLOAD_DIR, UPLOAD_DIR);
    fs.rmSync(LEGACY_UPLOAD_DIR, { recursive: true, force: true });
    console.log('[upload] 已将历史上传文件从 public/uploads 迁移至 data/uploads');
  }
} catch (err) {
  console.warn('[upload] 历史上传目录迁移失败（不影响启动，可手动移动）:', err.message);
}

/** Buffer 头字节是否为 PNG / JPEG 魔数 */
function hasImageMagic(buf) {
  if (!buf || buf.length < 3) return false;
  if (buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return true;
  return buf.subarray(0, JPEG_MAGIC.length).equals(JPEG_MAGIC);
}

/** 读单个绝对路径文件的头 8 字节，判断是否为 PNG / JPEG 魔数（读取失败视为不通过） */
async function fileHasImageMagic(absPath) {
  try {
    const fh = await fs.promises.open(absPath, 'r');
    try {
      const buf = Buffer.alloc(8);
      const { bytesRead } = await fh.read(buf, 0, 8, 0);
      return hasImageMagic(buf.subarray(0, bytesRead));
    } finally {
      await fh.close();
    }
  } catch (_) {
    return false;
  }
}

/** 逐一读取已落盘文件头，返回内容不是 PNG/JPEG 的文件名列表（读取失败的文件也计入）。
 *  dir 默认打卡照片目录，头像上传传 AVATAR_DIR。 */
async function findNonImageFiles(files, dir = UPLOAD_DIR) {
  const bad = [];
  for (const f of files || []) {
    if (!(await fileHasImageMagic(path.join(dir, f.filename)))) bad.push(f.filename);
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

/* ---------- Day 14：头像单图上传 ---------- */

const uploadAvatar = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, AVATAR_DIR),
    filename: (_req, file, cb) => {
      const ext = MIME_EXT[file.mimetype] || '';
      cb(null, `avatar-${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: MAX_AVATAR_SIZE, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (MIME_EXT[file.mimetype]) return cb(null, true);
    cb(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
  },
});

/** 头像校验失败时清掉本次已落盘文件 */
function cleanupAvatarFile(file) {
  if (!file || !file.filename) return;
  fs.unlink(path.join(AVATAR_DIR, file.filename), (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn('[upload/cleanup] 删除残留头像失败:', file.filename, err.message);
    }
  });
}

/**
 * 删除库中记录的相对路径文件（换头像 / 撤销头像时清理旧图，尽力而为）。
 * 只接受 uploads/ 前缀；文件位于 data/uploads/（Day 18 起移出公开静态目录）。
 */
function removeStoredFile(relPath) {
  const rel = String(relPath || '');
  if (!rel.startsWith('uploads/')) return;
  fs.unlink(path.join(UPLOAD_DIR, rel.slice('uploads/'.length)), (err) => {
    if (err && err.code !== 'ENOENT') {
      console.warn('[upload/cleanup] 删除旧文件失败:', rel, err.message);
    }
  });
}

/** 批量删除库中记录的相对路径文件（删除任务 / 共同任务时清理其打卡照片，尽力而为） */
function removeStoredFiles(relPaths) {
  (Array.isArray(relPaths) ? relPaths : []).forEach(removeStoredFile);
}

/** multer 错误 → 友好 JSON 片段；不是 multer 错误返回 null（交给业务错误通道）。
 *  opts 可指定字段名与提示语义（头像复用同一套错误通道）。 */
function multerErrorResponse(err, opts) {
  if (!err || !err.code) return null;
  const field = (opts && opts.field) || 'photos';
  const label = (opts && opts.label) || '照片';
  const maxSize = (opts && opts.maxSizeLabel) || '10MB';
  if (err.code === 'LIMIT_FILE_SIZE') {
    const msg = `单张${label}不能超过 ${maxSize}`;
    return { status: 400, message: msg, errors: { [field]: msg } };
  }
  if (err.code === 'LIMIT_FILE_COUNT') {
    const msg = `${label}最多 ${MAX_PHOTOS} 张`;
    return { status: 400, message: msg, errors: { [field]: msg } };
  }
  if (err.code === 'LIMIT_UNEXPECTED_FILE' || err instanceof multer.MulterError) {
    const msg = '仅支持 JPG / PNG 图片';
    return { status: 400, message: msg, errors: { [field]: msg } };
  }
  return null;
}

module.exports = {
  uploadPhotos,
  uploadAvatar,
  findNonImageFiles,
  hasImageMagic,
  fileHasImageMagic,
  cleanupUploadedPhotos,
  cleanupAvatarFile,
  removeStoredFile,
  removeStoredFiles,
  multerErrorResponse,
  MAX_PHOTOS,
  MAX_AVATAR_SIZE,
  UPLOAD_DIR,
  AVATAR_DIR,
};
