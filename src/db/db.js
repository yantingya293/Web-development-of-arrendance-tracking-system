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

function initDb() {
  const conn = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  conn.exec(schema);
  migrateTasksCategory(conn);
  migrateUsersSessionNotBefore(conn);
  return conn;
}

module.exports = { getDb, initDb, DB_PATH };
