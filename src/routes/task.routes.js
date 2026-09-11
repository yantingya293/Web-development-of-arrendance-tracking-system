/**
 * 单人任务路由（Day 5）
 *
 * 模块说明（全部需登录）：
 *   GET    /api/tasks               我的单人任务 + 公共任务
 *   POST   /api/tasks               新建单人任务
 *   PUT    /api/tasks/:id           更新任务内容（标题 / 说明 / 分类 / 截止时间）
 *   PATCH  /api/tasks/:id/status    状态流转（开始 / 完成 / 重新打开）
 *   DELETE /api/tasks/:id           删除任务
 *
 * 说明：双人任务（duo_tasks）在 Day 8–9 另立路由，本模块只管单人闭环。
 */
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const taskService = require('../services/task.service');

const router = express.Router();
router.use(requireAuth);

/** 服务层抛出的业务错误（带 status）原样返回，其余按 500 兜底 */
function sendServiceError(prefix, res, err) {
  if (err.status) {
    return res.status(err.status).json({ message: err.message, errors: err.errors });
  }
  console.error(`[${prefix}]`, err);
  res.status(500).json({ message: '服务器开小差了，请稍后再试' });
}

/** 解析 :id 为正整数，非法返回 null */
function parseId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get('/', (req, res) => {
  try {
    res.json({ tasks: taskService.listSoloTasks(req.user.id) });
  } catch (err) {
    sendServiceError('tasks/list', res, err);
  }
});

router.post('/', (req, res) => {
  try {
    const task = taskService.createSoloTask(req.user.id, req.body || {});
    res.status(201).json({ message: '任务已创建', task });
  } catch (err) {
    sendServiceError('tasks/create', res, err);
  }
});

router.put('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '任务 id 不合法' });
  try {
    const task = taskService.updateSoloTask(req.user, id, req.body || {});
    res.json({ message: '任务已更新', task });
  } catch (err) {
    sendServiceError('tasks/update', res, err);
  }
});

router.patch('/:id/status', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '任务 id 不合法' });
  try {
    const task = taskService.updateSoloTaskStatus(req.user, id, String((req.body || {}).status || ''));
    res.json({ message: '任务状态已更新', task });
  } catch (err) {
    sendServiceError('tasks/status', res, err);
  }
});

router.delete('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '任务 id 不合法' });
  try {
    taskService.deleteSoloTask(req.user, id);
    res.json({ message: '任务已删除' });
  } catch (err) {
    sendServiceError('tasks/delete', res, err);
  }
});

module.exports = router;
