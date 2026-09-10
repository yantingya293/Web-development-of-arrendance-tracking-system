/**
 * 用户服务层（Day 3）
 *
 * 模块说明：
 *   registerUser({nickname, account, password})  校验 + 创建用户（自动登录由路由层写 session）
 *   authenticate(account, password)               登录校验，成功返回公开用户信息，失败返回 null
 *   findPublicById(id)                            按主键查公开用户信息
 *   publicUser(row)                               剥离 password_hash 等敏感字段
 *
 * 策略约定（Day 3 拍板）：
 *   * 密码 6–32 位，必须同时包含字母和数字；bcrypt cost 10 哈希存储
 *   * 账号 3–24 位字母 / 数字 / 下划线，全局唯一
 *   * 昵称 1–20 个字符（去首尾空格）
 *   * 登录失败统一提示「账号或密码错误」，不区分账号不存在与密码错误（防探测）
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

function registerUser({ nickname, account, password }) {
  const { errors, name, acc } = validateRegister({ nickname, account, password });
  if (Object.keys(errors).length) throw httpError(400, '表单校验未通过', errors);

  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE account = ?').get(acc))
    throw httpError(409, '该账号已被注册', { account: '该账号已被注册' });

  const hash = bcrypt.hashSync(String(password), 10);
  const info = db
    .prepare('INSERT INTO users (nickname, account, password_hash) VALUES (?, ?, ?)')
    .run(name, acc, hash);

  return findPublicById(info.lastInsertRowid);
}

function authenticate(account, password) {
  const acc = String(account || '').trim();
  const row = getDb().prepare('SELECT * FROM users WHERE account = ?').get(acc);
  if (!row) return null;
  const ok = bcrypt.compareSync(String(password || ''), row.password_hash);
  return ok ? publicUser(row) : null;
}

function findPublicById(id) {
  return publicUser(getDb().prepare('SELECT * FROM users WHERE id = ?').get(id));
}

module.exports = { registerUser, authenticate, findPublicById, publicUser };
