/**
 * 双人共同任务服务层（Day 9）
 *
 * 模块说明：
 *   listDuoTasks(user)                当前队伍的共同任务（读取前自动标记逾期）
 *   createDuoTask(user, payload)      新建共同任务（校验 title / 分工 / 截止时间）
 *   updateDuoTask(user, taskId, payload)   整体更新（标题 / 说明 / 分工 / 截止时间）
 *   updateDuoTaskStatus(user, taskId, status)  状态流转（unstarted / in_progress / completed）
 *   deleteDuoTask(user, taskId)       删除共同任务（连带 duo_checkins 级联删除）
 *
 * 策略约定（Day 9 拍板）：
 *   * 共同任务属于一支队伍：必须处于 active 队伍才能创建 / 查看 / 管理；解绑后任务保留在
 *     库中（teams.status = unbound）但不再出现在任何人的列表里
 *   * 「共建」语义：队伍任一成员都可创建、编辑、流转状态与删除，无需对方确认
 *   * division_a / division_b 分别对应队伍 user_a / user_b 的分工（前端按搭档昵称标注），
 *     各 ≤ 100 字符，可留空
 *   * 状态机与单人任务一致：'overdue' 不可手动设置，读取时按截止时间自动标记（sweep）
 *   * 打卡入口在 Day 10 接入（duo_checkins，每人每天最多一次）
 */
const { getDb } = require('../db/db');
const { normalizeDeadline } = require('./task.service');

const USER_SETTABLE_STATUS = ['unstarted', 'in_progress', 'completed'];
const MAX_DIVISION_LEN = 100;

function httpError(status, message, errors) {
  const err = new Error(message);
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

/** 把过截止时间且未完成的共同任务标记为 overdue（幂等，每次读取前调用） */
function sweepDuoOverdue() {
  getDb()
    .prepare(
      `UPDATE duo_tasks
       SET status = 'overdue'
       WHERE deadline IS NOT NULL AND deadline != ''
         AND deadline < datetime('now', 'localtime')
         AND status IN ('unstarted', 'in_progress')`
    )
    .run();
}

/** 当前 active 队伍（无则抛 409，提示先组队） */
function getActiveTeamOrThrow(userId) {
  const team = getDb()
    .prepare("SELECT * FROM teams WHERE status = 'active' AND (user_a = ? OR user_b = ?)")
    .get(userId, userId);
  if (!team) throw httpError(409, '请先绑定学习搭档，再管理共同任务');
  return team;
}

function validateDuoTaskPayload(payload) {
  const errors = {};

  const title = String(payload.title || '').trim();
  if (!title) errors.title = '请填写任务标题';
  else if (title.length > 50) errors.title = '标题不能超过 50 个字符';

  const description = String(payload.description || '').trim();
  if (description.length > 500) errors.description = '说明不能超过 500 个字符';

  const divisionA = String(payload.division_a || '').trim();
  if (divisionA.length > MAX_DIVISION_LEN) errors.division_a = `分工不能超过 ${MAX_DIVISION_LEN} 个字符`;
  const divisionB = String(payload.division_b || '').trim();
  if (divisionB.length > MAX_DIVISION_LEN) errors.division_b = `分工不能超过 ${MAX_DIVISION_LEN} 个字符`;

  const deadline = normalizeDeadline(payload.deadline);
  if (deadline === 'invalid') errors.deadline = '截止时间格式不正确';

  return { errors, value: { title, description, division_a: divisionA, division_b: divisionB, deadline } };
}

function findDuoTaskById(id) {
  return getDb().prepare('SELECT * FROM duo_tasks WHERE id = ?').get(id);
}

/** 取本人 active 队伍下的共同任务（其它队伍的任务按不存在处理） */
function getTeamDuoTask(user, taskId) {
  const team = getActiveTeamOrThrow(user.id);
  const row = findDuoTaskById(taskId);
  if (!row || row.team_id !== team.id) throw httpError(404, '共同任务不存在');
  return { team, row };
}

/** 今日双方打卡进度（Day 10）：duo_task_id → 各成员今日打卡时间（null = 未打卡） */
function getTodayProgressMap(team) {
  const today = getDb()
    .prepare("SELECT date('now', 'localtime') AS d")
    .get().d;
  const rows = getDb()
    .prepare(
      `SELECT dc.duo_task_id, dc.user_id, substr(dc.submitted_at, 12, 5) AS at
       FROM duo_checkins dc JOIN duo_tasks dt ON dt.id = dc.duo_task_id
       WHERE dt.team_id = ? AND dc.day = ?`
    )
    .all(team.id, today);

  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.duo_task_id)) map.set(r.duo_task_id, { a: null, b: null });
    const slot = r.user_id === team.user_a ? 'a' : 'b';
    map.get(r.duo_task_id)[slot] = r.at;
  }
  return map;
}

