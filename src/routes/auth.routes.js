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
  bumpSessionNotBefore,
  updateProfile,
  updateAvatar,
  clearAvatar,
} = require('../services/user.service');
const { requireAuth } = require('../middleware/auth');
const { createRateLimiter, loginThrottle } = require('../middleware/rateLimit');
const {
  uploadAvatar,
  findNonImageFiles,
  cleanupAvatarFile,
  removeStoredFile,
  multerErrorResponse,
  AVATAR_DIR,
} = require('../middleware/upload');

const router = express.Router();

/* Day 21 复测（v1.0.3）：登录节流改为「凭据验证前置 + IP/账号双计数」，
 * 见 /login 处理与 rateLimit.js loginThrottle——原 createFailureRateLimiter
 * 的入口硬拦会把共享 NAT 下的正确密码一并 429（认证 DoS）。 */

/* Day 21 复测补丁（v1.0.4，vuln-0004）：凭据验证前置的代价是每条登录尝试都会
 * 执行一次 bcrypt。这道「防爆破闸门」按 IP 对 /login 全部请求（含成功）做
 * 60 次 / 分钟的预限制——远高于正常人类用量，持错密码的合法用户几乎不可能
 * 触发；但能把单 IP 的 bcrypt 开销钳制在 ~1 次 / 秒，持续爆破无法压满 CPU。
 * 已知取舍（文档化于 SECURITY_AUDIT 第十一节）：持续滥用下同一 IP 的正确
 * 凭据也会被 429——配合告警与验证码 / 2FA 是后续方向。 */
const loginVerificationGuard = createRateLimiter({
  windowMs: 60 * 1000,
  max: 60,
  keyFn: (req) => 'login-guard:' + req.ip,
  message: '登录请求过于频繁，请稍后再试',
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

/** 写会话：userId + 签发时间（iat 供改密作废校验，见 user.service.getSessionUser）。
 *  Day 21 复测修复：会话被作废后中间件置 req.session = null（Cookie 仍签名有效），
 *  持有旧 Cookie 的客户端登录 / 注册时必须先初始化空会话，否则置值直接 500。 */
function establishSession(req, userId) {
  if (!req.session) req.session = {};
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

router.post('/login', loginVerificationGuard, async (req, res) => {
  try {
    const { account, password } = req.body || {};
    const acc = String(account || '').trim();
    // Day 21 复测（v1.0.3）：凭据验证前置——正确凭据任何时刻都可登录（修复共享
    // NAT 下单一失败计数器锁死全部用户的认证 DoS，vuln-0002）；失败尝试按 IP +
    // 账号双计数，超阈值后的失败尝试 429（爆破吞吐仍被压制）。401 通用文案与
    // authenticate 的等时时序保持不变，不泄漏账号存在性。
    const user = await authenticate(acc, password);
    if (!user) {
      const state = loginThrottle.recordFailure(req, acc);
      if (state.ipCrossed || state.accountCrossed) {
        console.warn(
          `[auth/login] 节流阈值触发: ip=${req.ip} account=${acc} ` +
            `(ipFails=${state.ipFails}/10, accountFails=${state.accountFails}/5)`
        );
      }
      if (state.throttled) {
        res.setHeader('Retry-After', String(state.retryAfterSec));
        return res.status(429).json({ message: '失败次数过多，请 15 分钟后再试' });
      }
      return res.status(401).json({ message: '账号或密码错误' });
    }
    loginThrottle.clear(acc);
    establishSession(req, user.id);
    res.json({ message: '登录成功', user });
  } catch (err) {
    console.error('[auth/login]', err);
    res.status(500).json({ message: '服务器开小差了，请稍后再试' });
  }
});

router.post('/logout', (req, res) => {
  // Day 19：除清除 Cookie 外，推进 session_not_before 作废该账号全部已签发会话——
  // cookie-session 的会话数据在 Cookie 本身，仅清 Cookie 挡不住被盗 Cookie 的重放。
  if (req.session && req.session.userId) {
    bumpSessionNotBefore(req.session.userId);
  }
  req.session = null;
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
      // Day 21 复测（v1.0.3）：空体 / 截断体等解析失败按客户端错误 400 返回，不再 500
      console.warn('[auth/avatar] multipart 解析失败:', err.message || err);
      return res.status(400).json({ message: '头像表单不完整或格式错误，请重新提交' });
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
