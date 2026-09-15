/**
 * 双人组队服务层（Day 8）
 *
 * 模块说明：
 *   getTeamView(userId)             组队全貌：当前队伍 + 收到的待处理邀请 + 我发出的待处理邀请
 *   createInvite(user, account)     按账号向对方发出组队邀请（存 notifications，type = invite）
 *   respondInvite(user, inviteId, accept)  接受 / 拒绝收到的邀请（接受即建队）
 *   unbindTeam(user)                解除当前绑定（双方任意一人都可发起）
 *
 * 策略约定（Day 8 拍板）：
 *   * 一个用户同一时刻最多一支 active 队伍（teams 部分唯一索引兜底，应用层先校验给友好提示）
 *   * 邀请走站内通知（notifications，type = invite，未读 = 待处理）：同一时刻每人只能有一 个
 *     待处理的发出邀请；对方接受后，发给本人的其余待处理邀请自动过期
 *   * 接受邀请时二次校验双方均未组队（并发兜底），任一方已组队则邀请过期作废
 *   * 解绑只改 teams.status = unbound（保留历史）；该队伍的共同任务保留在库中但不再展示，
 *     新的共同任务需重新组队后创建
 */
const { getDb } = require('../db/db');
const { createNotification, markReadById } = require('./notification.service');

