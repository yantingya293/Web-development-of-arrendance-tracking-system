/**
 * 个人数据统计服务层（Day 13）
 *
 * 模块说明：
 *   myDashboard(userId, query)  个人中心数据看板（任务完成率 / 分类分布 / 月度打卡日历）
 *
 * 口径约定（Day 13 拍板）：
 *   * 任务统计只算「自己的单人任务」（owner_id = 本人）：公共任务由管理员发布、
 *     普通用户只读，不算个人完成率；双人任务属于队伍，在 /duo 协作数据里统计
 *   * 打卡日历合并单人打卡（checkins.submitted_at 前 10 位）与双人打卡
 *     （duo_checkins.day，服务层写入时即业务日期），反映「我」的学习全貌
 *   * completion_rate 为整数百分比，无任务时为 null（前端显示引导文案）
 */
const { getDb } = require('../db/db');

function myDashboard(userId, query = {}) {
  const db = getDb();

  let month = String(query.month || '');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    month = db.prepare("SELECT strftime('%Y-%m', 'now', 'localtime') AS m").get().m;
  }

  // ---- 任务：状态分布 + 分类分布（仅自己的单人任务） ----
  const rows = db
    .prepare(
      `SELECT status, category, COUNT(*) AS n
       FROM tasks
       WHERE type = 'solo' AND owner_id = ?
       GROUP BY status, category`
    )
    .all(userId);

  const tasks = {
    total: 0,
    unstarted: 0,
    in_progress: 0,
    completed: 0,
    overdue: 0,
    by_category: { daily: 0, weekly: 0, question: 0 },
  };
  for (const r of rows) {
    tasks.total += r.n;
    if (r.status in tasks) tasks[r.status] += r.n;
    if (r.category in tasks.by_category) tasks.by_category[r.category] += r.n;
  }
  tasks.completion_rate = tasks.total ? Math.round((tasks.completed / tasks.total) * 100) : null;

  // ---- 打卡累计（单人 / 双人分开，供日历标题与速览） ----
  const soloTotal = db
    .prepare("SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND task_type = 'solo'")
    .get(userId).n;
  const duoTotal = db
    .prepare('SELECT COUNT(*) AS n FROM duo_checkins WHERE user_id = ?')
    .get(userId).n;

  // ---- 月度打卡日历（单人 + 双人按日合并） ----
  const soloDays = db
    .prepare(
      `SELECT substr(submitted_at, 1, 10) AS day, COUNT(*) AS n
       FROM checkins
       WHERE user_id = ? AND substr(submitted_at, 1, 7) = ?
       GROUP BY day`
    )
    .all(userId, month);
  const duoDays = db
    .prepare(
      `SELECT day, COUNT(*) AS n
       FROM duo_checkins
       WHERE user_id = ? AND substr(day, 1, 7) = ?
       GROUP BY day`
    )
    .all(userId, month);

  const days = {};
  let monthTotal = 0;
  for (const r of [...soloDays, ...duoDays]) {
    days[r.day] = (days[r.day] || 0) + r.n;
    monthTotal += r.n;
  }
  const activeDays = Object.keys(days).filter((d) => days[d] > 0).length;

  return {
    month,
    tasks,
    checkins: { solo_total: soloTotal, duo_total: duoTotal },
    calendar: { days, month_total: monthTotal, active_days: activeDays },
  };
}

module.exports = { myDashboard };
