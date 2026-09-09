/**
 * 数据库连接单例（Day 2）
 *
 * 模块说明：
 *   getDb()      获取 better-sqlite3 单例连接（已开 WAL、外键）
 *   initDb()     建库：确保 data 目录存在并执行 schema.sql（幂等，可重复调用）
 *   DB_PATH      数据库文件绝对路径（默认 data/app.db，可用环境变量 DB_PATH 覆盖）
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

function initDb() {
  const conn = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  conn.exec(schema);
  return conn;
}

module.exports = { getDb, initDb, DB_PATH };