/** 任务列表附带双方分工归属（前端渲染「谁的分工」用）与今日打卡进度 */
function decorateTasks(team, tasks) {
  const db = getDb();
  const userA = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(team.user_a);
  const userB = db.prepare('SELECT id, nickname FROM users WHERE id = ?').get(team.user_b);
  const progress = getTodayProgressMap(team);
  return tasks.map((t) => ({
    ...t,
    members: {
      a: { id: team.user_a, nickname: userA ? userA.nickname : '（已注销）', division: t.division_a },
      b: { id: team.user_b, nickname: userB ? userB.nickname : '（已注销）', division: t.division_b },
    },
    today: progress.get(t.id) || { a: null, b: null },
  }));
}

function listDuoTasks(user) {
  const team = getActiveTeamOrThrow(user.id);
  sweepDuoOverdue();
  const tasks = getDb()
    .prepare(
      `SELECT * FROM duo_tasks
       WHERE team_id = ?
       ORDER BY CASE status
                  WHEN 'in_progress' THEN 0
                  WHEN 'unstarted' THEN 1
                  WHEN 'overdue' THEN 2
                  ELSE 3
                END,
                deadline IS NULL,
                deadline,
                id DESC`
    )
    .all(team.id);
  return { team_id: team.id, tasks: decorateTasks(team, tasks) };
}

function createDuoTask(user, payload) {
  const team = getActiveTeamOrThrow(user.id);
  const { errors, value } = validateDuoTaskPayload(payload);
  if (Object.keys(errors).length) throw httpError(400, '表单校验未通过', errors);

  const info = getDb()
    .prepare(
      `INSERT INTO duo_tasks (team_id, title, description, deadline, division_a, division_b)
       VALUES (?, @title, @description, @deadline, @division_a, @division_b)`
    )
    .run(team.id, value);
  return decorateTasks(team, [findDuoTaskById(info.lastInsertRowid)])[0];
}

function updateDuoTask(user, taskId, payload) {
  const { team, row } = getTeamDuoTask(user, taskId);
  const { errors, value } = validateDuoTaskPayload(payload);
  if (Object.keys(errors).length) throw httpError(400, '表单校验未通过', errors);

  getDb()
    .prepare(
      `UPDATE duo_tasks
       SET title = @title, description = @description, deadline = @deadline,
           division_a = @division_a, division_b = @division_b
       WHERE id = @id`
    )
    .run({ ...value, id: row.id });
  return decorateTasks(team, [findDuoTaskById(row.id)])[0];
}

function updateDuoTaskStatus(user, taskId, status) {
  const { row } = getTeamDuoTask(user, taskId);
  sweepDuoOverdue();
  if (!USER_SETTABLE_STATUS.includes(status)) {
    throw httpError(400, '状态不合法（逾期由系统按截止时间自动判定）');
  }
  getDb().prepare('UPDATE duo_tasks SET status = ? WHERE id = ?').run(status, row.id);
  return findDuoTaskById(row.id);
}

function deleteDuoTask(user, taskId) {
  const { row } = getTeamDuoTask(user, taskId);
  getDb().prepare('DELETE FROM duo_tasks WHERE id = ?').run(row.id);
  return true;
}

module.exports = {
  listDuoTasks,
  createDuoTask,
  updateDuoTask,
  updateDuoTaskStatus,
  deleteDuoTask,
  getActiveTeamOrThrow,
};
