/**
 * 初始种子数据（Day 2）
 *
 * 模块说明：
 *   seedIfEmpty()  仅当 users 表为空时写入种子数据，幂等可重复调用：
 *                    1. 管理员账号 admin（密码用 ADMIN_PASSWORD 设置；生产未设置则生成一次性
 *                       随机密码打印一次；开发未设置用 admin123，上线前务必修改）
 *                    2. 几个示例单人任务（覆盖 daily / weekly / question 三类分类
 *                       与未开始 / 进行中 / 已逾期三种状态，Day 5 起带 category 字段）
 *   直接运行本文件可手动补种：node src/db/seed.js
 */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { getDb } = require('./db');

/** 管理员账号主体（密码运行时解析，见 resolveAdminPassword） */
const ADMIN = {
  nickname: '管理员',
  account: 'admin',
  role: 'admin',
};

/** 解析种子管理员密码（安全加固后不再有无条件回退口令）：
 *   * 设置了 ADMIN_PASSWORD → 使用之；
 *   * 生产环境未设置        → 每次生成一次性随机密码并打印一次（不存在源码可查的默认口令）；
 *   * 开发环境未设置        → 使用 admin123（仅本地开发便利，warn 提醒）。 */
function resolveAdminPassword() {
  if (process.env.ADMIN_PASSWORD) {
    return { password: process.env.ADMIN_PASSWORD, generated: false };
  }
  if (process.env.NODE_ENV === 'production') {
    return { password: crypto.randomBytes(16).toString('hex'), generated: true };
  }
  return { password: 'admin123', generated: false };
}

function buildSeedRows(now) {
  const daysFromNow = (n, h = '23:59:59') => {
    const d = new Date(now.getTime() + n * 24 * 60 * 60 * 1000);
    const p = (x) => String(x).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${h}`;
  };

  return [
    {
      type: 'solo',
      category: 'daily',
      title: '完成高数第三章课后习题',
      description: '完成教材 P56–P58 全部习题，拍照上传打卡。',
      deadline: daysFromNow(0), // 今天截止 → 未开始
      status: 'unstarted',
    },
    {
      type: 'solo',
      category: 'weekly',
      title: '英语阅读真题一套',
      description: '限时 60 分钟完成 2024 年 Text 1–4，校对答案并整理错题。',
      deadline: daysFromNow(3),
      status: 'in_progress',
    },
    {
      type: 'solo',
      category: 'question',
      title: '如何高效记忆专业课名词解释',
      description: '尝试艾宾浩斯记忆法实践一周，记录效果对比。',
      deadline: daysFromNow(-1), // 昨天截止 → 已逾期示例
      status: 'overdue',
    },
    {
      type: 'solo',
      category: 'daily',
      title: '整理错题本第 1 章',
      description: '由管理员发布的公共任务，所有用户可见可打卡。',
      deadline: null,
      status: 'unstarted',
    },
  ];
}

function seedIfEmpty() {
  const db = getDb();
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount > 0) return false;

  const now = new Date();
  const { password: adminPassword, generated: generatedPassword } = resolveAdminPassword();
  const hash = bcrypt.hashSync(adminPassword, 10);

  const seed = db.transaction(() => {
    db.prepare(
      `INSERT INTO users (nickname, account, password_hash, role)
       VALUES (?, ?, ?, ?)`
    ).run(ADMIN.nickname, ADMIN.account, hash, ADMIN.role);

    const insertTask = db.prepare(
      `INSERT INTO tasks (owner_id, type, category, title, description, deadline, status)
       VALUES (NULL, @type, @category, @title, @description, @deadline, @status)`
    );
    for (const task of buildSeedRows(now)) insertTask.run(task);
  });
  seed();

  if (generatedPassword) {
    // 一次性随机口令只打印这一次，须立即保存
    console.log(
      `[admin] 未设置 ADMIN_PASSWORD，已为种子管理员生成一次性随机密码（仅打印这一次，请立即保存并登录修改）：${adminPassword}`
    );
  } else if (!process.env.ADMIN_PASSWORD) {
    console.warn(
      '[warn] 开发环境管理员账号使用了默认密码 admin123，请上线前设置 ADMIN_PASSWORD 或在「个人中心 → 修改密码」改掉。'
    );
  }
  return true;
}

module.exports = { seedIfEmpty, ADMIN };

if (require.main === module) {
  const { initDb } = require('./db');
  initDb();
  const seeded = seedIfEmpty();
  console.log(seeded ? '种子数据写入完成。' : 'users 表非空，跳过种子数据。');
}
