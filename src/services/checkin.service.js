/**
 * 单人打卡服务层（Day 6）
 *
 * 模块说明：
 *   createSoloCheckin(user, payload)   提交单人打卡（校验任务可见性 / 照片 / 备注，写 checkins）
 *   listMyCheckins(userId, query)      当前用户的打卡记录（关联任务标题，供表单标记与 Day 7 历史复用）
 *
 * 策略约定（Day 6 拍板）：
 *   * 打卡 = 任务 + 照片凭证 + 备注：至少 1 张、最多 3 张照片，备注 ≤ 500 字符
 *   * 可打卡任务：自己的单人任务 + 公共任务（owner_id 为 NULL）；他人任务一律按
 *     「不存在」返回（404），不泄露任务是否存在
 *   * is_overdue 由服务端按任务截止时间与提交时间判定（提交晚于截止 = 1），
 *     不接受客户端传入；逾期仍可补打卡（记录里带逾期标记）
 *   * 打卡不强制完成任务的闭环判定：未开始（unstarted）的任务打卡后自动转为
 *     进行中（in_progress），已完成 / 已逾期的任务打卡不改变状态
 *   * 同一任务同一天允许多次打卡（记录学习过程）；表单以「今日已打卡」提示，
 *     每日一次的强约束只作用于双人打卡（duo_checkins 唯一索引，Day 10）
 */
const { getDb } = require('../db/db');

const MAX_PHOTOS = 3;
const MAX_NOTE_LEN = 500;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function httpError(status, message, errors) {
  const err = new Error(message);
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

/** image_paths 列 JSON 字符串 → 数组，供接口返回 */
function withParsedImages(row) {
  if (!row) return row;
  let images = [];
  try {
    images = JSON.parse(row.image_paths || '[]');
  } catch (_) {
    images = [];
  }
  return { ...row, image_paths: images };
}

/**
 * 校验并提交打卡
 * @param {object} user    req.user（requireAuth 装载）
 * @param {object} payload { taskId, note, photos: ['uploads/xxx.jpg', ...] }（photos 由路由层 multer 落盘后的相对路径）
 */
function createSoloCheckin(user, payload) {
  const taskId = Number(payload.taskId);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    throw httpError(400, '请选择要打卡的任务', { taskId: '请选择要打卡的任务' });
  }

  const note = String(payload.note || '').trim();
  if (note.length > MAX_NOTE_LEN) {
    throw httpError(400, '表单校验未通过', { note: `备注不能超过 ${MAX_NOTE_LEN} 个字符` });
  }

  const photos = Array.isArray(payload.photos) ? payload.photos : [];
  const photoError =
    photos.length < 1
      ? '请至少上传 1 张照片作为打卡凭证'
      : photos.length > MAX_PHOTOS
        ? `照片最多 ${MAX_PHOTOS} 张`
        : photos.some((p) => typeof p !== 'string' || !/^uploads\/[A-Za-z0-9-]+\.(jpg|png)$/.test(p))
          ? '照片路径不合法'
          : null;
  if (photoError) throw httpError(400, '表单校验未通过', { photos: photoError });

  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  // 他人任务按不存在处理；双人任务（type=duo）在 Day 8–10 另有打卡入口
  if (!task || task.type !== 'solo' || (task.owner_id !== null && task.owner_id !== user.id)) {
    throw httpError(404, '任务不存在或不可打卡');
  }

  // 逾期判定：提交时间晚于任务截止时间（数据库与 schema 同步使用服务器本地时间）
  const now = getDb().prepare("SELECT datetime('now', 'localtime') AS now").get().now;
  const isOverdue = task.deadline && task.deadline !== '' && task.deadline < now ? 1 : 0;

  const insert = getDb().transaction(() => {
    const info = getDb()
      .prepare(
        `INSERT INTO checkins (user_id, task_id, task_type, image_paths, note, is_overdue)
         VALUES (?, ?, 'solo', ?, ?, ?)`
      )
      .run(user.id, task.id, JSON.stringify(photos), note, isOverdue);

    // 未开始的任务打卡后自动进入进行中（打卡 ≠ 完成，完成由用户显式标记）
    if (task.status === 'unstarted') {
      getDb().prepare(`UPDATE tasks SET status = 'in_progress' WHERE id = ?`).run(task.id);
    }
    return info.lastInsertRowid;
  });

  const row = getDb()
    .prepare(
      `SELECT c.*, t.title AS task_title, t.category AS task_category, t.deadline AS task_deadline
       FROM checkins c JOIN tasks t ON t.id = c.task_id
       WHERE c.id = ?`
    )
    .get(insert());
  return withParsedImages(row);
}

/**
 * 我的打卡记录（单人）
 * @param {number} userId 当前用户
 * @param {object} query  { limit = 20（≤50）, offset = 0（≥0） }
 */
function listMyCheckins(userId, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const rows = getDb()
    .prepare(
      `SELECT c.*, t.title AS task_title, t.category AS task_category, t.deadline AS task_deadline
       FROM checkins c JOIN tasks t ON t.id = c.task_id
       WHERE c.user_id = ? AND c.task_type = 'solo'
       ORDER BY c.submitted_at DESC, c.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(userId, limit, offset);
  return rows.map(withParsedImages);
}

module.exports = { createSoloCheckin, listMyCheckins, MAX_PHOTOS, MAX_NOTE_LEN };
