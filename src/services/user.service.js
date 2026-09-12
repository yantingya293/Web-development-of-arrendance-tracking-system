/**
 * 用户服务层（Day 3；安全加固补改密 / 会话作废）
 *
 * 模块说明：
 *   registerUser({nickname, account, password})  校验 + 创建用户（自动登录由路由层写 session）
 *   authenticate(account, password)               登录校验，成功返回公开用户信息，失败返回 null（async）
 *   changePassword(user, oldPassword, newPassword) 修改密码并作废该用户全部旧会话（async）
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
const { getDb } = require('../db/db');

const ACCOUNT_RE = /^[A-Za-z0-9_]{3,24}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d)\S{6,32}$/;

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
  else if (name.length > 20) errors.nickname = '昵称不能超过 20 个字符';

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
  if (db.prepare('SELECT id FROM users WHERE account = ?').get(acc))
    throw httpError(409, '该账号已被注册', { account: '该账号已被注册' });

  const hash = await bcrypt.hash(String(password), 10);
  const info = db
    .prepare('INSERT INTO users (nickname, account, password_hash) VALUES (?, ?, ?)')
    .run(name, acc, hash);

  return findPublicById(info.lastInsertRowid);
}

async function authenticate(account, password) {
  const acc = String(account || '').trim();
  const row = getDb().prepare('SELECT * FROM users WHERE account = ?').get(acc);
  if (!row) return null;
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
  getSessionUser,
  findPublicById,
  publicUser,
  PASSWORD_RE,
};
