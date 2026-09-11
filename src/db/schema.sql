-- 学习打卡网页 · 数据库结构（Day 2 依据《项目开发计划》§6 数据字典固化）
-- 约定：
--   * 时间字段统一存服务器本地时间字符串 'YYYY-MM-DD HH:MM:SS'，全站以服务器时间为准（见风险表「时区不一致」）
--   * image_paths / payload 等 JSON 字段存 TEXT，由应用层 JSON.stringify / parse
--   * 布尔用 INTEGER 0/1

PRAGMA foreign_keys = ON;

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname      TEXT    NOT NULL,
  account       TEXT    NOT NULL UNIQUE,             -- 登录账号，全局唯一
  password_hash TEXT    NOT NULL,                    -- bcrypt 哈希
  role          TEXT    NOT NULL DEFAULT 'user'
                CHECK (role IN ('user', 'admin')),
  avatar_path   TEXT,                                -- 头像图片路径（可为空，Day 14 启用）
  created_at    TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 单人任务表（owner_id 为 NULL 表示管理员发布的公共任务）
CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,  -- NULL = 公共任务
  type        TEXT    NOT NULL DEFAULT 'solo'
              CHECK (type IN ('solo', 'duo')),
  category    TEXT    NOT NULL DEFAULT 'daily'
              CHECK (category IN ('daily', 'weekly', 'question')),  -- daily=每日任务 weekly=每周重点 question=学习问题（Day 5 引入）
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  deadline    TEXT,                                  -- 'YYYY-MM-DD HH:MM:SS'，空 = 无截止
  status      TEXT    NOT NULL DEFAULT 'unstarted'
              CHECK (status IN ('unstarted', 'in_progress', 'completed', 'overdue')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_tasks_owner    ON tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);

-- 个人打卡表
CREATE TABLE IF NOT EXISTS checkins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  task_type    TEXT    NOT NULL DEFAULT 'solo'
               CHECK (task_type IN ('solo', 'duo')),
  image_paths  TEXT    NOT NULL DEFAULT '[]',        -- JSON 数组，如 ["uploads/xxx.jpg"]
  note         TEXT    NOT NULL DEFAULT '',
  submitted_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  is_overdue   INTEGER NOT NULL DEFAULT 0
               CHECK (is_overdue IN (0, 1))          -- 提交时间晚于任务截止 = 1（逾期）
);
CREATE INDEX IF NOT EXISTS idx_checkins_user ON checkins(user_id, submitted_at);
CREATE INDEX IF NOT EXISTS idx_checkins_task ON checkins(task_id);

-- 双人组队表（一个用户同一时刻最多一个 active 搭档）
CREATE TABLE IF NOT EXISTS teams (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_a     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT    NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'unbound')),
  bound_at   TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  unbound_at TEXT
);
-- 部分唯一索引：同一用户最多出现在一支 active 队伍中（另一方向由应用层二次校验兜底）
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_active_a ON teams(user_a) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_active_b ON teams(user_b) WHERE status = 'active';

-- 双人共同任务表
CREATE TABLE IF NOT EXISTS duo_tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  title       TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  deadline    TEXT,
  division_a  TEXT    NOT NULL DEFAULT '',           -- 成员 A 的分工
  division_b  TEXT    NOT NULL DEFAULT '',           -- 成员 B 的分工
  status      TEXT    NOT NULL DEFAULT 'unstarted'
              CHECK (status IN ('unstarted', 'in_progress', 'completed', 'overdue')),
  created_at  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_duo_tasks_team ON duo_tasks(team_id, status);

-- 双人打卡表（每日仅可对同一共同任务打卡一次 → 唯一索引兜底，见风险表「并发写竞争」）
CREATE TABLE IF NOT EXISTS duo_checkins (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  duo_task_id  INTEGER NOT NULL REFERENCES duo_tasks(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  image_paths  TEXT    NOT NULL DEFAULT '[]',
  note         TEXT    NOT NULL DEFAULT '',
  submitted_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
  day          TEXT    NOT NULL DEFAULT (date('now', 'localtime'))  -- 'YYYY-MM-DD'，用于每日一次约束
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_duo_checkins_daily
  ON duo_checkins(duo_task_id, user_id, day);
CREATE INDEX IF NOT EXISTS idx_duo_checkins_user ON duo_checkins(user_id, submitted_at);

-- 站内通知表
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,                        -- 如 invite / duo_reminder / partner_checkin
  payload    TEXT    NOT NULL DEFAULT '{}',           -- JSON 附加数据
  read_at    TEXT,                                    -- NULL = 未读
  created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);
