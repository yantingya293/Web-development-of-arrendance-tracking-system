/**
 * dbCheck.js —— 验收脚本：确认所有表可读写、约束生效、种子数据可见
 *
 * Day 2：建库 / 约束 / 种子数据（13 项）
 * Day 5：单人任务服务层（创建归一化 / 校验 / 状态流转 / 越权 / 逾期标记 / 可见性，7 项）
 * Day 6：单人打卡服务层（写入联动 / 校验 / 越权 / 逾期判定 / 公共任务 / 列表，6 项）
 * Day 7：打卡历史筛选 + 统计（2 项）
 * Day 8：双人组队服务层（邀请校验 / 单发出约束 / 接受建队 / 解绑，4 项）
 * Day 9：双人共同任务服务层（创建装饰 / 状态与逾期，2 项）
 * Day 10：双人打卡服务层（打卡联动通知 / 每日一次 / 双方进度 / 完成拦截，4 项）
 * Day 11：双人协作统计（任务分布 / 双方累计 / 连续天数 / 解绑后 409，2 项）
 * Day 12：全员打卡广场（合并流 / 倒序 / scope 筛选 / 统计，2 项）
 * Day 13：个人数据看板（任务分布与完成率 / 月度日历合并聚合，2 项）
 * Day 14：个人资料（昵称校验与更新 / 头像路径写入与清除，2 项）
 *          管理员后台（概览统计口径 / 用户搜索分页 / 公共任务 CRUD，3 项）
 * 安全加固：改密与会话作废 / 上传魔数校验（3 项，检查器支持 async）
 * Day 15：安全加固（公共任务状态收权 / 回跳消毒 / 注册同形等时 / 删除清理照片×2 / 分页取整，6 项）
 *
 * 运行：node dbCheck.js
 * 说明：探针写入全部包在一个事务里并在结束时 ROLLBACK，不会污染数据文件
 *       （Day 15 照片清理探针会真实创建/删除临时文件，但文件名以 __dbcheck_ 开头且用后即清）。
 */
const { initDb, getDb } = require('./src/db/db');
const { seedIfEmpty } = require('./src/db/seed');
const fs = require('fs');
const path = require('path');

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (err) {
    results.push({ name, ok: false, err });
  }
}

/** 断言 fn 抛出 SQLite 约束错误（唯一索引 / CHECK / 外键） */
function expectConstraint(fn) {
  try {
    fn();
  } catch (err) {
    if (String(err.code || '').startsWith('SQLITE_CONSTRAINT')) return;
    throw err;
  }
  throw new Error('预期应触发约束错误，但写入成功了');
}