function httpError(status, message, errors) {
  const err = new Error(message);
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

function nowLocal() {
  return getDb().prepare("SELECT datetime('now', 'localtime') AS now").get().now;
}

/** 用户当前所在的 active 队伍（无则 null） */
function getActiveTeamForUser(userId) {
  return getDb()
    .prepare("SELECT * FROM teams WHERE status = 'active' AND (user_a = ? OR user_b = ?)")
    .get(userId, userId);
}

/** 我收到的待处理组队邀请（notifications，type = invite 且未读） */
function listMyInvites(userId) {
  return getDb()
    .prepare(
      `SELECT n.id, n.created_at,
              json_extract(n.payload, '$.fromId')    AS from_id,
              json_extract(n.payload, '$.fromNickname') AS from_nickname,
              json_extract(n.payload, '$.fromAccount')  AS from_account,
              fu.avatar_path                            AS from_avatar_path
       FROM notifications n
       LEFT JOIN users fu ON fu.id = json_extract(n.payload, '$.fromId')
       WHERE n.user_id = ? AND n.type = 'invite' AND n.read_at IS NULL
       ORDER BY n.created_at DESC, n.id DESC`
    )
    .all(userId);
}

/** 我发出的待处理邀请（至多一条，见策略约定） */
function getMyOutgoingInvite(userId) {
  return getDb()
    .prepare(
      `SELECT n.id, n.created_at,
              u.id AS to_id, u.nickname AS to_nickname, u.account AS to_account,
              u.avatar_path AS to_avatar_path
       FROM notifications n JOIN users u ON u.id = n.user_id
       WHERE n.type = 'invite' AND n.read_at IS NULL
         AND json_extract(n.payload, '$.fromId') = ?
       ORDER BY n.created_at DESC, n.id DESC
       LIMIT 1`
    )
    .get(userId);
}

/** 队伍 + 搭档信息（供前端展示；partner 永远指向对方） */
function buildTeamView(row, meId) {
  if (!row) return null;
  const partnerId = row.user_a === meId ? row.user_b : row.user_a;
  const partner = getDb()
    .prepare('SELECT id, nickname, account, avatar_path FROM users WHERE id = ?')
    .get(partnerId);
  return {
    id: row.id,
    bound_at: row.bound_at,
    me_is_user_a: row.user_a === meId,
    partner: partner || { id: partnerId, nickname: '（用户已注销）', account: '-', avatar_path: null },
  };
}

function getTeamView(userId) {
  const teamRow = getActiveTeamForUser(userId);
  return {
    team: buildTeamView(teamRow, userId),
    invites: listMyInvites(userId),
    outgoing: getMyOutgoingInvite(userId),
  };
}

function createInvite(user, account) {
  const acc = String(account || '').trim();
  if (!acc) throw httpError(400, '请填写对方账号', { account: '请填写对方账号' });

  const target = getDb().prepare('SELECT * FROM users WHERE account = ?').get(acc);
  if (!target) throw httpError(404, '该账号不存在', { account: '该账号不存在' });
  if (target.id === user.id) throw httpError(400, '不能邀请自己组队', { account: '不能邀请自己' });
  if (getActiveTeamForUser(user.id)) throw httpError(409, '你已绑定搭档，请先解绑后再邀请');
  if (getActiveTeamForUser(target.id)) throw httpError(409, '对方已绑定搭档');

  const outgoing = getMyOutgoingInvite(user.id);
  if (outgoing) {
    throw httpError(409, `你已向 ${outgoing.to_nickname} 发出邀请，请等待对方处理或先处理收到的邀请`);
  }

  // 对方先邀请了我：引导去处理，避免双向邀请死锁
  const fromThem = listMyInvites(user.id).some((inv) => inv.from_id === target.id);
  if (fromThem) throw httpError(409, '对方已向你发出邀请，请在「收到的邀请」中处理');

  createNotification(target.id, 'invite', {
    fromId: user.id,
    fromNickname: user.nickname,
    fromAccount: user.account,
  });
  return { to: { id: target.id, nickname: target.nickname, account: target.account } };
}

function respondInvite(user, inviteId, accept) {
  const db = getDb();
  // 注意：作废标记必须随事务提交生效。不能在事务内 throw——异常会回滚刚写入的
  // markReadById，导致「已声明作废」的邀请仍占着邀请人的唯一发出名额、且仍可被接受。
  // 故失败路径在事务内标记 + 返回错误描述，事务提交后再抛出。
  const run = db.transaction(() => {
    const row = db
      .prepare(
        `SELECT * FROM notifications
         WHERE id = ? AND user_id = ? AND type = 'invite' AND read_at IS NULL`
      )
      .get(inviteId, user.id);
    if (!row) return { error: [404, '邀请不存在或已处理'] };

    let payload = {};
    try {
      payload = JSON.parse(row.payload || '{}');
    } catch (_) { /* 空兜底 */ }

    if (!accept) {
      markReadById(user.id, inviteId);
      return { declined: true };
    }

    // 接受前二次校验：双方都未组队、邀请人仍存在（并发与过期兜底）；不成立则作废该邀请
    if (getActiveTeamForUser(user.id)) {
      markReadById(user.id, inviteId);
      return { error: [409, '你已绑定搭档，该邀请已作废'] };
    }
    const fromUser = payload.fromId
      ? db.prepare('SELECT * FROM users WHERE id = ?').get(payload.fromId)
      : null;
    if (!fromUser || getActiveTeamForUser(fromUser.id)) {
      markReadById(user.id, inviteId);
      return { error: [409, '对方已绑定搭档或账号已注销，该邀请已作废'] };
    }

    const info = db
      .prepare('INSERT INTO teams (user_a, user_b) VALUES (?, ?)')
      .run(fromUser.id, user.id);
    markReadById(user.id, inviteId);
    // 我已组队：发给我的其余待处理邀请一并过期（邀请人侧因「单发出邀请」约束无需处理）
    db.prepare(
      "UPDATE notifications SET read_at = ? WHERE user_id = ? AND type = 'invite' AND read_at IS NULL AND id != ?"
    ).run(nowLocal(), user.id, inviteId);
    return { teamId: info.lastInsertRowid };
  });

  const result = run();
  if (result.error) throw httpError(result.error[0], result.error[1]);
  return result.declined ? { declined: true } : getTeamView(user.id);
}

function unbindTeam(user) {
  const row = getActiveTeamForUser(user.id);
  if (!row) throw httpError(404, '当前没有绑定的搭档');

  const partnerId = row.user_a === user.id ? row.user_b : row.user_a;
  getDb()
    .prepare("UPDATE teams SET status = 'unbound', unbound_at = ? WHERE id = ? AND status = 'active'")
    .run(nowLocal(), row.id);
  createNotification(partnerId, 'team_unbound', { nickname: user.nickname });

  return { partnerId };
}

module.exports = { getTeamView, createInvite, respondInvite, unbindTeam, getActiveTeamForUser };
