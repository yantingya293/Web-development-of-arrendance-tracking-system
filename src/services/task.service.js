/**
 * 单人任务服务层（Day 5）
 *
 * 模块说明：
 *   listSoloTasks(userId)                      当前用户可见的单人任务（自己的 + 公共），读取前自动标记逾期
 *   createSoloTask(userId, payload)            新建单人任务（校验 title / category / deadline）
 *   updateSoloTask(user, taskId, payload)      整体更新任务内容（主人或管理员）
 *   updateSoloTaskStatus(user, taskId, status) 状态流转（unstarted / in_progress / completed）
 *   deleteSoloTask(user, taskId)               删除任务（主人或管理员）
 *
 * 策略约定（Day 5 拍板）：
 *   * 分类 category：daily（每日任务）/ weekly（每周重点）/ question（学习问题），默认 daily
 *   * 标题 1–50 字符，说明 ≤ 500 字符；截止时间可空，接受 'YYYY-MM-DD'、
 *     'YYYY-MM-DD HH:MM[:SS]' 与 datetime-local 的 'YYYY-MM-DDTHH:MM'，统一归一为
 *     'YYYY-MM-DD HH:MM:SS' 存储（只给日期时按当天 23:59:59 截止）
 *   * 'overdue' 不开放手动设置：读取时自动把过截止且未完成的任务标记为逾期（sweepOverdue）
 *   * 权限：任务主人或管理员可改可删；公共任务（owner_id 为 NULL）仅管理员可改删，
 *     普通用户对其只读（打卡入口在 Day 6 接入）
 */
const { getDb } = require('../db/db');
const { removeStoredFiles } = require('../middleware/upload');

const CATEGORIES = ['daily', 'weekly', 'question'];
const USER_SETTABLE_STATUS = ['unstarted', 'in_progress', 'completed'];

function httpError(status, message, errors) {
  const err = new Error(message);
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

/** 把过截止时间且未完成的单人任务标记为 overdue（幂等，每次读取前调用） */
function sweepOverdue() {
  getDb()
    .prepare(
      `UPDATE tasks
       SET status = 'overdue'
       WHERE type = 'solo'
         AND deadline IS NOT NULL AND deadline != ''
         AND deadline < datetime('now', 'localtime')
         AND status IN ('unstarted', 'in_progress')`
    )
    .run();
}

/**
 * 截止时间归一化（Day 9 起供双人共同任务服务复用）：
 *   空值 → null（无截止）；'YYYY-MM-DD' → 补 ' 23:59:59'；'…THH:MM' → 空格 + 补 ':00'
 *   格式非法或不是真实日期时间 → 返回 'invalid'
 */
function normalizeDeadline(raw) {
  if (raw === undefined || raw === null) return undefined; // 未传该字段
  let s = String(raw).trim();
  if (!s) return null;

  s = s.replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += ' 23:59:59';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) s += ':00';
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return 'invalid';

  const [Y, Mo, D, h, mi, sec] = m.slice(1).map(Number);
  const dt = new Date(Y, Mo - 1, D, h, mi, sec);
  if (
    dt.getFullYear() !== Y || dt.getMonth() !== Mo - 1 || dt.getDate() !== D ||
    h > 23 || mi > 59 || sec > 59
  ) {
    return 'invalid';
  }
  return s;
}

function validateTaskPayload(payload) {
  const errors = {};

  const title = String(payload.title || '').trim();
  if (!title) errors.title = '请填写任务标题';
  else if (title.length > 50) errors.title = '标题不能超过 50 个字符';

  const description = String(payload.description || '').trim();
  if (description.length > 500) errors.description = '说明不能超过 500 个字符';

  const category =
    payload.category === undefined || payload.category === ''
      ? 'daily'
      : String(payload.category);
  if (!CATEGORIES.includes(category)) errors.category = '任务分类不合法';

  const deadline = normalizeDeadline(payload.deadline);
  if (deadline === 'invalid') errors.deadline = '截止时间格式不正确';

  return { errors, value: { title, description, category, deadline } };
}

function findTaskById(id) {
  return getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(id);
}

/** 取当前用户可管理的单人任务（自己的任务；管理员可操作任意任务含公共任务） */
function getManagedTask(user, taskId) {
  const row = findTaskById(taskId);
  if (!row || row.type !== 'solo') throw httpError(404, '任务不存在');
  const isOwner = row.owner_id !== null && row.owner_id === user.id;
  if (!isOwner && user.role !== 'admin') {
    throw httpError(403, '只能操作自己创建的任务');
  }
  return row;
}

