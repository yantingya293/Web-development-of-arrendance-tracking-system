/**
 * 用户服务层（Day 3；安全加固补改密 / 会话作废；Day 14 补个人资料）
 *
 * 模块说明：
 *   registerUser({nickname, account, password})  校验 + 创建用户（自动登录由路由层写 session）
 *   authenticate(account, password)               登录校验，成功返回公开用户信息，失败返回 null（async）
 *   changePassword(user, oldPassword, newPassword) 修改密码并作废该用户全部旧会话（async）
 *   updateProfile(user, {nickname})               修改昵称（Day 14）
 *   updateAvatar(user, relPath)                   写入头像相对路径，返回被替换的旧路径（Day 14）
 *   clearAvatar(user)                             撤销头像，返回被删除的旧路径（Day 14）
 *   getSessionUser(session)                       会话 → 当前用户（校验 iat 不早于 session_not_before）
 *   findPublicById(id)                            按主键查公开用户信息
 *   publicUser(row)                               剥离 password_hash 等敏感字段
 *
 * 策略约定（Day 3 拍板）：
 *   * 密码 6–32 位，必须同时包含字母和数字；bcrypt cost 10 哈希存储
 *   * 账号 3–24 位字母 / 数字 / 下划线，全局唯一
 *   * 昵称 1–20 个字符（去首尾空格）
 *   * 登录失败统一提示「账号或密码错误」，不区分账号不存在与密码错误（防探测）
 *   * 改密成功即把 users.session_not_before 推进到当前毫秒：签发时间早于它的会话
 *     （包括被盗 Cookie）全部失效，当前会话由路由层用新 iat 续期
 *   * bcrypt 用异步接口（compare/hash）：同步版会阻塞事件循环，暴破请求可借此打满 CPU
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('../db/db');

const ACCOUNT_RE = /^[A-Za-z0-9_]{3,24}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)\S{6,32}$/;
const NICKNAME_MAX = 20;

/** 预置 bcrypt 哈希（随机口令，cost 10）：重复账号路径做等时处理，
 *  使「账号已存在」与正常注册耗时相当，避免凭响应里有无 bcrypt 耗时
 *  探测账号是否已注册（Day 15 安全加固，时序侧信道收口）。 */
const DUMMY_PASSWORD_HASH = bcrypt.hashSync(crypto.randomBytes(32).toString('hex'), 10);

function httpError(status, message, errors) {
  const err = new Error(message);
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

function publicUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

function validateRegister({ nickname, account, password }) {
  const errors = {};
  const name = String(nickname || '').trim();
  if (!name) errors.nickname = '请填写昵称';
  else if (name.length > NICKNAME_MAX) errors.nickname = `昵称不能超过 ${NICKNAME_MAX} 个字符`;

  const acc = String(account || '').trim();
  if (!acc) errors.account = '请填写账号';
  else if (!ACCOUNT_RE.test(acc))
    errors.account = '账号为 3–24 位字母、数字或下划线';

  if (!password) errors.password = '请填写密码';
  else if (!PASSWORD_RE.test(password))
    errors.password = '密码为 6–32 位，且须同时包含字母和数字';

  return { errors, name, acc };
}

async function registerUser({ nickname, account, password }) {
  const { errors, name, acc } = validateRegister({ nickname, account, password });
  if (Object.keys(errors).length) throw httpError(400, '表单校验未通过', errors);

  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE account = ?').get(acc)) {
    // 等时处理后再返回 409（见 DUMMY_PASSWORD_HASH）；并发撞唯一索引的竞态
    // 走下方 catch，两条路径的响应完全同形，封掉枚举之外的时序/并发 oracle
    await bcrypt.compare(String(password), DUMMY_PASSWORD_HASH);
    throw httpError(409, '该账号已被注册', { account: '该账号已被注册' });
  }

  const hash = await bcrypt.hash(String(password), 10);
  let info;
  try {
    info = db
      .prepare('INSERT INTO users (nickname, account, password_hash) VALUES (?, ?, ?)')
      .run(name, acc, hash);
  } catch (err) {
    if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) {
      throw httpError(409, '该账号已被注册', { account: '该账号已被注册' });
    }
    throw err;
  }

  return findPublicById(info.lastInsertRowid);
}

async function authenticate(account, password) {
  const acc = String(account || '').trim();
  const row = getDb().prepare('SELECT * FROM users WHERE account = ?').get(acc);
  if (!row) {
    // Day 20：账号不存在也做等量 bcrypt 比较——与注册接口同理，抹平
    // 「响应里有无 bcrypt 耗时」的账号存在性时序侧信道
    await bcrypt.compare(String(password || ''), DUMMY_PASSWORD_HASH);
    return null;
  }
  const ok = await bcrypt.compare(String(password || ''), row.password_hash);
  return ok ? publicUser(row) : null;
}

