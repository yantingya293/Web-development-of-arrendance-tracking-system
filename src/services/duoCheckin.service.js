/**
 * 双人打卡服务层（Day 10；Day 11 增协作统计）
 *
 * 模块说明：
 *   createDuoCheckin(user, payload)    提交双人打卡（校验队伍 / 任务 / 照片 / 备注，写 duo_checkins）
 *   listDuoCheckins(user, query)       当前队伍的双人打卡记录（双方可见，可按任务筛选）
 *   duoStats(user)                     队伍协作统计（任务分布 / 双方累计 / 今日 / 连续天数 / 近 7 天）
 *
 * 策略约定（Day 10 拍板）：
 *   * 与单人打卡的差异：同一成员对同一共同任务每天最多打卡一次
 *     （duo_checkins 唯一索引兜底，应用层先查给出友好提示）
 *   * 可打卡任务：本人 active 队伍的共同任务（未完成的；overdue 可补打卡）；
 *     其它队伍的任务按「不存在」处理（404）
 *   * 照片 / 备注规则与单人打卡一致（1–3 张 JPG / PNG，备注 ≤ 500 字符，复用校验）
 *   * 打卡不自动完成任务：unstarted 打卡后转 in_progress，完成由成员显式标记
 *   * 每次打卡向搭档发站内通知（type = partner_checkin），供协作动态展示
 *   * 「双方都打卡」不触发任务自动完成——进度可视化在 Day 11 增强
 */
