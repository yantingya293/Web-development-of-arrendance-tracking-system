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

function initDb() {
  const conn = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  conn.exec(schema);
  migrateTasksCategory(conn);
  migrateUsersSessionNotBefore(conn);
  migrateCheckinsDay(conn); // 唯一索引在其内部随迁移事务创建
  return conn;
}

module.exports = { getDb, initDb, DB_PATH };