/**
 * 修改密码：校验旧密码 → 写新哈希 → 推进 session_not_before 作废全部旧会话。
 * 调用方（路由层）在成功后用新 iat 重建当前会话，用户无需重新登录。
 */
async function changePassword(user, oldPassword, newPassword) {
  const row = getDb().prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  if (!row) throw httpError(404, '用户不存在');

  const oldOk = await bcrypt.compare(String(oldPassword || ''), row.password_hash);
  if (!oldOk) {
    throw httpError(400, '旧密码不正确', { oldPassword: '旧密码不正确' });
  }

  const pwd = String(newPassword || '');
  if (!PASSWORD_RE.test(pwd)) {
    throw httpError(400, '表单校验未通过', {
      newPassword: '新密码为 6–32 位，且须同时包含字母和数字',
    });
  }

  const hash = await bcrypt.hash(pwd, 10);
  const notBefore = Date.now();
  getDb()
    .prepare('UPDATE users SET password_hash = ?, session_not_before = ? WHERE id = ?')
    .run(hash, notBefore, user.id);
  return { session_not_before: notBefore };
}

/**
 * 登出会话作废（Day 19，httpCheck 套件暴露）：cookie-session 的会话数据存放在
 * Cookie 本身，登出仅清除 Cookie 挡不住「被盗 Cookie 副本的重放」——与改密同一
 * 机制，推进 session_not_before 让该账号全部已签发会话立即失效。
 */
function bumpSessionNotBefore(userId) {
  getDb().prepare('UPDATE users SET session_not_before = ? WHERE id = ?').run(Date.now(), userId);
}

/**
 * 修改昵称（Day 14）：与注册同一套昵称规则（1–20 字符，去首尾空格）。
 * 昵称不参与鉴权，改完无需重建会话——getSessionUser 每次从库里读最新行。
 */
function updateProfile(user, { nickname }) {
  const name = String(nickname == null ? '' : nickname).trim();
  if (!name) throw httpError(400, '表单校验未通过', { nickname: '请填写昵称' });
  if (name.length > NICKNAME_MAX) {
    throw httpError(400, '表单校验未通过', { nickname: `昵称不能超过 ${NICKNAME_MAX} 个字符` });
  }
  const row = getDb().prepare('SELECT id FROM users WHERE id = ?').get(user.id);
  if (!row) throw httpError(404, '用户不存在');

  getDb().prepare('UPDATE users SET nickname = ? WHERE id = ?').run(name, user.id);
  return findPublicById(user.id);
}

/**
 * 写入头像相对路径（Day 14）。只接受 uploads/ 前缀，避免把任意路径塞进库中；
 * 返回被替换的旧路径，供路由层清理旧文件（尽力而为，失败不影响结果）。
 */
function updateAvatar(user, relPath) {
  const rel = String(relPath || '');
  if (!rel.startsWith('uploads/')) throw httpError(400, '头像路径不合法');

  const before = getDb().prepare('SELECT avatar_path FROM users WHERE id = ?').get(user.id);
  if (!before) throw httpError(404, '用户不存在');

  getDb().prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(rel, user.id);
  return { previous: before.avatar_path || null, user: findPublicById(user.id) };
}

/** 撤销头像（Day 14）：置空 avatar_path，返回旧路径供路由层删除文件 */
function clearAvatar(user) {
  const before = getDb().prepare('SELECT avatar_path FROM users WHERE id = ?').get(user.id);
  if (!before) throw httpError(404, '用户不存在');

  getDb().prepare('UPDATE users SET avatar_path = NULL WHERE id = ?').run(user.id);
  return { previous: before.avatar_path || null, user: findPublicById(user.id) };
}

/**
 * 会话 → 当前用户（app 装载中间件与 API / 页面守卫共用）。
 * 会话缺少 iat 或签发时间早于 users.session_not_before（改密时间）时视为已作废。
 */
function getSessionUser(session) {
  if (!session || !Number.isInteger(session.userId)) return null;
  const user = findPublicById(session.userId);
  if (!user) return null;
  if (
    user.session_not_before &&
    (!Number.isInteger(session.iat) || session.iat < user.session_not_before)
  ) {
    return null;
  }
  return user;
}

function findPublicById(id) {
  return publicUser(getDb().prepare('SELECT * FROM users WHERE id = ?').get(id));
}

module.exports = {
  registerUser,
  authenticate,
  changePassword,
  bumpSessionNotBefore,
  updateProfile,
  updateAvatar,
  clearAvatar,
  getSessionUser,
  findPublicById,
  publicUser,
  PASSWORD_RE,
  NICKNAME_MAX,
};
