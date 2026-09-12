/**
 * 双人打卡服务层（Day 10）
 *
 * 模块说明：
 *   createDuoCheckin(user, payload)    提交双人打卡（校验队伍 / 任务 / 照片 / 备注，写 duo_checkins）
 *   listDuoCheckins(user, query)       当前队伍的双人打卡记录（双方可见，可按任务筛选）
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

module.exports = { createDuoCheckin, listDuoCheckins };
