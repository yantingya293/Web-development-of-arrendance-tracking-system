/**
 * 双人共同任务路由（Day 9）
 *
 * 模块说明（全部需登录）：
 *   GET    /api/duo-tasks               当前队伍的共同任务（需 active 队伍，读取前自动标记逾期）
 *   POST   /api/duo-tasks               新建共同任务（队伍任一成员可建）
 *   PUT    /api/duo-tasks/:id           更新任务（标题 / 说明 / 分工 / 截止时间）
 *   PATCH  /api/duo-tasks/:id/status    状态流转（开始 / 完成 / 重新打开）
 *   DELETE /api/duo-tasks/:id           删除任务（连带打卡记录级联删除）
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const duoTaskService = require('../services/duoTask.service');

const router = express.Router();
router.use(requireAuth);

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
    res.json(duoTaskService.listDuoTasks(req.user));
  } catch (err) {
    sendServiceError('duoTasks/list', res, err);
  }
});

router.post('/', (req, res) => {
  try {
    const task = duoTaskService.createDuoTask(req.user, req.body || {});
    res.status(201).json({ message: '共同任务已创建', task });
  } catch (err) {
    sendServiceError('duoTasks/create', res, err);
  }
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '任务 id 不合法' });
  try {
    const task = duoTaskService.updateDuoTask(req.user, id, req.body || {});
    res.json({ message: '任务已更新', task });
  } catch (err) {
    sendServiceError('duoTasks/update', res, err);
  }
});

router.patch('/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '任务 id 不合法' });
  try {
    const task = duoTaskService.updateDuoTaskStatus(req.user, id, String((req.body || {}).status || ''));
    res.json({ message: '任务状态已更新', task });
  } catch (err) {
    sendServiceError('duoTasks/status', res, err);
  }
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '任务 id 不合法' });
  try {
    duoTaskService.deleteDuoTask(req.user, id);
    res.json({ message: '任务已删除' });
  } catch (err) {
    sendServiceError('duoTasks/delete', res, err);
  }
});

module.exports = router;
