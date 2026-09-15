/**
 * 用户鉴权路由（Day 3；安全加固补改密与限流；Day 14 补个人资料）
 *
 * 模块说明：
 *   POST   /api/auth/register         注册（校验 + bcrypt 哈希，成功后自动登录）
 *   POST   /api/auth/login            登录（session 写入 userId + iat）
 *   POST   /api/auth/logout           退出登录（销毁 session）
 *   POST   /api/auth/change-password  修改密码（需登录；成功后其他设备会话全部作废）
 *   PATCH  /api/auth/profile          修改昵称（Day 14，需登录）
 *   POST   /api/auth/avatar           上传 / 更换头像（Day 14，multipart 单图，需登录）
 *   DELETE /api/auth/avatar           撤销头像（Day 14，需登录）
 *   GET    /api/auth/me               当前登录用户信息（requireAuth 保护）
 *
 * 限流（内存计数，见 src/middleware/rateLimit.js）：
 *   登录   每 IP 15 分钟 10 次【仅计失败】：成功登录不占限额（正常用户不会被锁），
 *          放缓暴破；叠加 bcrypt 异步化避免阻塞事件循环
 *   注册   每 IP 1 小时 5 次（防机器人批量注册）
 *   改密   每用户 15 分钟 5 次：被盗会话持有者可借该接口暴破旧密码——
 *          成功改密即踢掉真主人完成接管，故挂严限流（成功与否都计一次尝试）
 *   改资料 每用户 15 分钟 30 次（昵称 / 头像写操作，防刷库与刷磁盘）
 */
const express = require('express');
const {
  registerUser,
  authenticate,
  changePassword,
  updateProfile,
  updateAvatar,
  clearAvatar,
} = require('../services/user.service');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter, createFailureRateLimiter } = require('../middleware/rateLimit');
const {
  uploadAvatar,
  findNonImageFiles,
  cleanupAvatarFile,
  removeStoredFile,
  multerErrorResponse,
  AVATAR_DIR,
} = require('../middleware/upload');

const router = express.Router();

const loginLimiter = createFailureRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => 'login:' + req.ip,
  message: '失败次数过多，请 15 分钟后再试',
});

const registerLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyFn: (req) => 'register:' + req.ip,
  message: '注册过于频繁，请 1 小时后再试',
});

const changePwdLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyFn: (req) => 'change-pwd:' + req.user.id,
  message: '操作过于频繁，请 15 分钟后再试',
});

const profileLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyFn: (req) => 'profile:' + req.user.id,
  message: '操作过于频繁，请稍后再试',
});

/** 业务错误（带 status）原样返回，其余按 500 兜底 */
function sendError(prefix, res, err) {
  if (err.status) {
    return res.status(err.status).json({ message: err.message, errors: err.errors });
  }
  console.error(`[${prefix}]`, err);
  res.status(500).json({ message: '服务器开小差了，请稍后再试' });
}

/** 头像相对路径（库中存 uploads/ 前缀，静态目录直出） */
function avatarRelPath(filename) {
  return 'uploads/avatars/' + filename;
}

/** 写会话：userId + 签发时间（iat 供改密作废校验，见 user.service.getSessionUser） */
function establishSession(req, userId) {
  req.session.userId = userId;
  req.session.iat = Date.now();
}

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { nickname, account, password } = req.body || {};
    const user = await registerUser({ nickname, account, password });
    establishSession(req, user.id); // 注册成功即登录
    res.status(201).json({ message: '注册成功', user });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message, errors: err.errors });
    }
    console.error('[auth/register]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { account, password } = req.body || {};
    const user = await authenticate(account, password);
    if (!user) {
      return res.status(401).json({ message: '账号或密码错误' });
    }
    establishSession(req, user.id);
    res.json({ message: '登录成功', user });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

router.post('/logout', (req, res) => {
  req.session = null; // cookie-session：置 null 即清除会话 Cookie
  res.json({ message: '已退出登录' });
});

/** 修改密码：成功后以新 iat 续期当前会话（用户不掉线），其余设备全部登出。
 *  限流挂在 requireAuth 之后（按 req.user.id 计数） */
router.post('/change-password', requireAuth, changePwdLimiter, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body || {};
    await changePassword(req.user, oldPassword, newPassword);
    establishSession(req, req.user.id);
    res.json({ message: '密码已修改，其他已登录设备已全部退出' });
  } catch (err) {
    if (err.status) {
      return res.status(err.status).json({ message: err.message, errors: err.errors });
    }
    console.error('[auth/change-password]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

/** Day 14：修改昵称（JSON）。昵称不参与鉴权，改完当前会话无需重建。 */
router.patch('/profile', requireAuth, profileLimiter, (req, res) => {
  try {
    const user = updateProfile(req.user, req.body || {});
    res.json({ message: '昵称已更新', user });
  } catch (err) {
    sendError('auth/profile', res, err);
  }
});

/** Day 14：上传 / 更换头像（multipart，字段名 avatar，单图 JPG/PNG ≤ 2MB）。
 *  先过 MIME 白名单（multer）→ 再验文件头魔数 → 成功入库并清理旧头像。 */
router.post('/avatar', requireAuth, profileLimiter, (req, res) => {
  uploadAvatar.single('avatar')(req, res, async (err) => {
    if (err) {
      const me = multerErrorResponse(err, { field: 'avatar', label: '头像', maxSizeLabel: '2MB' });
      if (me) return res.status(me.status).json({ message: me.message, errors: me.errors });
      return sendError('auth/avatar', res, err);
    }
    if (!req.file) {
      return res.status(400).json({ message: '请选择头像图片', errors: { avatar: '请选择头像图片' } });
    }
    try {
      const bad = await findNonImageFiles([req.file], AVATAR_DIR);
      if (bad.length) {
        cleanupAvatarFile(req.file);
        return res.status(400).json({
          message: '文件内容不是有效的 JPG / PNG 图片',
          errors: { avatar: '文件内容不是有效的 JPG / PNG 图片' },
        });
      }
      const { previous, user } = updateAvatar(req.user, avatarRelPath(req.file.filename));
      if (previous) removeStoredFile(previous); // 换新图后清掉旧图（尽力而为）
      res.json({ message: '头像已更新', user });
    } catch (e) {
      cleanupAvatarFile(req.file); // 入库失败则删除本次落盘文件，避免垃圾堆积
      sendError('auth/avatar', res, e);
    }
  });
});

/** Day 14：撤销头像，恢复为首字兜底样式 */
router.delete('/avatar', requireAuth, profileLimiter, (req, res) => {
  try {
    const { previous, user } = clearAvatar(req.user);
    if (previous) removeStoredFile(previous);
    res.json({ message: '头像已移除', user });
  } catch (err) {
    sendError('auth/avatar-delete', res, err);
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
