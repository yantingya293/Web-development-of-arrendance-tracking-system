/**
 * 双人组队路由（Day 8）
 *
 * 模块说明（全部需登录）：
 *   GET    /api/team                     组队全貌（当前队伍 / 收到的邀请 / 发出的邀请）
 *   POST   /api/team/invites             按账号发出组队邀请 { account }
 *   POST   /api/team/invites/:id/accept  接受邀请（建队，返回最新组队全貌）
 *   POST   /api/team/invites/:id/decline 拒绝邀请
 *   DELETE /api/team                     解除绑定（双方任意一人可发起，搭档收到站内通知）
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const teamService = require('../services/team.service');

const router = express.Router();
router.use(requireAuth);

/** 服务层业务错误（带 status）原样返回，其余 500 兜底 */
function sendServiceError(prefix, res, err) {
  if (err.status) {
    return res.status(err.status).json({ message: err.message, errors: err.errors });
  }
  console.error(`[${prefix}]`, err);
  res.status(500).json({ message: '服务器开小差了，请稍后再试' });
}

function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', (req, res) => {
  try {
    res.json(teamService.getTeamView(req.user.id));
  } catch (err) {
    sendServiceError('team/view', res, err);
  }
});

router.post('/invites', (req, res) => {
  try {
    const result = teamService.createInvite(req.user, (req.body || {}).account);
    res.status(201).json({ message: `邀请已发给 ${result.to.nickname}，等待对方处理` });
  } catch (err) {
    sendServiceError('team/invite', res, err);
  }
});

router.post('/invites/:id/accept', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '邀请 id 不合法' });
  try {
    const view = teamService.respondInvite(req.user, id, true);
    res.json({ message: '组队成功，开始你们的共同任务吧！', ...view });
  } catch (err) {
    sendServiceError('team/accept', res, err);
  }
});

router.post('/invites/:id/decline', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '邀请 id 不合法' });
  try {
    teamService.respondInvite(req.user, id, false);
    res.json({ message: '已拒绝邀请' });
  } catch (err) {
    sendServiceError('team/decline', res, err);
  }
});

router.delete('/', (req, res) => {
  try {
    teamService.unbindTeam(req.user);
    res.json({ message: '已解除绑定，历史共同任务已归档' });
  } catch (err) {
    sendServiceError('team/unbind', res, err);
  }
});

module.exports = router;