function listSoloTasks(userId) {
  sweepOverdue();
  return getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE type = 'solo' AND (owner_id = ? OR owner_id IS NULL)
       ORDER BY CASE status
                  WHEN 'in_progress' THEN 0
                  WHEN 'unstarted' THEN 1
                  WHEN 'overdue' THEN 2
                  ELSE 3
                END,
                deadline IS NULL,  -- 有截止时间的排前面（更紧急）
                deadline,
                id DESC`
    )
    .all(userId);
}

function createSoloTask(userId, payload) {
  const { errors, value } = validateTaskPayload(payload);
  if (Object.keys(errors).length) throw httpError(400, '表单校验未通过', errors);

  const info = getDb()
    .prepare(
      `INSERT INTO tasks (owner_id, type, category, title, description, deadline)
       VALUES (?, 'solo', @category, @title, @description, @deadline)`
    )
    .run(userId, value);
  return findTaskById(info.lastInsertRowid);
}

function updateSoloTask(user, taskId, payload) {
  const row = getManagedTask(user, taskId);
  const { errors, value } = validateTaskPayload(payload);
  if (Object.keys(errors).length) throw httpError(400, '表单校验未通过', errors);

  getDb()
    .prepare(
      `UPDATE tasks
       SET category = @category, title = @title, description = @description, deadline = @deadline
       WHERE id = @id`
    )
    .run({ ...value, id: row.id });
  return findTaskById(row.id);
}

function updateSoloTaskStatus(user, taskId, status) {
  sweepOverdue();
  const row = getManagedTask(user, taskId);
  if (!USER_SETTABLE_STATUS.includes(status)) {
    throw httpError(400, '状态不合法（逾期由系统按截止时间自动判定）');
  }
  getDb().prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, row.id);
  return findTaskById(row.id);
}

/** 收集任务下所有打卡照片的相对路径（删除任务时清理磁盘文件用） */
function collectTaskPhotoPaths(taskId) {
  return getDb()
    .prepare('SELECT image_paths FROM checkins WHERE task_id = ?')
    .all(taskId)
    .flatMap((r) => {
      try {
        return JSON.parse(r.image_paths || '[]');
      } catch (_) {
        return [];
      }
    });
}

function deleteSoloTask(user, taskId) {
  const row = getManagedTask(user, taskId);
  const photos = collectTaskPhotoPaths(row.id);
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(row.id);
  removeStoredFiles(photos); // 打卡记录已级联删除，照片文件尽力而为清理（失败仅告警）
  return true;
}

/* ---------- Day 14：公共任务管理（供管理员后台调用） ---------- */

/** 公共任务列表（owner_id 为 NULL，全员可见可打卡），读取前先扫一遍逾期 */
function listPublicTasks() {
  sweepOverdue();
  return getDb()
    .prepare(
      `SELECT * FROM tasks
       WHERE type = 'solo' AND owner_id IS NULL
       ORDER BY id DESC`
    )
    .all();
}

/** 管理员发布公共任务：复用单人任务的校验与截止归一化，owner_id 固定 NULL */
function createPublicTask(payload) {
  const { errors, value } = validateTaskPayload(payload);
  if (Object.keys(errors).length) throw httpError(400, '表单校验未通过', errors);

  const info = getDb()
    .prepare(
      `INSERT INTO tasks (owner_id, type, category, title, description, deadline)
       VALUES (NULL, 'solo', @category, @title, @description, @deadline)`
    )
    .run(value);
  return findTaskById(info.lastInsertRowid);
}

/** 删除公共任务（其下打卡记录随外键级联删除，照片文件一并清理） */
function deletePublicTask(taskId) {
  const row = findTaskById(taskId);
  if (!row || row.type !== 'solo' || row.owner_id !== null) throw httpError(404, '公共任务不存在');
  const photos = collectTaskPhotoPaths(row.id);
  getDb().prepare('DELETE FROM tasks WHERE id = ?').run(row.id);
  removeStoredFiles(photos);
  return true;
}

module.exports = {
  listSoloTasks,
  createSoloTask,
  updateSoloTask,
  updateSoloTaskStatus,
  deleteSoloTask,
  listPublicTasks,
  createPublicTask,
  deletePublicTask,
  normalizeDeadline,
};
