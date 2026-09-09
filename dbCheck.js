/**
 * dbCheck.js —— Day 2 验收脚本：确认所有表可读写、约束生效、种子数据可见
 *
 * 运行：node dbCheck.js
 * 说明：探针写入全部包在一个事务里并在结束时 ROLLBACK，不会污染数据文件。
 */
const { initDb, getDb } = require('./src/db/db');
const { seedIfEmpty } = require('./src/db/seed');

const results = [];
function check(name, fn) {
  try {
    fn();
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

function main() {
  initDb();
  const seeded = seedIfEmpty();
  const db = getDb();
  const now = new Date().toISOString();

  console.log(`数据库文件: ${require('./src/db/db').DB_PATH}`);
  console.log(`种子数据: ${seeded ? '本次写入' : '已存在，跳过'}\n`);

  db.exec('BEGIN IMMEDIATE'); // 探针事务，结束时统一回滚
  try {
    // --- users：写入 + 读回 ---
    check('users 建表 + 写入/读回', () => {
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
    check('users 账号唯一约束', () => {
      expectConstraint(() =>
        db
          .prepare(`INSERT INTO users (nickname, account, password_hash) VALUES (?, ?, ?)`)
          .run('重复账号', '__dbcheck_a__', 'x')
      );
    });

    // --- tasks：公共任务写入 + CHECK 约束 ---
    let taskId;
    check('tasks 写入/读回（owner_id=NULL 公共任务）', () => {
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
    check('tasks status CHECK 约束', () => {
      expectConstraint(() =>
        db
          .prepare(`INSERT INTO tasks (title, status) VALUES ('坏状态', 'paused')`)
          .run()
      );
    });

    // --- checkins：个人打卡 ---
    check('checkins 写入/读回', () => {
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
    check('teams 写入/读回', () => {
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
    check('teams 唯一组队约束（user_a 同时仅一支 active 队伍）', () => {
      expectConstraint(() =>
        db.prepare(`INSERT INTO teams (user_a, user_b) VALUES (?, ?)`).run(userAId, userBId)
      );
    });

    // --- duo_tasks：共同任务 ---
    let duoTaskId;
    check('duo_tasks 写入/读回', () => {
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
    check('duo_checkins 写入/读回', () => {
      db.prepare(
        `INSERT INTO duo_checkins (duo_task_id, user_id, image_paths, note) VALUES (?, ?, '[]', '探针A打卡')`
      ).run(duoTaskId, userAId);
      const row = db
        .prepare(`SELECT * FROM duo_checkins WHERE duo_task_id = ? AND user_id = ?`)
        .get(duoTaskId, userAId);
      if (!row || !row.day) throw new Error('day 字段未自动生成');
    });
    check('duo_checkins 每日一次约束（同任务同人同日唯一）', () => {
      expectConstraint(() =>
        db
          .prepare(`INSERT INTO duo_checkins (duo_task_id, user_id, day) VALUES (?, ?, date('now','localtime'))`)
          .run(duoTaskId, userAId)
      );
    });

    // --- notifications：站内通知 ---
    check('notifications 写入/读回', () => {
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
    check('外键级联删除（删队伍连带删共同任务）', () => {
      db.prepare(`DELETE FROM teams WHERE id = ?`).run(teamId);
      const left = db.prepare(`SELECT COUNT(*) AS n FROM duo_tasks WHERE team_id = ?`).get(teamId).n;
      if (left !== 0) throw new Error('duo_tasks 未随 teams 级联删除');
    });
  } finally {
    db.exec('ROLLBACK'); // 所有探针数据不落盘
  }

  // --- 种子数据可见（在事务外验证真实落库数据） ---
  check('种子数据可见（管理员 + 示例任务）', () => {
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

main();
