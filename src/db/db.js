/**
 * 数据库连接单例（Day 2）
 *
 * 模块说明：
 *   getDb()      获取 better-sqlite3 单例连接（已开 WAL、外键）
 *   initDb()     建库：确保 data 目录存在并执行 schema.sql + 增量迁移（幂等，可重复调用）
 *   DB_PATH      数据库文件绝对路径（默认 data/app.db，可用环境变量 DB_PATH 覆盖）
 *
 * 迁移记录：
 *   Day 5  tasks 表补 category 列（daily / weekly / question），
 *          老库按种子数据旧标题前缀（每日任务：/ 每周重点：/ 学习问题：）回填分类
 *   安全加固 users 表补 session_not_before 列（ms 纪元；改密时推进，作废更早签发的会话）
 *   Day 21 checkins 表补 day 列（按 submitted_at 回填）+ 历史重复打卡去重 +
 *          唯一索引 idx_checkins_daily(task_id, user_id, day)，对齐双人打卡每日一次口径
 *   v1.1.0 tasks 表重建：category 放行 today（当日任务）+ 补 partner_visible
 *          列（搭档观察开关，老数据一律 0 = 不开放）
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(
  __dirname,
  '../..',
  process.env.DB_PATH || path.join('data', 'app.db')
);

let db = null;

function getDb() {
  if (db) return db;

  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);

  db.pragma('journal_mode = WAL'); // 读写并发友好，轮询场景受益
  db.pragma('foreign_keys = ON');  // 本项目外键约束依赖此开关（每次连接需重新开启）
  db.pragma('busy_timeout = 3000');

  return db;
}

/** Day 5 迁移：老库 tasks 表补 category 列（新库由 schema.sql 直接建出，此处跳过） */
function migrateTasksCategory(conn) {
  const hasColumn = conn
    .prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'category'")
    .get();
  if (hasColumn) return false;

  conn.exec(
    `ALTER TABLE tasks ADD COLUMN category TEXT NOT NULL DEFAULT 'daily'
       CHECK (category IN ('daily', 'weekly', 'question'))`
  );
  // 老数据按 Day 2–4 的标题前缀约定回填分类，无前缀的归入 daily
  conn.exec(
    `UPDATE tasks SET category = CASE
       WHEN title LIKE '每日任务：%' THEN 'daily'
       WHEN title LIKE '每周重点：%' THEN 'weekly'
       WHEN title LIKE '学习问题：%' THEN 'question'
       ELSE 'daily'
     END`
  );
  return true;
}

/** 安全加固迁移：老库 users 表补 session_not_before 列（新库由 schema.sql 直接建出，此处跳过） */
function migrateUsersSessionNotBefore(conn) {
  const hasColumn = conn
    .prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'session_not_before'")
    .get();
  if (hasColumn) return false;
  conn.exec('ALTER TABLE users ADD COLUMN session_not_before INTEGER');
  return true;
}

/**
 * Day 21 迁移：老库 checkins 表补 day 列（每日一次约束用，新库由 schema.sql 直接建出）。
 * SQLite 的 ADD COLUMN 不接受 date() 这类非常量默认值，故加可空列后按 submitted_at
 * 回填，并先去重再建唯一索引——同一 (user_id, task_id, day) 保留最早一条。
 *
 * Day 21 白盒复测修复（CWE-248）：本迁移必须「原子 + 幂等 + 自愈」。
 *   * 原子：全部步骤在 BEGIN IMMEDIATE 事务内，任何一步失败整体回滚，不留中间态；
 *   * 完成判据三条件：day 列存在 + idx_checkins_daily 存在 + 无残留 NULL day。
 *     只看「列是否存在」会把进程中断留下的中间态（回填已提交但未去重 / 未建索引）
 *     误判为已完成——后续建索引必然 UNIQUE 失败，服务每次启动都起不来；
 *     「索引已存在但 day 全为 NULL」同样要重跑（NULL 不被唯一索引覆盖，约束形同虚设）；
 *   * 先删索引再回填：老中间态里旧索引还在时，把 NULL 回填成同一天会直接 UNIQUE 失败。
 * 已知取舍：迁移库的 day 列保持可空（ALTER 无法补非常量默认值），但迁移保证不存在
 * NULL day 行，且应用层两条 INSERT 均显式绑定 day——与 schema 直建库的约束强度一致。
 */
const CHECKINS_DAILY_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_daily ON checkins(task_id, user_id, day)';

