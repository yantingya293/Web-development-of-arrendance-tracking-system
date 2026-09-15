/**
 * 全员打卡广场服务层（Day 12）
 *
 * 模块说明：
 *   listGallery(query)    全站打卡流（单人 + 双人合并，时间倒序，scope 筛选 + 分页）
 *   galleryStats()        广场统计（全站累计 / 今日打卡 / 今日参与人数）
 *
 * 策略约定（Day 12 拍板）：
 *   * 「全员成果查看」语义：展示全站所有用户的单人打卡与双人打卡，
 *     登录后可见（与 /history 一致），无需逐条授权——打卡本身即公开成果
 *   * 合并流用 UNION ALL 统一字段：kind（solo / duo）区分来源，
 *     双人打卡无逾期标记与任务分类，对应列置 NULL
 *   * 双人打卡记录在队伍解绑后仍保留在库（teams.status = unbound），
 *     作为历史成果继续在广场可见
 */
const { getDb } = require('../db/db');

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/** 两个打卡来源的统一视图（列名以第一个 SELECT 为准） */
const GALLERY_SOURCE_SQL = `
  SELECT c.id, 'solo' AS kind, c.submitted_at, c.note, c.image_paths, c.is_overdue,
         u.id AS user_id, u.nickname, t.title AS task_title, t.category AS task_category
  FROM checkins c
  JOIN users u ON u.id = c.user_id
  JOIN tasks t ON t.id = c.task_id
  UNION ALL
  SELECT dc.id, 'duo' AS kind, dc.submitted_at, dc.note, dc.image_paths, NULL AS is_overdue,
         u.id AS user_id, u.nickname, dt.title AS task_title, NULL AS task_category
  FROM duo_checkins dc
  JOIN users u ON u.id = dc.user_id
  JOIN duo_tasks dt ON dt.id = dc.duo_task_id
`;

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
 * 全站打卡流
 * @param {object} query { scope = 'solo' | 'duo'（可选，缺省全部）,
 *                          limit = 20（≤50）, offset = 0（≥0） }
 * @returns {{ checkins: Array, total: number }}  total 为符合筛选条件的总条数
 */
function listGallery(query = {}) {
  // 取整钳制：查询串里的 1.7 / 'abc' / 负数等一律归一到合法整数（LIMIT 非整数会 500）
  const limit = Math.min(Math.max(Math.trunc(Number(query.limit)) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Math.trunc(Number(query.offset)) || 0, 0);
  const scope = ['solo', 'duo'].includes(query.scope) ? query.scope : null;

  const where = scope ? 'WHERE kind = ?' : '';
  const params = scope ? [scope] : [];

  const db = getDb();
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM (${GALLERY_SOURCE_SQL}) ${where}`)
    .get(...params);
  const rows = db
    .prepare(
      `SELECT * FROM (${GALLERY_SOURCE_SQL}) ${where}
       ORDER BY submitted_at DESC, id DESC
       LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset);
  return { checkins: rows.map(withParsedImages), total };
}

/**
 * 广场统计：
 *   total        全站打卡总条数（单人 + 双人）
 *   today        今日打卡条数
 *   today_users  今日参与打卡的人数（去重）
 */
function galleryStats() {
  const db = getDb();
  const today = db
    .prepare("SELECT date('now', 'localtime') AS d")
    .get().d;

  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM (${GALLERY_SOURCE_SQL})`)
    .get();
  const { today: todayCount } = db
    .prepare(
      `SELECT COUNT(*) AS today FROM (${GALLERY_SOURCE_SQL})
       WHERE substr(submitted_at, 1, 10) = ?`
    )
    .get(today);
  const { today_users: todayUsers } = db
    .prepare(
      `SELECT COUNT(DISTINCT user_id) AS today_users FROM (${GALLERY_SOURCE_SQL})
       WHERE substr(submitted_at, 1, 10) = ?`
    )
    .get(today);

  return { total, today: todayCount, today_users: todayUsers };
}

module.exports = { listGallery, galleryStats };
