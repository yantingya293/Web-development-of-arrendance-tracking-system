/**
 * 单人打卡服务层（Day 6）
 *
 * 模块说明：
 *   createSoloCheckin(user, payload)   提交单人打卡（校验任务可见性 / 照片 / 备注，写 checkins）
 *   listMyCheckins(userId, query)      当前用户的打卡记录（关联任务标题，供表单标记与 Day 7 历史复用）
 *   myCheckinStats(userId)             打卡统计（Day 7）：累计 / 今日 / 连续天数 / 近 7 天每日次数
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
 * 照片相对路径校验（Day 10 抽出供双人打卡复用）
 * @param {string[]} photos multer 落盘后的相对路径数组
 * @returns {string|null} 错误提示；null = 通过
 */
function validatePhotoPaths(photos) {
  if (photos.length < 1) return '请至少上传 1 张照片作为打卡凭证';
  if (photos.length > MAX_PHOTOS) return `照片最多 ${MAX_PHOTOS} 张`;
  const bad = photos.some(
    (p) => typeof p !== 'string' || !/^uploads\/[A-Za-z0-9-]+\.(jpg|png)$/.test(p)
  );
  return bad ? '照片路径不合法' : null;
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
  const photoError = validatePhotoPaths(photos);
  if (photoError) throw httpError(400, '表单校验未通过', { photos: photoError });

  const task = getDb().prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  // 他人任务按不存在处理；双人任务（type=duo）在 Day 8–10 另有打卡入口
  if (!task || task.type !== 'solo' || (task.owner_id !== null && task.owner_id !== user.id)) {
    throw httpError(404, '任务不存在或不可打卡');
  }

  // 逾期判定与当日判定：提交时间晚于任务截止时间（数据库与 schema 同步使用服务器本地时间）
  const t = getDb()
    .prepare("SELECT datetime('now', 'localtime') AS now, date('now', 'localtime') AS day")
    .get();
  const now = t.now;
  const day = t.day;
  const isOverdue = task.deadline && task.deadline !== '' && task.deadline < now ? 1 : 0;

  const insert = getDb().transaction(() => {
    // Day 21：每日一次约束（对齐双人打卡口径），友好提示在前、唯一索引兜底并发
    const dup = getDb()
      .prepare('SELECT id FROM checkins WHERE user_id = ? AND task_id = ? AND day = ?')
      .get(user.id, task.id, day);
    if (dup) {
      throw httpError(409, '今天已对该任务打卡，明天再来吧', { taskId: '今天已打卡' });
    }

    const info = getDb()
      .prepare(
        `INSERT INTO checkins (user_id, task_id, task_type, image_paths, note, is_overdue, day)
         VALUES (?, ?, 'solo', ?, ?, ?, ?)`
      )
      .run(user.id, task.id, JSON.stringify(photos), note, isOverdue, day);

    // 未开始的任务打卡后自动进入进行中（打卡 ≠ 完成，完成由用户显式标记）。
    // 状态副作用仅限任务主人（个人任务）/ 管理员（公共任务）：普通用户打卡公共任务
    // 只写入打卡记录，不得改变全员可见的任务状态（Day 15 安全加固）。
    const mayTransition =
      task.owner_id === null ? user.role === 'admin' : task.owner_id === user.id;
    if (mayTransition && task.status === 'unstarted') {
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
 * 我的打卡记录（单人，Day 7 增加筛选与总数）
 * @param {number} userId 当前用户
 * @param {object} query  { limit = 20（≤50）, offset = 0（≥0）,
 *                          category = 任务分类（daily / weekly / question，可选）,
 *                          date = 'YYYY-MM-DD'（可选，只看某天） }
 * @returns {{ checkins: Array, total: number }}  total 为符合筛选条件的总条数（供「加载更多」判断）
 */
function listMyCheckins(userId, query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(query.offset) || 0, 0);

  const where = ['c.user_id = ?', "c.task_type = 'solo'"];
  const params = [userId];
  if (['daily', 'weekly', 'question'].includes(query.category)) {
    where.push('t.category = ?');
    params.push(query.category);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '').trim())) {
    where.push("substr(c.submitted_at, 1, 10) = ?");
    params.push(String(query.date).trim());
  }
  const whereSql = where.join(' AND ');

  const db = getDb();
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM checkins c JOIN tasks t ON t.id = c.task_id WHERE ${whereSql}`)
    .get(...params);

  const rows = db
    .prepare(
      `SELECT c.*, t.title AS task_title, t.category AS task_category, t.deadline AS task_deadline
       FROM checkins c JOIN tasks t ON t.id = c.task_id
       WHERE ${whereSql}
       ORDER BY c.submitted_at DESC, c.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  return { checkins: rows.map(withParsedImages), total };
}

/**
 * 打卡统计（Day 7，仅单人打卡）
 *   total   累计打卡次数
 *   today   今日打卡次数
 *   streak  连续打卡天数（按自然日聚合；今天还没打卡时从昨天往前数，保持激励语义）
 *   last7   近 7 天逐日次数（旧 → 新，无记录的天补 0，供热度条渲染）
 */
function myCheckinStats(userId) {
  const db = getDb();
  const days = db
    .prepare(
      `SELECT substr(submitted_at, 1, 10) AS day, COUNT(*) AS n
       FROM checkins
       WHERE user_id = ? AND task_type = 'solo'
       GROUP BY day
       ORDER BY day DESC`
    )
    .all(userId);

  const now = db.prepare("SELECT datetime('now', 'localtime') AS now").get().now;
  const today = now.slice(0, 10);
  const dayMs = 24 * 60 * 60 * 1000;
  const shift = (day, n) => {
    const d = new Date(day + 'T00:00:00');
    d.setTime(d.getTime() - n * dayMs);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  const countByDay = Object.fromEntries(days.map((d) => [d.day, d.n]));
  const total = days.reduce((sum, d) => sum + d.n, 0);
  const todayCount = countByDay[today] || 0;

  // 连续天数：从今天（若已打卡）或昨天起往前数有记录的天
  let streak = 0;
  let cursor = todayCount > 0 ? today : shift(today, 1);
  while (countByDay[cursor] > 0) {
    streak++;
    cursor = shift(cursor, 1);
  }

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const day = shift(today, i);
    last7.push({ day, count: countByDay[day] || 0 });
  }

  return { total, today: todayCount, streak, last7 };
}

module.exports = {
  createSoloCheckin,
  listMyCheckins,
  myCheckinStats,
  validatePhotoPaths,
  MAX_PHOTOS,
  MAX_NOTE_LEN,
};