function migrateCheckinsDay(conn) {
  const hasColumn = !!conn
    .prepare("SELECT 1 FROM pragma_table_info('checkins') WHERE name = 'day'")
    .get();
  const hasIndex = !!conn
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_checkins_daily'")
    .get();
  const hasNullDay = hasColumn
    ? !!conn.prepare('SELECT 1 FROM checkins WHERE day IS NULL LIMIT 1').get()
    : false;
  // 三条件全满足才算迁移完成；任一中间态都重跑完整序列（自愈）
  if (hasColumn && hasIndex && !hasNullDay) return false;

  conn.exec('BEGIN IMMEDIATE');
  try {
    conn.exec('DROP INDEX IF EXISTS idx_checkins_daily');
    if (!hasColumn) {
      conn.exec('ALTER TABLE checkins ADD COLUMN day TEXT');
    }
    // 只回填尚未设置的行，重复执行不会覆盖已写入的 day
    conn.exec("UPDATE checkins SET day = substr(submitted_at, 1, 10) WHERE day IS NULL");
    // 无条件去重：清理任何残留重复行（含中断后重新进入的中间态），保证唯一索引可建
    const dedupe = conn.prepare(
      `DELETE FROM checkins WHERE id NOT IN (
         SELECT MIN(id) FROM checkins GROUP BY user_id, task_id, day
       )`
    );
    const removed = dedupe.run().changes;
    if (removed > 0) {
      console.log(`[migrate] checkins 历史重复打卡已去重：删除 ${removed} 条（每组保留最早一条）`);
    }
    conn.exec(CHECKINS_DAILY_INDEX_SQL);
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
  return true;
}

/**
 * v1.1.0 迁移：tasks 表重建——category 放行 'today'（当日任务）+ 补 partner_visible
 * 列（搭档观察开关）。SQLite 不能修改既有 CHECK 约束，只能按官方 12 步法重建：
 * 建新表（定义与 schema.sql 保持一致）→ 整表迁数据 → 换名 → 重建索引。
 *
 *   * 哨兵：partner_visible 列缺失 = 老表（新 schema 一次带出两个变更，老库两者皆缺；
 *     新库由 schema.sql 直接建出新表，此处跳过）
 *   * 原子：全程 BEGIN IMMEDIATE 事务，任一步失败整体回滚，不留中间态；幂等可重跑
 *   * 外键先关后开：DROP 老表时不级联清空 checkins（id 全部保留，外键随后按表名
 *     重新指向换名后的新表）；迁移只发生在启动期单连接上，关窗风险可控
 *   * sqlite_sequence 随 RENAME 自动改指向新表名，AUTOINCREMENT 计数从迁移数据
 *     的最大 id 继续，不回退
 */
const TASKS_V110_DDL = `
  CREATE TABLE tasks_v110 (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    type        TEXT    NOT NULL DEFAULT 'solo'
                CHECK (type IN ('solo', 'duo')),
    category    TEXT    NOT NULL DEFAULT 'daily'
                CHECK (category IN ('daily', 'today', 'weekly', 'question')),
    title       TEXT    NOT NULL,
    description TEXT    NOT NULL DEFAULT '',
    deadline    TEXT,
    partner_visible INTEGER NOT NULL DEFAULT 0
                CHECK (partner_visible IN (0, 1)),
    status      TEXT    NOT NULL DEFAULT 'unstarted'
                CHECK (status IN ('unstarted', 'in_progress', 'completed', 'overdue')),
    created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
  )`;

function migrateTasksTodayAndPartnerVisible(conn) {
  const hasPartnerVisible = conn
    .prepare("SELECT 1 FROM pragma_table_info('tasks') WHERE name = 'partner_visible'")
    .get();
  if (hasPartnerVisible) return false;

  const fkWasOn = conn.pragma('foreign_keys', { simple: true }) === 1;
  if (fkWasOn) conn.pragma('foreign_keys = OFF');
  conn.exec('BEGIN IMMEDIATE');
  try {
    conn.exec(TASKS_V110_DDL);
    conn.exec(
      `INSERT INTO tasks_v110
         (id, owner_id, type, category, title, description, deadline, partner_visible, status, created_at)
       SELECT id, owner_id, type, category, title, description, deadline, 0, status, created_at
       FROM tasks`
    );
    conn.exec('DROP TABLE tasks');
    conn.exec('ALTER TABLE tasks_v110 RENAME TO tasks');
    conn.exec('CREATE INDEX IF NOT EXISTS idx_tasks_owner ON tasks(owner_id)');
    conn.exec('CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline)');
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  } finally {
    if (fkWasOn) conn.pragma('foreign_keys = ON');
  }
  console.log('[migrate] tasks 表已重建：category 放行 today（当日任务），新增 partner_visible（搭档观察）');
  return true;
}

function initDb() {
  const conn = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  conn.exec(schema);
  migrateTasksCategory(conn);
  migrateUsersSessionNotBefore(conn);
  migrateCheckinsDay(conn); // 唯一索引在其内部随迁移事务创建
  migrateTasksTodayAndPartnerVisible(conn);
  return conn;
}

module.exports = { getDb, initDb, DB_PATH };
