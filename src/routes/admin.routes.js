/**
 * 管理员后台路由（Day 14，全部需管理员）
 *
 * 模块说明：
 *   GET    /api/admin/overview           全站统计快照（用户 / 任务完成率 / 打卡 / 组队）
 *   GET    /api/admin/users              用户列表（q 搜索 + limit/offset 分页）
 *   GET    /api/admin/public-tasks       公共任务列表
 *   POST   /api/admin/public-tasks       发布公共任务（全员可见可打卡）
 *   DELETE /api/admin/public-tasks/:id   删除公共任务（连带其下打卡记录）
 *
 * 说明：单人与双人任务的日常 CRUD 仍走各自业务路由（/api/tasks、/api/duo-tasks），
 * 本路由只承载「仅管理员」的全站视角与公共任务管理。
 */
const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const adminService = require('../services/admin.service');
const taskService = require('../services/task.service');

const router = express.Router();
router.use(requireAdmin);

/** 服务层业务错误（带 status）原样返回，其余按 500 兜底 */
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

router.get('/overview', (req, res) => {
  try {
    res.json({ overview: adminService.overview() });
  } catch (err) {
    sendServiceError('admin/overview', res, err);
  }
});

router.get('/users', (req, res) => {
  try {
    const { q, limit, offset } = req.query || {};
    res.json(adminService.listUsers({ q, limit, offset }));
  } catch (err) {
    sendServiceError('admin/users', res, err);
  }
});

router.get('/public-tasks', (req, res) => {
  try {
    res.json({ tasks: taskService.listPublicTasks() });
  } catch (err) {
    sendServiceError('admin/public-tasks/list', res, err);
  }
});

router.post('/public-tasks', (req, res) => {
  try {
    const task = taskService.createPublicTask(req.body || {});
    res.status(201).json({ message: '公共任务已发布', task });
  } catch (err) {
    sendServiceError('admin/public-tasks/create', res, err);
  }
});

router.delete('/public-tasks/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ message: '任务 id 不合法' });
  try {
    taskService.deletePublicTask(id);
    res.json({ message: '公共任务已删除' });
  } catch (err) {
    sendServiceError('admin/public-tasks/delete', res, err);
  }
});

module.exports = router;
