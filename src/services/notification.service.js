/**
 * 站内通知服务层（Day 8 建立）
 *
 * 模块说明：
 *   createNotification(userId, type, payload)  写一条通知（payload 对象 JSON 序列化存储）
 *   listMyNotifications(userId, limit)         我的最新通知（旧 → 新返回，payload 已解析）
 *   markAllRead(userId)                        我的全部未读通知标记已读
 *   markReadById(userId, id)                   指定通知标记已读（组队邀请处理时使用）
 *
 * 类型约定（type）：
 *   invite          双人组队邀请（payload: { fromId, fromNickname, fromAccount }）
 *   team_unbound    搭档解绑通知（payload: { nickname }）
 *   partner_checkin 搭档完成双人打卡（Day 10 使用，payload: { taskId, taskTitle, nickname }）
 */
const { getDb } = require('../db/db');

const KNOWN_TYPES = ['invite', 'team_unbound', 'partner_checkin'];

function createNotification(userId, type, payload) {
  const info = getDb()
    .prepare('INSERT INTO notifications (user_id, type, payload) VALUES (?, ?, ?)')
    .run(userId, type, JSON.stringify(payload || {}));
  return info.lastInsertRowid;
}

/** payload JSON 字符串 → 对象，供接口返回 */
function withParsedPayload(row) {
  if (!row) return row;
  let payload = {};
  try {
    payload = JSON.parse(row.payload || '{}');
  } catch (_) {
    payload = {};
  }
  return { ...row, payload };
}

function listMyNotifications(userId, limit = 10) {
  // 取整钳制：非整数（如 1.9）进 LIMIT 会让 SQLite 报错
  const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 10, 1), 50);
  const rows = getDb()
    .prepare(
      `SELECT * FROM notifications
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(userId, lim);
  return rows.map(withParsedPayload);
}

function markAllRead(userId) {
  const now = getDb().prepare("SELECT datetime('now', 'localtime') AS now").get().now;
  const info = getDb()
    .prepare("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL")
    .run(now, userId);
  return info.changes;
}

function markReadById(userId, id) {
  const now = getDb().prepare("SELECT datetime('now', 'localtime') AS now").get().now;
  const info = getDb()
    .prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL')
    .run(now, id, userId);
  return info.changes > 0;
}

module.exports = { createNotification, listMyNotifications, markAllRead, markReadById, KNOWN_TYPES };