const { getDb } = require('../db/db');
const { validatePhotoPaths, MAX_NOTE_LEN } = require('./checkin.service');
const { getActiveTeamOrThrow } = require('./duoTask.service');
const { createNotification } = require('./notification.service');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function httpError(status, message, errors) {
  const err = new Error(message);
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

function nowLocal() {
  return getDb().prepare("SELECT datetime('now', 'localtime') AS now").get().now;
}

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
 * 校验并提交双人打卡
 * @param {object} user    req.user（requireAuth 装载）
 * @param {object} payload { duoTaskId, note, photos: ['uploads/xxx.jpg', ...] }
 */
function createDuoCheckin(user, payload) {
  const duoTaskId = Number(payload.duoTaskId);
  if (!Number.isInteger(duoTaskId) || duoTaskId <= 0) {
    throw httpError(400, '请选择要打卡的共同任务', { duoTaskId: '请选择要打卡的共同任务' });
  }

  const note = String(payload.note || '').trim();
  if (note.length > MAX_NOTE_LEN) {
    throw httpError(400, '表单校验未通过', { note: `备注不能超过 ${MAX_NOTE_LEN} 个字符` });
  }

  const photos = Array.isArray(payload.photos) ? payload.photos : [];
  const photoError = validatePhotoPaths(photos);
  if (photoError) throw httpError(400, '表单校验未通过', { photos: photoError });

  const team = getActiveTeamOrThrow(user.id); // 无队伍 → 409 请先绑定搭档
  const task = getDb().prepare('SELECT * FROM duo_tasks WHERE id = ?').get(duoTaskId);
  // 其它队伍的任务按不存在处理；已完成 / 已删除的任务不可打卡
  if (!task || task.team_id !== team.id) {
    throw httpError(404, '共同任务不存在或不可打卡');
  }
  if (task.status === 'completed') {
    throw httpError(400, '任务已完成，无需再打卡', { duoTaskId: '任务已完成，无需再打卡' });
  }

  // 每日一次（应用层预检；并发兜底靠唯一索引 idx_duo_checkins_daily）
  const today = nowLocal().slice(0, 10);
  const dup = getDb()
    .prepare('SELECT id FROM duo_checkins WHERE duo_task_id = ? AND user_id = ? AND day = ?')
    .get(task.id, user.id, today);
  if (dup) {
    throw httpError(409, '今天已对该任务打卡，明天再来吧', { duoTaskId: '今天已打卡' });
  }

  const partnerId = team.user_a === user.id ? team.user_b : team.user_a;

  const insert = getDb().transaction(() => {
    const info = getDb()
      .prepare(
        `INSERT INTO duo_checkins (duo_task_id, user_id, image_paths, note, day)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(task.id, user.id, JSON.stringify(photos), note, today);

    // 未开始的任务打卡后自动进入进行中（完成由成员显式标记）
    if (task.status === 'unstarted') {
      getDb().prepare(`UPDATE duo_tasks SET status = 'in_progress' WHERE id = ?`).run(task.id);
    }

    // 搭档收到打卡通知（协作动态展示）
    createNotification(partnerId, 'partner_checkin', {
      taskId: task.id,
      taskTitle: task.title,
      nickname: user.nickname,
    });
    return info.lastInsertRowid;
  });

  const row = getDb()
    .prepare(
      `SELECT dc.*, dt.title AS task_title, u.nickname AS user_nickname
       FROM duo_checkins dc
       JOIN duo_tasks dt ON dt.id = dc.duo_task_id
       JOIN users u ON u.id = dc.user_id
       WHERE dc.id = ?`
    )
    .get(insert());
  return withParsedImages(row);
}

/**
 * 当前队伍的双人打卡记录（双方打卡都可见）
 * @param {object} query { taskId = 按共同任务筛选（可选）, limit = 20（≤50）, offset = 0（≥0） }
 */
function listDuoCheckins(user, query = {}) {
  const team = getActiveTeamOrThrow(user.id);
  const limit = Math.min(Math.max(Number(query.limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const taskId = Number(query.taskId);

  const where = ['dt.team_id = ?'];
  const params = [team.id];
  if (Number.isInteger(taskId) && taskId > 0) {
    where.push('dc.duo_task_id = ?');
    params.push(taskId);
  }
  const whereSql = where.join(' AND ');

  const db = getDb();
  const { total } = db
    .prepare(
      `SELECT COUNT(*) AS total
       FROM duo_checkins dc JOIN duo_tasks dt ON dt.id = dc.duo_task_id
       WHERE ${whereSql}`
    )
    .get(...params);

  const rows = db
    .prepare(
      `SELECT dc.*, dt.title AS task_title, u.nickname AS user_nickname
       FROM duo_checkins dc
       JOIN duo_tasks dt ON dt.id = dc.duo_task_id
       JOIN users u ON u.id = dc.user_id
       WHERE ${whereSql}
       ORDER BY dc.submitted_at DESC, dc.id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  return { checkins: rows.map(withParsedImages), total };
}

/**
 * 队伍协作统计（Day 11，供 /duo「协作数据」板块；无 active 队伍时 409）
 *   tasks    共同任务状态分布（total / unstarted / in_progress / completed / overdue）
 *   checkins 双人打卡累计（total，me / partner 为相对当前用户的视角）
 *   today    今日双方打卡次数与 both（双方是否都已打卡）
 *   streak   连续协作天数：双方同一天都打过卡的连续自然日；今天未双双完成时
 *            从昨天起算（与单人连续打卡口径一致，保持激励语义）
 *   last7    近 7 天逐日双方打卡次数（旧 → 新，供对比柱状图渲染）
 */
function duoStats(user) {
  const team = getActiveTeamOrThrow(user.id);
  const db = getDb();

  const tasks = { total: 0, unstarted: 0, in_progress: 0, completed: 0, overdue: 0 };
  for (const row of db
    .prepare('SELECT status, COUNT(*) AS n FROM duo_tasks WHERE team_id = ? GROUP BY status')
    .all(team.id)) {
    tasks.total += row.n;
    if (row.status in tasks) tasks[row.status] = row.n;
  }

  // 按天 × 成员聚合双人打卡（day 列即打卡业务日期，见 schema）
  const dayRows = db
    .prepare(
      `SELECT dc.day, dc.user_id, COUNT(*) AS n
       FROM duo_checkins dc JOIN duo_tasks dt ON dt.id = dc.duo_task_id
       WHERE dt.team_id = ?
       GROUP BY dc.day, dc.user_id`
    )
    .all(team.id);

  const byDay = new Map(); // day -> { me, partner }
  let total = 0;
  let mine = 0;
  let partners = 0;
  for (const r of dayRows) {
    const slot = r.user_id === user.id ? 'me' : 'partner';
    if (!byDay.has(r.day)) byDay.set(r.day, { me: 0, partner: 0 });
    byDay.get(r.day)[slot] += r.n;
    total += r.n;
    if (slot === 'me') mine += r.n;
    else partners += r.n;
  }

  const today = nowLocal().slice(0, 10);
  const todayRow = byDay.get(today) || { me: 0, partner: 0 };

  const dayMs = 24 * 60 * 60 * 1000;
  const shift = (day, n) => {
    const d = new Date(day + 'T00:00:00');
    d.setTime(d.getTime() - n * dayMs);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  let streak = 0;
  let cursor = todayRow.me > 0 && todayRow.partner > 0 ? today : shift(today, 1);
  while (true) {
    const row = byDay.get(cursor);
    if (!row || row.me === 0 || row.partner === 0) break;
    streak++;
    cursor = shift(cursor, 1);
  }

  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const day = shift(today, i);
    const row = byDay.get(day) || { me: 0, partner: 0 };
    last7.push({ day, me: row.me, partner: row.partner });
  }

  return {
    team_id: team.id,
    tasks,
    checkins: { total, me: mine, partner: partners },
    today: { me: todayRow.me, partner: todayRow.partner, both: todayRow.me > 0 && todayRow.partner > 0 },
    streak,
    last7,
  };
}

module.exports = { createDuoCheckin, listDuoCheckins, duoStats };