async function main() {
  initDb();
  const seeded = seedIfEmpty();
  const db = getDb();
  const now = new Date().toISOString();

  console.log(`数据库文件: ${require('./src/db/db').DB_PATH}`);
  console.log(`种子数据: ${seeded ? '本次写入' : '已存在，跳过'}\n`);

  db.exec('BEGIN IMMEDIATE'); // 探针事务，结束时统一回滚
  try {
    // --- users：写入 + 读回 ---
    await check('users 建表 + 写入/读回', () => {
      db.prepare(
        `INSERT INTO users (nickname, account, password_hash, role) VALUES (?, ?, ?, ?)`
      ).run('测试用户A', '__dbcheck_a__', 'hash_a', 'user');
      const row = db
        .prepare(`SELECT * FROM users WHERE account = ?`)
        .get('__dbcheck_a__');
      if (!row || row.nickname !== '测试用户A' || row.role !== 'user')
        throw new Error('读回内容不一致');
    });

    let userAId, userBId;
    await check('users 账号唯一约束', () => {
      expectConstraint(() =>
        db
          .prepare(`INSERT INTO users (nickname, account, password_hash) VALUES (?, ?, ?)`)
          .run('重复账号', '__dbcheck_a__', 'x')
      );
    });

    // --- tasks：公共任务写入 + CHECK 约束 ---
    let taskId;
    await check('tasks 写入/读回（owner_id=NULL 公共任务）', () => {
      const info = db
        .prepare(
          `INSERT INTO tasks (owner_id, type, title, description, deadline, status)
           VALUES (NULL, 'solo', '探针任务', 'dbCheck 临时数据', NULL, 'unstarted')`
        )
        .run();
      taskId = info.lastInsertRowid;
      const row = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(taskId);
      if (!row || row.title !== '探针任务' || row.owner_id !== null)
        throw new Error('读回内容不一致');
    });
    await check('tasks status CHECK 约束', () => {
      expectConstraint(() =>
        db
          .prepare(`INSERT INTO tasks (title, status) VALUES ('坏状态', 'paused')`)
          .run()
      );
    });

    // --- checkins：个人打卡 ---
    await check('checkins 写入/读回', () => {
      userAId = db.prepare(`SELECT id FROM users WHERE account = ?`).get('__dbcheck_a__').id;
      const info = db
        .prepare(
          `INSERT INTO checkins (user_id, task_id, task_type, image_paths, note, is_overdue)
           VALUES (?, ?, 'solo', ?, '探针打卡', 0)`
        )
        .run(userAId, taskId, JSON.stringify(['uploads/probe.jpg']));
      const row = db.prepare(`SELECT * FROM checkins WHERE id = ?`).get(info.lastInsertRowid);
      const paths = JSON.parse(row.image_paths);
      if (paths[0] !== 'uploads/probe.jpg' || row.is_overdue !== 0)
        throw new Error('读回内容不一致');
    });

    // --- teams：组队 + 同一用户仅一支 active 队伍 ---
    let teamId;
    await check('teams 写入/读回', () => {
      db.prepare(
        `INSERT INTO users (nickname, account, password_hash) VALUES (?, ?, ?)`
      ).run('测试用户B', '__dbcheck_b__', 'hash_b');
      userBId = db.prepare(`SELECT id FROM users WHERE account = ?`).get('__dbcheck_b__').id;
      teamId = db
        .prepare(`INSERT INTO teams (user_a, user_b) VALUES (?, ?)`)
        .run(userAId, userBId).lastInsertRowid;
      const row = db.prepare(`SELECT * FROM teams WHERE id = ?`).get(teamId);
      if (row.status !== 'active' || !row.bound_at) throw new Error('默认字段异常');
    });
    await check('teams 唯一组队约束（user_a 同时仅一支 active 队伍）', () => {
      expectConstraint(() =>
        db.prepare(`INSERT INTO teams (user_a, user_b) VALUES (?, ?)`).run(userAId, userBId)
      );
    });

    // --- duo_tasks：共同任务 ---
    let duoTaskId;
    await check('duo_tasks 写入/读回', () => {
      duoTaskId = db
        .prepare(
          `INSERT INTO duo_tasks (team_id, title, division_a, division_b, deadline)
           VALUES (?, '探针共同任务', 'A 负责搜集资料', 'B 负责整理成稿', ?)`
        )
        .run(teamId, now).lastInsertRowid;
      const row = db.prepare(`SELECT * FROM duo_tasks WHERE id = ?`).get(duoTaskId);
      if (row.division_a !== 'A 负责搜集资料' || row.status !== 'unstarted')
        throw new Error('读回内容不一致');
    });

    // --- duo_checkins：双人打卡 + 每日一次唯一索引 ---
    await check('duo_checkins 写入/读回', () => {
      db.prepare(
        `INSERT INTO duo_checkins (duo_task_id, user_id, image_paths, note) VALUES (?, ?, '[]', '探针A打卡')`
      ).run(duoTaskId, userAId);
      const row = db
        .prepare(`SELECT * FROM duo_checkins WHERE duo_task_id = ? AND user_id = ?`)
        .get(duoTaskId, userAId);
      if (!row || !row.day) throw new Error('day 字段未自动生成');
    });
    await check('duo_checkins 每日一次约束（同任务同人同日唯一）', () => {
      expectConstraint(() =>
        db
          .prepare(`INSERT INTO duo_checkins (duo_task_id, user_id, day) VALUES (?, ?, date('now','localtime'))`)
          .run(duoTaskId, userAId)
      );
    });

    // --- notifications：站内通知 ---
    await check('notifications 写入/读回', () => {
      const info = db
        .prepare(
          `INSERT INTO notifications (user_id, type, payload) VALUES (?, 'duo_reminder', ?)`
        )
        .run(userBId, JSON.stringify({ duoTaskId, title: '探针共同任务' }));
      const row = db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(info.lastInsertRowid);
      if (JSON.parse(row.payload).duoTaskId !== Number(duoTaskId) || row.read_at !== null)
        throw new Error('读回内容不一致');
    });

    // --- 外键级联 ---
    await check('外键级联删除（删队伍连带删共同任务）', () => {
      db.prepare(`DELETE FROM teams WHERE id = ?`).run(teamId);
      const left = db.prepare(`SELECT COUNT(*) AS n FROM duo_tasks WHERE team_id = ?`).get(teamId).n;
      if (left !== 0) throw new Error('duo_tasks 未随 teams 级联删除');
    });

    // --- Day 5：单人任务服务（service 层与探针共用同一连接，写入随事务回滚） ---
    const taskService = require('./src/services/task.service');
    let day5TaskId;
    await check('task.service 创建单人任务（datetime-local 格式归一化）', () => {
      const task = taskService.createSoloTask(userAId, {
        title: '探针：每日背 50 个单词',
        description: '',
        category: 'daily',
        deadline: '2099-01-02T08:30', // 前端 datetime-local 格式 → '2099-01-02 08:30:00'
      });
      day5TaskId = task.id;
      if (
        task.type !== 'solo' ||
        task.category !== 'daily' ||
        task.deadline !== '2099-01-02 08:30:00'
      )
        throw new Error('创建结果不一致: ' + JSON.stringify(task));
    });
    await check('tasks category CHECK 约束（非法分类拒绝）', () => {
      expectConstraint(() =>
        db.prepare(`INSERT INTO tasks (title, category) VALUES ('坏分类', 'monthly')`).run()
      );
    });
    await check('task.service 表单校验（空标题 / 非法分类 / 非法时间）', () => {
      let caught;
      try {
        taskService.createSoloTask(userAId, { title: '   ', category: 'bad', deadline: '2026-13-99' });
      } catch (err) {
        caught = err;
      }
      if (!caught || caught.status !== 400) throw new Error('未按预期抛出 400');
      const e = caught.errors || {};
      if (!e.title || !e.category || !e.deadline) throw new Error('错误字段缺失: ' + JSON.stringify(e));
    });
    await check('task.service 状态流转 + overdue 不可手动设置', () => {
      const t = taskService.updateSoloTaskStatus({ id: userAId, role: 'user' }, day5TaskId, 'in_progress');
      if (t.status !== 'in_progress') throw new Error('状态未更新');
      let caught;
      try {
        taskService.updateSoloTaskStatus({ id: userAId, role: 'user' }, day5TaskId, 'overdue');
      } catch (err) {
        caught = err;
      }
      if (!caught || caught.status !== 400) throw new Error('overdue 应由系统自动判定，不允许手动设置');
    });
    await check('task.service 越权防护（他人任务不可删）', () => {
      let caught;
      try {
        taskService.deleteSoloTask({ id: userBId, role: 'user' }, day5TaskId);
      } catch (err) {
        caught = err;
      }
      if (!caught || caught.status !== 403) throw new Error('未按预期抛出 403');
    });
    await check('task.service 过期任务自动标记 overdue', () => {
      const past = taskService.createSoloTask(userAId, {
        title: '探针：昨天的任务',
        category: 'weekly',
        deadline: '2000-01-01 00:00:00',
      });
      const row = taskService.listSoloTasks(userAId).find((t) => t.id === past.id);
      if (!row || row.status !== 'overdue') throw new Error('过期任务未被标记 overdue');
    });
    await check('task.service 列表可见性（自己的 + 公共，他人不可见）', () => {
      const mine = taskService.listSoloTasks(userAId);
      if (!mine.some((t) => t.id === day5TaskId)) throw new Error('自己的任务不可见');
      if (!mine.some((t) => t.owner_id === null)) throw new Error('公共任务不可见');
      const others = taskService.listSoloTasks(userBId);
      if (others.some((t) => t.id === day5TaskId)) throw new Error('他人任务不应可见');
    });

    // --- Day 6：单人打卡服务（服务层只写库不碰文件，photos 传相对路径即可随事务回滚） ---
    const checkinService = require('./src/services/checkin.service');
    const userA = { id: userAId, role: 'user' };
    const userB = { id: userBId, role: 'user' };
    let day6TaskId, day6OverdueTaskId, publicTaskId;
    await check('checkin.service 提交打卡（照片 JSON 落库 + unstarted 自动转 in_progress）', () => {
      const t = taskService.createSoloTask(userAId, {
        title: '探针：今天背单词',
        category: 'daily',
        deadline: '2099-01-01 00:00:00',
      });
      day6TaskId = t.id;
      const c = checkinService.createSoloCheckin(userA, {
        taskId: t.id,
        note: '打卡一次',
        photos: ['uploads/dbcheck-a1.jpg', 'uploads/dbcheck-a2.jpg'],
      });
      if (
        c.task_type !== 'solo' ||
        c.is_overdue !== 0 ||
        JSON.stringify(c.image_paths) !== JSON.stringify(['uploads/dbcheck-a1.jpg', 'uploads/dbcheck-a2.jpg'])
      )
        throw new Error('打卡记录不一致: ' + JSON.stringify(c));
      const after = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(t.id);
      if (after.status !== 'in_progress') throw new Error('未开始任务打卡后应转为 in_progress');
    });
    await check('checkin.service 表单校验（缺照片 / 备注超长）', () => {
      let caught;
      try {
        checkinService.createSoloCheckin(userA, { taskId: day6TaskId, note: '', photos: [] });
      } catch (err) {
        caught = err;
      }
      if (!caught || caught.status !== 400 || !caught.errors.photos) throw new Error('缺照片未按预期抛 400');
      let caught2;
      try {
        checkinService.createSoloCheckin(userA, { taskId: day6TaskId, note: 'x'.repeat(501), photos: ['uploads/a.jpg'] });
      } catch (err) {
        caught2 = err;
      }
      if (!caught2 || caught2.status !== 400 || !caught2.errors.note) throw new Error('备注超长未按预期抛 400');
    });
    await check('checkin.service 越权防护（他人任务按不存在处理）', () => {
      let caught;
      try {
        checkinService.createSoloCheckin(userB, {
          taskId: day6TaskId,
          note: '',
          photos: ['uploads/b.jpg'],
        });
      } catch (err) {
        caught = err;
      }
      if (!caught || caught.status !== 404) throw new Error('他人任务打卡应返回 404');
    });
    await check('checkin.service 逾期判定（过截止任务打卡 is_overdue = 1）', () => {
      const t = taskService.createSoloTask(userAId, {
        title: '探针：过期补打卡',
        category: 'weekly',
        deadline: '2000-01-01 00:00:00',
      });
      day6OverdueTaskId = t.id;
      const c = checkinService.createSoloCheckin(userA, {
        taskId: t.id,
        note: '补打卡',
        photos: ['uploads/dbcheck-late.jpg'],
      });
      if (c.is_overdue !== 1) throw new Error('过截止打卡未被标记 is_overdue');
    });
    await check('checkin.service 公共任务全员可打卡', () => {
      publicTaskId = db
        .prepare(`INSERT INTO tasks (owner_id, type, title) VALUES (NULL, 'solo', '探针：公共打卡任务')`)
        .run().lastInsertRowid;
      const c = checkinService.createSoloCheckin(userB, {
        taskId: publicTaskId,
        note: '普通用户打卡公共任务',
        photos: ['uploads/dbcheck-pub.jpg'],
      });
      if (c.task_title !== '探针：公共打卡任务' || c.task_category !== 'daily')
        throw new Error('公共任务打卡关联字段缺失');
    });
    await check('checkin.service listMyCheckins（按时间倒序 + 关联任务标题 + limit 生效）', () => {
      const list = checkinService.listMyCheckins(userAId, {}).checkins;
      if (list.length < 2) throw new Error('打卡记录数量异常');
      if (list[0].submitted_at < list[list.length - 1].submitted_at) throw new Error('未按时间倒序');
      if (!list.every((c) => c.task_title && Array.isArray(c.image_paths))) throw new Error('关联字段缺失');
      const one = checkinService.listMyCheckins(userAId, { limit: 1 });
      if (one.checkins.length !== 1 || one.total < 2) throw new Error('limit / total 未生效');
    });

    // --- Day 7：打卡历史筛选 + 统计 ---
    await check('checkin.service 历史筛选（category 生效 + total 一致）', () => {
      const all = checkinService.listMyCheckins(userAId, {});
      const weeklyOnly = checkinService.listMyCheckins(userAId, { category: 'weekly' });
      const catIds = new Set(
        db.prepare(`SELECT id FROM tasks WHERE category = 'weekly'`).all().map((r) => r.id)
      );
      const expect = all.checkins.filter((c) => catIds.has(c.task_id)).length;
      if (weeklyOnly.total !== expect) throw new Error(`weekly 筛选总数不一致: ${weeklyOnly.total} != ${expect}`);
      if (!weeklyOnly.checkins.every((c) => catIds.has(c.task_id))) throw new Error('weekly 筛选混入其它分类');
    });
    await check('checkin.service myCheckinStats（累计 / 今日 / 近 7 天）', () => {
      const stats = checkinService.myCheckinStats(userAId);
      const n = db
        .prepare(`SELECT COUNT(*) AS n FROM checkins WHERE user_id = ? AND task_type = 'solo'`)
        .get(userAId).n;
      if (stats.total !== n) throw new Error(`累计次数不一致: ${stats.total} != ${n}`);
      if (stats.today < 1) throw new Error('今日打卡未计入');
      if (stats.last7.length !== 7) throw new Error('近 7 天数组长度应为 7');
    });

    // --- Day 8：双人组队服务（探针用户账号见上方 users 段） ---
    const teamService = require('./src/services/team.service');
    const userARow = db.prepare(`SELECT nickname, account FROM users WHERE id = ?`).get(userAId);
    const userBRow = db.prepare(`SELECT nickname, account FROM users WHERE id = ?`).get(userBId);
    const userAFull = { id: userAId, role: 'user', nickname: userARow.nickname, account: userARow.account };
    const userBFull = { id: userBId, role: 'user', nickname: userBRow.nickname, account: userBRow.account };
    let inviteId;
    await check('team.service 邀请校验（自己 / 不存在账号）', () => {
      let self, missing;
      try {
        teamService.createInvite(userAFull, userARow.account);
      } catch (err) {
        self = err;
      }
      try {
        teamService.createInvite(userAFull, '__no_such_user__');
      } catch (err) {
        missing = err;
      }
      if (!self || self.status !== 400) throw new Error('邀请自己应返回 400');
      if (!missing || missing.status !== 404) throw new Error('不存在账号应返回 404');
    });
    await check('team.service 发出邀请 + 单发出邀请约束', () => {
      const r = teamService.createInvite(userAFull, userBRow.account);
      if (r.to.id !== userBId) throw new Error('邀请目标不一致');
      const row = db
        .prepare(`SELECT * FROM notifications WHERE user_id = ? AND type = 'invite' AND read_at IS NULL`)
        .get(userBId);
      if (!row) throw new Error('邀请未写入 notifications');
      inviteId = row.id;
      let dup;
      try {
        teamService.createInvite(userAFull, userBRow.account);
      } catch (err) {
        dup = err;
      }
      if (!dup || dup.status !== 409) throw new Error('重复发出邀请应返回 409');
    });
    await check('team.service 接受邀请建队 + 组队全貌', () => {
      const view = teamService.respondInvite(userBFull, inviteId, true);
      if (!view.team || view.team.partner.id !== userAId) throw new Error('B 视角搭档应为 A');
      const viewA = teamService.getTeamView(userAId);
      if (!viewA.team || viewA.team.partner.id !== userBId) throw new Error('A 视角搭档应为 B');
    });

    // --- Day 9：双人共同任务服务 ---
    const duoTaskService = require('./src/services/duoTask.service');
    let duoTaskId2;
    await check('duoTask.service 创建 + 列表（分工归属装饰 + 今日进度）', () => {
      const t = duoTaskService.createDuoTask(userAFull, {
        title: '探针：一起刷题',
        division_a: 'A 刷选择题',
        division_b: 'B 刷大题',
        deadline: '2099-06-01',
      });
      duoTaskId2 = t.id;
      if (t.deadline !== '2099-06-01 23:59:59') throw new Error('截止时间归一化失败');
      const { tasks } = duoTaskService.listDuoTasks(userBFull); // 任一成员可建可看
      const mine = tasks.find((x) => x.id === duoTaskId2);
      if (!mine || mine.members.a.nickname !== userARow.nickname || mine.members.b.division !== 'B 刷大题')
        throw new Error('列表装饰字段缺失');
      if (mine.today.a !== null || mine.today.b !== null) throw new Error('初始今日进度应为空');
    });
    await check('duoTask.service 状态流转 + 逾期自动标记', () => {
      const t = duoTaskService.updateDuoTaskStatus(userBFull, duoTaskId2, 'in_progress');
      if (t.status !== 'in_progress') throw new Error('任一成员应可流转状态');
      const past = duoTaskService.createDuoTask(userAFull, { title: '探针：过期的共同任务', deadline: '2000-01-01' });
      const swept = duoTaskService.listDuoTasks(userAFull).tasks.find((x) => x.id === past.id);
      if (!swept || swept.status !== 'overdue') throw new Error('过期共同任务未被标记 overdue');
    });

    // --- Day 10：双人打卡服务 ---
    const duoCheckinService = require('./src/services/duoCheckin.service');
    await check('duoCheckin.service 打卡（unstarted 转进行中 + 搭档通知）', () => {
      const notifBefore = db
        .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'partner_checkin'`)
        .get(userBId).n;
      const c = duoCheckinService.createDuoCheckin(userAFull, {
        duoTaskId: duoTaskId2,
        note: 'A 今天完成',
        photos: ['uploads/dbcheck-duo-a.jpg'],
      });
      if (c.task_title !== '探针：一起刷题' || c.user_nickname !== userARow.nickname)
        throw new Error('打卡关联字段缺失');
      const notifAfter = db
        .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND type = 'partner_checkin'`)
        .get(userBId).n;
      if (notifAfter !== notifBefore + 1) throw new Error('搭档未收到打卡通知');
      const status = db.prepare(`SELECT status FROM duo_tasks WHERE id = ?`).get(duoTaskId2).status;
      if (status !== 'in_progress') throw new Error('打卡后任务应处于进行中');
    });
    await check('duoCheckin.service 每日一次（同日重复 409）', () => {
      let caught;
      try {
        duoCheckinService.createDuoCheckin(userAFull, {
          duoTaskId: duoTaskId2,
          photos: ['uploads/dbcheck-duo-a2.jpg'],
        });
      } catch (err) {
        caught = err;
      }
      if (!caught || caught.status !== 409) throw new Error('同日重复打卡应返回 409');
    });
    await check('duoCheckin.service 双方进度 + 记录列表（双方可见）', () => {
      duoCheckinService.createDuoCheckin(userBFull, {
        duoTaskId: duoTaskId2,
        photos: ['uploads/dbcheck-duo-b.jpg'],
      });
      const t = duoTaskService.listDuoTasks(userAFull).tasks.find((x) => x.id === duoTaskId2);
      if (!t.today.a || !t.today.b) throw new Error('双方今日进度未更新: ' + JSON.stringify(t.today));
      const list = duoCheckinService.listDuoCheckins(userBFull, { taskId: duoTaskId2 });
      if (list.total !== 2) throw new Error(`队伍打卡记录应为 2 条，实际 ${list.total}`);
      const mine = duoCheckinService.listDuoCheckins(userAFull, { taskId: duoTaskId2 });
      if (mine.total !== 2) throw new Error('打卡记录应对队伍双方可见');
    });
    await check('duoCheckin.service 完成的任务不可打卡', () => {
      const fresh = duoTaskService.createDuoTask(userAFull, { title: '探针：已完成任务' });
      duoTaskService.updateDuoTaskStatus(userAFull, fresh.id, 'completed');
      let caught;
      try {
        duoCheckinService.createDuoCheckin(userBFull, {
          duoTaskId: fresh.id,
          photos: ['uploads/dbcheck-duo-done.jpg'],
        });
      } catch (err) {
        caught = err;
      }
      if (!caught || caught.status !== 400 || !/已完成/.test(caught.message))
        throw new Error('已完成任务打卡未被拦截: ' + JSON.stringify(caught && caught.message));
    });

    // --- Day 11：双人协作统计（此时队伍 active，双方今日各打卡 1 次；任务 3 个：进行中 1 / 逾期 1 / 已完成 1） ---
    await check('duoCheckin.service duoStats（任务分布 / 双方累计 / 今日 / 连续天数）', () => {
      const s = duoCheckinService.duoStats(userAFull);
      if (s.tasks.total !== 3 || s.tasks.in_progress !== 1 || s.tasks.overdue !== 1 || s.tasks.completed !== 1)
        throw new Error('任务分布不一致: ' + JSON.stringify(s.tasks));
      if (s.checkins.total !== 2 || s.checkins.me !== 1 || s.checkins.partner !== 1)
        throw new Error('双方累计不一致: ' + JSON.stringify(s.checkins));
      if (s.today.me !== 1 || s.today.partner !== 1 || s.today.both !== true)
        throw new Error('今日进度不一致: ' + JSON.stringify(s.today));
      if (s.streak !== 1) throw new Error('双方今日均打卡时连续协作应为 1，实际 ' + s.streak);
      if (s.last7.length !== 7 || s.last7[6].me !== 1 || s.last7[6].partner !== 1)
        throw new Error('近 7 天数组或今日数据不一致');
    });

    // --- Day 12：全员打卡广场（真实库可能已有历史打卡，全部用相对断言） ---
    const galleryService = require('./src/services/gallery.service');
    await check('gallery.service 全站打卡流（单人 + 双人合并 / 倒序 / scope 筛选）', () => {
      const before = galleryService.listGallery({}).total;
      db.prepare(
        `INSERT INTO checkins (user_id, task_id, task_type, image_paths, note) VALUES (?, ?, 'solo', '[]', '广场探针打卡')`
      ).run(userBId, publicTaskId);
      const all = galleryService.listGallery({ limit: 50 });
      if (all.total !== before + 1) throw new Error(`合计总数应 +1: ${all.total} != ${before + 1}`);
      const probe = all.checkins.find((c) => c.note === '广场探针打卡');
      if (!probe || probe.kind !== 'solo' || probe.nickname !== userBRow.nickname)
        throw new Error('单人探针未出现在合并流或字段缺失');
      if (!all.checkins.some((c) => c.kind === 'duo')) throw new Error('双人打卡未出现在合并流');
      for (let i = 1; i < all.checkins.length; i++) {
        if (all.checkins[i - 1].submitted_at < all.checkins[i].submitted_at)
          throw new Error('未按时间倒序');
      }
      const duoOnly = galleryService.listGallery({ scope: 'duo', limit: 50 });
      if (!duoOnly.checkins.every((c) => c.kind === 'duo')) throw new Error('duo 筛选混入单人记录');
      if (duoOnly.checkins.length < 2) throw new Error('duo 筛选至少应含探针双方 2 条');
      const soloOnly = galleryService.listGallery({ scope: 'solo', limit: 50 });
      if (soloOnly.total + duoOnly.total !== all.total) throw new Error('scope 拆分总数与全部不一致');
    });
    await check('gallery.service galleryStats（累计 / 今日 / 今日参与人数）', () => {
      const s = galleryService.galleryStats();
      const n = db
        .prepare(`SELECT (SELECT COUNT(*) FROM checkins) + (SELECT COUNT(*) FROM duo_checkins) AS n`)
        .get().n;
      if (s.total !== n) throw new Error(`累计不一致: ${s.total} != ${n}`);
      // 探针当天写入：单人 A 2 条 + B 2 条（含广场探针）+ 双人 A/B 各 1 → 今日 ≥ 6、参与 ≥ 2 人
      if (s.today < 6) throw new Error('今日打卡计数偏低: ' + s.today);
      if (s.today_users < 2) throw new Error('今日参与人数应 ≥ 2');
    });

    // --- Day 13：个人数据看板（探针用户 A：单人任务 4 个 = daily 2 + weekly 2，进行中 3 / 逾期 1 / 完成 0） ---
    const statsService = require('./src/services/stats.service');
    await check('stats.service myDashboard（任务分布 / 分类 / 完成率）', () => {
      const t = statsService.myDashboard(userAId, {}).tasks;
      if (t.total !== 4) throw new Error('任务总数应为 4（仅自己的单人任务），实际 ' + t.total);
      if (t.by_category.daily !== 2 || t.by_category.weekly !== 2 || t.by_category.question !== 0)
        throw new Error('分类分布不一致: ' + JSON.stringify(t.by_category));
      if (t.completed !== 0 || t.in_progress !== 3 || t.overdue !== 1)
        throw new Error('状态分布不一致: ' + JSON.stringify(t));
      if (t.completion_rate !== 0) throw new Error('完成率应为 0，实际 ' + t.completion_rate);
      taskService.updateSoloTaskStatus({ id: userAId, role: 'user' }, day5TaskId, 'completed');
      const t2 = statsService.myDashboard(userAId, {}).tasks;
      if (t2.completed !== 1 || t2.completion_rate !== 25)
        throw new Error('完成 1/4 后完成率应为 25: ' + JSON.stringify(t2));
    });
    await check('stats.service myDashboard（月度日历 单人+双人合并 / 月份回退）', () => {
      const d = statsService.myDashboard(userAId, {});
      const today = db.prepare("SELECT date('now', 'localtime') AS d").get().d;
      // userA 打卡：Day2 基础探针 1 + Day6 2 = 单人 3，双人 1 → 今日 4
      if (d.calendar.days[today] !== 4)
        throw new Error('今日应为单人 3 + 双人 1 = 4 次，实际 ' + d.calendar.days[today]);
      if (d.calendar.month_total !== 4 || d.calendar.active_days !== 1)
        throw new Error('月度聚合不一致: ' + JSON.stringify(d.calendar));
      if (d.checkins.solo_total !== 3 || d.checkins.duo_total !== 1)
        throw new Error('打卡累计不一致: ' + JSON.stringify(d.checkins));
      const empty = statsService.myDashboard(userAId, { month: '2000-01' });
      if (empty.month !== '2000-01' || empty.calendar.month_total !== 0)
        throw new Error('历史月查询异常: ' + JSON.stringify(empty.calendar));
      const bad = statsService.myDashboard(userAId, { month: '2026-13' }); // 非法月份回退当前月
      if (!/^\d{4}-\d{2}$/.test(bad.month)) throw new Error('非法月份未回退: ' + bad.month);
    });

    // --- Day 14：个人资料（昵称 / 头像） ---
    const { updateProfile, updateAvatar, clearAvatar } = require('./src/services/user.service');
    await check('user.service updateProfile（昵称校验 + 更新生效）', () => {
      let empty, tooLong;
      try {
        updateProfile(userAFull, { nickname: '   ' });
      } catch (err) {
        empty = err;
      }
      try {
        updateProfile(userAFull, { nickname: 'x'.repeat(21) });
      } catch (err) {
        tooLong = err;
      }
      if (!empty || empty.status !== 400 || !empty.errors.nickname) throw new Error('空昵称未按预期抛 400');
      if (!tooLong || tooLong.status !== 400) throw new Error('超长昵称未按预期抛 400');

      const u = updateProfile(userAFull, { nickname: '  改名后的A  ' });
      if (u.nickname !== '改名后的A') throw new Error('昵称未去首尾空格: ' + u.nickname);
      const row = db.prepare('SELECT nickname FROM users WHERE id = ?').get(userAId);
      if (row.nickname !== '改名后的A') throw new Error('昵称未落库');
      updateProfile(userAFull, { nickname: userARow.nickname }); // 还原，避免影响后续断言的昵称比对
    });
    await check('user.service updateAvatar / clearAvatar（写入 + 替换返回旧值 + 非 uploads 前缀拒绝）', () => {
      let bad;
      try {
        updateAvatar(userAFull, '../../etc/passwd');
      } catch (err) {
        bad = err;
      }
      if (!bad || bad.status !== 400) throw new Error('非 uploads/ 前缀应被拒绝');

      const set = updateAvatar(userAFull, 'uploads/avatars/probe.png');
      if (set.previous !== null || set.user.avatar_path !== 'uploads/avatars/probe.png')
        throw new Error('头像写入异常: ' + JSON.stringify(set));

      const replaced = updateAvatar(userAFull, 'uploads/avatars/probe2.png');
      if (replaced.previous !== 'uploads/avatars/probe.png') throw new Error('替换时未返回旧路径');

      const cleared = clearAvatar(userAFull);
      if (cleared.previous !== 'uploads/avatars/probe2.png' || cleared.user.avatar_path !== null)
        throw new Error('撤销头像异常: ' + JSON.stringify(cleared));
    });

    // --- Day 14：管理员后台（概览 / 用户列表 / 公共任务） ---
    const adminService = require('./src/services/admin.service');
    await check('admin.service overview（统计口径与库内数据一致）', () => {
      const o = adminService.overview();
      const usersN = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
      const publicN = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE owner_id IS NULL').get().n;
      const checkinN = db
        .prepare('SELECT (SELECT COUNT(*) FROM checkins) + (SELECT COUNT(*) FROM duo_checkins) AS n')
        .get().n;
      if (o.users.total !== usersN) throw new Error(`用户总数不一致: ${o.users.total} != ${usersN}`);
      if (o.tasks.public_total !== publicN) throw new Error(`公共任务数不一致: ${o.tasks.public_total} != ${publicN}`);
      if (o.checkins.total !== checkinN) throw new Error(`打卡总数不一致: ${o.checkins.total} != ${checkinN}`);
      if (o.checkins.solo + o.checkins.duo !== o.checkins.total) throw new Error('打卡分项与总数不一致');
      if (o.users.normal + o.users.admins !== o.users.total) throw new Error('角色分项与总数不一致');
      if (o.users.bound !== o.teams.active * 2) throw new Error('组队人数应为 active 队伍 × 2');
      if (o.tasks.solo_total > 0 && typeof o.tasks.solo_completion_rate !== 'number')
        throw new Error('有任务时完成率不应为 null');
    });
    await check('admin.service listUsers（关键词搜索 + 分页 + 关联计数 + 组队状态）', () => {
      const all = adminService.listUsers({ limit: 100 });
      if (all.total !== db.prepare('SELECT COUNT(*) AS n FROM users').get().n) throw new Error('用户总数不一致');

      const hit = adminService.listUsers({ q: '__dbcheck_a__' });
      if (hit.total !== 1 || hit.users[0].account !== '__dbcheck_a__')
        throw new Error('关键词搜索未精确命中: ' + JSON.stringify(hit.users.map((u) => u.account)));

      const mine = hit.users[0];
      const taskN = db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE owner_id = ?').get(userAId).n;
      if (mine.task_count !== taskN) throw new Error(`自建任务数不一致: ${mine.task_count} != ${taskN}`);
      if (mine.in_team !== true) throw new Error('组队状态应为 true');
      if (mine.total_checkins !== mine.solo_checkin_count + mine.duo_checkin_count)
        throw new Error('打卡合计不一致');

      const page = adminService.listUsers({ limit: 1, offset: 1 });
      if (page.users.length !== 1 || page.limit !== 1 || page.offset !== 1) throw new Error('分页参数未生效');

      const missing = adminService.listUsers({ q: '__no_such_keyword__' });
      if (missing.total !== 0 || missing.users.length !== 0) throw new Error('无命中搜索应返回空');
    });
    await check('task.service 公共任务 CRUD（发布 / 列表 / 校验 / 删除 / 非公共任务拦截）', () => {
      const before = taskService.listPublicTasks().length;
      const t = taskService.createPublicTask({
        title: '探针：管理员发布的公共任务',
        category: 'weekly',
        deadline: '2099-12-31',
      });
      if (t.owner_id !== null || t.type !== 'solo' || t.category !== 'weekly' || t.deadline !== '2099-12-31 23:59:59')
        throw new Error('公共任务创建异常: ' + JSON.stringify(t));

      const list = taskService.listPublicTasks();
      if (list.length !== before + 1 || !list.some((x) => x.id === t.id)) throw new Error('公共任务未出现在列表');

      let badTitle;
      try {
        taskService.createPublicTask({ title: '' });
      } catch (err) {
        badTitle = err;
      }
      if (!badTitle || badTitle.status !== 400) throw new Error('公共任务空标题未按预期抛 400');

      let notPublic;
      try {
        taskService.deletePublicTask(day5TaskId); // A 的自建任务，不应能走公共任务删除通道
      } catch (err) {
        notPublic = err;
      }
      if (!notPublic || notPublic.status !== 404) throw new Error('非公共任务应返回 404');

      taskService.deletePublicTask(t.id);
      if (taskService.listPublicTasks().some((x) => x.id === t.id)) throw new Error('公共任务删除未生效');
    });

    // --- Day 8 收尾：解绑（搭档通知 + 队伍归档） ---
    await check('team.service 解绑（状态归档 + 搭档通知）', () => {
      teamService.unbindTeam(userAFull);
      const team = db
        .prepare(`SELECT * FROM teams WHERE status = 'unbound' ORDER BY id DESC`)
        .get();
      if (!team || team.unbound_at === null) throw new Error('解绑时间未记录');
      const notif = db
        .prepare(`SELECT * FROM notifications WHERE user_id = ? AND type = 'team_unbound'`)
        .get(userBId);
      if (!notif) throw new Error('搭档未收到解绑通知');
      const view = teamService.getTeamView(userAId);
      if (view.team !== null) throw new Error('解绑后组队全貌应无队伍');
    });
    await check('duoCheckin.service duoStats（解绑后无队伍 → 409）', () => {
      let caught;
      try {
        duoCheckinService.duoStats(userAFull);
      } catch (err) {
        caught = err;
      }
      if (!caught || caught.status !== 409) throw new Error('无队伍统计应返回 409');
    });

    // --- 安全加固：改密 / 会话作废 / 上传魔数 ---
    const { registerUser, authenticate, changePassword, getSessionUser } = require('./src/services/user.service');
    const { hasImageMagic } = require('./src/middleware/upload');
    await check('user.service changePassword：旧密码错误被拒', async () => {
      const u = await registerUser({ nickname: '改密探针', account: '__dbcheck_pwd__', password: 'OldPass1' });
      let caught;
      try {
        await changePassword(u, 'WrongOld1', 'NewPass1x');
      } catch (err) {
        caught = err;
      }
      if (!caught || caught.status !== 400 || !caught.errors.oldPassword) throw new Error('旧密码错误未按预期抛 400');
    });
    await check('user.service changePassword：改密生效 + 旧会话全部作废', async () => {
      const u = await registerUser({ nickname: '改密探针2', account: '__dbcheck_pwd2__', password: 'OldPass1' });
      if (await authenticate('__dbcheck_pwd2__', 'OldPass1') === null) throw new Error('前置条件失败：旧密码应可登录');
      const { session_not_before } = await changePassword(u, 'OldPass1', 'NewPass1x');
      if (!Number.isInteger(session_not_before) || session_not_before <= 0) throw new Error('session_not_before 未推进');
      if (await authenticate('__dbcheck_pwd2__', 'OldPass1') !== null) throw new Error('旧密码改密后仍可登录');
      if (await authenticate('__dbcheck_pwd2__', 'NewPass1x') === null) throw new Error('新密码无法登录');
      // 早于 session_not_before 签发的会话（含被盗 Cookie）作废；之后签发的有效
      if (getSessionUser({ userId: u.id, iat: session_not_before - 1000 }) !== null) throw new Error('旧会话未作废');
      if (getSessionUser({ userId: u.id, iat: session_not_before + 1000 }) === null) throw new Error('新会话被误杀');
      if (getSessionUser({ userId: u.id }) !== null) throw new Error('缺 iat 的旧格式会话应视为作废');
    });
    await check('upload 魔数校验（HTML 伪装 / 真实 PNG / 真实 JPEG）', () => {
      if (hasImageMagic(Buffer.from('<html><script>x</script></html>'))) throw new Error('HTML 内容被误判为图片');
      if (!hasImageMagic(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))) throw new Error('PNG 魔数未通过');
      if (!hasImageMagic(Buffer.from('ffd8ffe000104a46494600', 'hex'))) throw new Error('JPEG 魔数未通过');
      if (hasImageMagic(Buffer.from('ffd9'))) throw new Error('过短内容不应通过');
    });

    // --- Day 15：安全加固（Strix 扫描遗留项落地；照片清理探针操作真实文件，其余数据仍随事务回滚） ---
    const pageRoutes = require('./src/routes/page.routes');
    const userService15 = require('./src/services/user.service');

    await check('checkin.service 公共任务状态收权（普通用户打卡不推进，管理员推进）', () => {
      const pid = db
        .prepare(`INSERT INTO tasks (owner_id, type, title) VALUES (NULL, 'solo', '探针：状态收权公共任务')`)
        .run().lastInsertRowid;
      checkinService.createSoloCheckin(userB, {
        taskId: pid,
        note: '普通用户打卡',
        photos: ['uploads/dbcheck-scope-u.jpg'],
      });
      const st1 = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(pid).status;
      if (st1 !== 'unstarted') throw new Error('普通用户打卡公共任务不应推进状态，实际 ' + st1);
      const adminRow = db.prepare(`SELECT id FROM users WHERE account = 'admin'`).get();
      checkinService.createSoloCheckin(
        { id: adminRow.id, role: 'admin' },
        { taskId: pid, note: '管理员打卡', photos: ['uploads/dbcheck-scope-a.jpg'] }
      );
      const st2 = db.prepare(`SELECT status FROM tasks WHERE id = ?`).get(pid).status;
      if (st2 !== 'in_progress') throw new Error('管理员打卡公共任务应推进为 in_progress，实际 ' + st2);
    });

    await check('page.routes safeNext 回跳消毒（协议相对 / 反斜杠 / 控制字符 / 正常路径）', () => {
      const cases = [
        ['//evil.com', '/'],
        ['/\\evil.com', '/'],
        ['//evil.com/path', '/'],
        ['///x', '/'],
        ['/history', '/history'],
        ['/foo\r\nbar', '/foobar'],
        ['/a?b=1&c=2', '/a?b=1&c=2'],
      ];
      for (const [raw, want] of cases) {
        const got = pageRoutes.safeNext(raw);
        if (got !== want) throw new Error(`safeNext(${JSON.stringify(raw)}) 应为 ${want}，实际 ${JSON.stringify(got)}`);
      }
    });

    await check('user.service 重复注册 409 同形 + 等时（dummy bcrypt 生效）', async () => {
      const payload = { nickname: '探针注册', account: 'dbcheck_reg15', password: 'passw0rd1' };
      await userService15.registerUser(payload); // 首次注册成功
      let dup1, dup2;
      const t1 = Date.now();
      try { await userService15.registerUser(payload); } catch (e) { dup1 = e; }
      const dupMs = Date.now() - t1;
      try { await userService15.registerUser(payload); } catch (e) { dup2 = e; }
      if (!dup1 || dup1.status !== 409 || !dup2 || dup2.status !== 409) throw new Error('重复注册未按 409 拒绝');
      if (dup1.message !== dup2.message || JSON.stringify(dup1.errors) !== JSON.stringify(dup2.errors))
        throw new Error('重复注册两次响应不同形');
      if (dupMs < 20) throw new Error(`等时处理未生效（重复注册仅耗时 ${dupMs}ms，应含 bcrypt 比较）`);
    });

    const uploadsDir = path.join(__dirname, 'public', 'uploads');
    const waitUnlink = () => new Promise((r) => setTimeout(r, 150)); // removeStoredFile 为异步尽力而为
    const sweepTemp = (...files) => {
      for (const f of files) {
        try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) { /* 探针自清理 */ }
      }
    };

    await check('task.service 删除任务清理打卡照片（个人 + 公共任务，真实文件）', async () => {
      const f1 = path.join(uploadsDir, 'dbcheck-del1.png');
      const f2 = path.join(uploadsDir, 'dbcheck-del2.png');
      fs.writeFileSync(f1, 'x');
      fs.writeFileSync(f2, 'x');
      try {
        const t1 = taskService.createSoloTask(userAId, { title: '探针：删任务清照片' });
        checkinService.createSoloCheckin(userA, { taskId: t1.id, note: '', photos: ['uploads/dbcheck-del1.png'] });
        taskService.deleteSoloTask(userA, t1.id);
        await waitUnlink();
        if (fs.existsSync(f1)) throw new Error('个人任务照片未清理');

        const t2 = db
          .prepare(`INSERT INTO tasks (owner_id, type, title) VALUES (NULL, 'solo', '探针：删公共任务清照片')`)
          .run().lastInsertRowid;
        checkinService.createSoloCheckin(userB, { taskId: t2, note: '', photos: ['uploads/dbcheck-del2.png'] });
        taskService.deletePublicTask(t2);
        await waitUnlink();
        if (fs.existsSync(f2)) throw new Error('公共任务照片未清理');
      } finally {
        sweepTemp(f1, f2);
      }
    });

    await check('duoTask.service 删除共同任务清理打卡照片（真实文件）', async () => {
      const f = path.join(uploadsDir, 'dbcheck-duo-del.png');
      fs.writeFileSync(f, 'x');
      try {
        // 独立小队：直插两名新用户与一支 active 队伍，避免与 Day 8 探针的队伍状态互相干扰
        const ua = db
          .prepare(`INSERT INTO users (nickname, account, password_hash, role) VALUES ('探针队A','__dbcheck_ta__','h','user')`)
          .run().lastInsertRowid;
        const ub = db
          .prepare(`INSERT INTO users (nickname, account, password_hash, role) VALUES ('探针队B','__dbcheck_tb__','h','user')`)
          .run().lastInsertRowid;
        db.prepare(`INSERT INTO teams (user_a, user_b) VALUES (?, ?)`).run(ua, ub);
        const mkUser = (id, nickname, account) => ({ id, role: 'user', nickname, account });
        const userA2 = mkUser(ua, '探针队A', '__dbcheck_ta__');
        const dt = duoTaskService.createDuoTask(userA2, { title: '探针：删共同任务清照片' });
        duoCheckinService.createDuoCheckin(userA2, {
          duoTaskId: dt.id,
          photos: ['uploads/dbcheck-duo-del.png'],
        });
        duoTaskService.deleteDuoTask(userA2, dt.id);
        await waitUnlink();
        if (fs.existsSync(f)) throw new Error('共同任务照片未清理');
      } finally {
        sweepTemp(f);
      }
    });

    await check('分页参数取整钳制（gallery / notifications / admin users）', () => {
      const galleryService15 = require('./src/services/gallery.service');
      const g = galleryService15.listGallery({ limit: '1.7', offset: 'abc' });
      if (!Array.isArray(g.checkins) || g.checkins.length > 1) throw new Error('gallery limit=1.7 未取整钳制');
      const g2 = galleryService15.listGallery({ limit: 'abc' });
      if (g2.checkins.length > 20) throw new Error('gallery 默认 limit 未生效');
      const n = require('./src/services/notification.service').listMyNotifications(userAId, '1.9');
      if (n.length > 1) throw new Error('notifications limit=1.9 未取整钳制');
      const u = require('./src/services/admin.service').listUsers({ limit: '2.9' });
      if (u.users.length > 2 || u.limit !== 2) throw new Error('admin users limit=2.9 未取整钳制');
    });
  } finally {
    db.exec('ROLLBACK'); // 所有探针数据不落盘
  }

  // --- 种子数据可见（在事务外验证真实落库数据） ---
  await check('种子数据可见（管理员 + 示例任务）', () => {
    const admin = db.prepare(`SELECT * FROM users WHERE account = ?`).get('admin');
    if (!admin || admin.role !== 'admin') throw new Error('管理员账号缺失');
    const taskCount = db.prepare(`SELECT COUNT(*) AS n FROM tasks`).get().n;
    if (taskCount < 4) throw new Error(`示例任务不足，当前 ${taskCount} 条`);
  });

  // --- 汇总 ---
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${r.name}`);
    if (!r.ok) console.error(`  └─ ${r.err.stack || r.err}`);
  }
  console.log(`\n共 ${results.length} 项检查，通过 ${results.length - failed.length} 项，失败 ${failed.length} 项`);
  if (failed.length) process.exitCode = 1;
  else console.log('\x1b[32m全部检查通过，数据库就绪 ✔\x1b[0m');
}

main().catch((err) => { console.error(err); process.exit(2); });
