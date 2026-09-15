/**
 * 管理员后台服务层（Day 14）
 *
 * 模块说明：
 *   overview()                     全站统计快照（用户 / 任务完成率 / 打卡 / 组队）
 *   listUsers({ q, limit, offset }) 用户列表（含每人任务数、打卡数、是否在组队中），支持关键词搜索与分页
 *
 * 约定：
 *   * 完成任务率只统计各自口径的「已完成 / 总数」，无数据时返回 null（前端显示「—」）
 *   * 公共任务（owner_id IS NULL）不计入任何人的任务总数，单列一项
 *   * 组队人数取 active 队伍数 × 2（部分唯一索引保证一人最多一支 active 队伍）
 *   * 本层只读，公共任务的增删在 task.service（listPublicTasks / createPublicTask / deletePublicTask）
 */
const { getDb } = require('../db/db');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** 百分比：无分母返回 null，否则四舍五入取整 */
function rate(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

function overview() {
  const db = getDb();
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;
  const today = db.prepare("SELECT date('now', 'localtime') AS d").get().d;

  const users = count('SELECT COUNT(*) AS n FROM users');
  const admins = count("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
  const newUsersToday = count('SELECT COUNT(*) AS n FROM users WHERE date(created_at) = ?', today);

  // 用户自建单人任务（公共任务 owner_id 为 NULL，单独统计）
  const soloTotal = count('SELECT COUNT(*) AS n FROM tasks WHERE type = ? AND owner_id IS NOT NULL', 'solo');
  const soloDone = count(
    "SELECT COUNT(*) AS n FROM tasks WHERE type = 'solo' AND owner_id IS NOT NULL AND status = 'completed'"
  );
  const publicTotal = count("SELECT COUNT(*) AS n FROM tasks WHERE type = 'solo' AND owner_id IS NULL");

  const duoTotal = count('SELECT COUNT(*) AS n FROM duo_tasks');
  const duoDone = count("SELECT COUNT(*) AS n FROM duo_tasks WHERE status = 'completed'");

  const soloCheckins = count('SELECT COUNT(*) AS n FROM checkins');
  const duoCheckins = count('SELECT COUNT(*) AS n FROM duo_checkins');
  const checkinsToday =
    count('SELECT COUNT(*) AS n FROM checkins WHERE date(submitted_at) = ?', today) +
    count('SELECT COUNT(*) AS n FROM duo_checkins WHERE day = ?', today);

  const activeTeams = count("SELECT COUNT(*) AS n FROM teams WHERE status = 'active'");

  return {
    users: {
      total: users,
      admins,
      normal: users - admins,
      new_today: newUsersToday,
      bound: activeTeams * 2, // 在组队中的用户数（一人最多一支 active 队伍）
    },
    tasks: {
      solo_total: soloTotal,
      solo_completed: soloDone,
      solo_completion_rate: rate(soloDone, soloTotal),
      public_total: publicTotal,
    },
    duo_tasks: {
      total: duoTotal,
      completed: duoDone,
      completion_rate: rate(duoDone, duoTotal),
    },
    checkins: {
      solo: soloCheckins,
      duo: duoCheckins,
      total: soloCheckins + duoCheckins,
      today: checkinsToday,
    },
    teams: { active: activeTeams },
  };
}

/**
 * 用户列表（管理员视角）：昵称 / 账号 / 角色 / 头像 / 注册时间，
 * 附带自建任务数、单人打卡数、双人打卡数与是否在组队中。
 * q 同时在昵称与账号上做模糊匹配；按 id 升序稳定分页。
 */
function listUsers({ q, limit, offset } = {}) {
  const db = getDb();
  const lim = Math.min(Math.max(Number(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const off = Math.max(Number(offset) || 0, 0);
  const kw = String(q == null ? '' : q).trim();

  const whereSql = kw ? 'WHERE (u.nickname LIKE ? OR u.account LIKE ?)' : '';
  const whereArgs = kw ? [`%${kw}%`, `%${kw}%`] : [];

  const total = db.prepare(`SELECT COUNT(*) AS n FROM users u ${whereSql}`).get(...whereArgs).n;

  const rows = db
    .prepare(
      `SELECT u.id, u.nickname, u.account, u.role, u.avatar_path, u.created_at,
              (SELECT COUNT(*) FROM tasks t WHERE t.owner_id = u.id)            AS task_count,
              (SELECT COUNT(*) FROM checkins c WHERE c.user_id = u.id)          AS solo_checkin_count,
              (SELECT COUNT(*) FROM duo_checkins dc WHERE dc.user_id = u.id)    AS duo_checkin_count,
              EXISTS(SELECT 1 FROM teams tm
                     WHERE tm.status = 'active' AND (tm.user_a = u.id OR tm.user_b = u.id)) AS in_team
       FROM users u ${whereSql}
       ORDER BY u.id ASC
       LIMIT ? OFFSET ?`
    )
    .all(...whereArgs, lim, off)
    .map((r) => ({ ...r, in_team: !!r.in_team, total_checkins: r.solo_checkin_count + r.duo_checkin_count }));

  return { users: rows, total, limit: lim, offset: off, keyword: kw };
}

module.exports = { overview, listUsers };
