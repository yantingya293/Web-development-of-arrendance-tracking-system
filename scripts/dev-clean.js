/**
 * 开发数据清理脚本（Day 21 交付）
 *
 * 按账号精确删除测试用户（外键级联其任务 / 打卡 / 组队 / 通知）。
 * 用于清理开发迭代期间遗留的测试账号（alice88 / bob99 / day7user1 等）。
 *
 * 用法：
 *   node scripts/dev-clean.js                     预览疑似测试账号（不改动任何数据）
 *   node scripts/dev-clean.js alice88 bob99       预览指定账号将删除的数据
 *   node scripts/dev-clean.js alice88 bob99 --yes 确认删除
 *
 * 防呆：拒绝删除 admin；不带 --yes 只预览；默认库 data/app.db，可用 DB_PATH 覆盖。
 */
const { initDb, getDb } = require('../src/db/db');

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const accounts = args.filter((a) => !a.startsWith('--'));

const SUSPICIOUS = /(^test|_test$|^e2e|day\d|httpchk|dbcheck|^alice|^bob|^carol|^\d{6,}$)/i;

initDb();
const db = getDb();

if (!accounts.length) {
  const rows = db
    .prepare(
      `SELECT account, nickname, role, created_at FROM users
       WHERE account != 'admin' ORDER BY id`
    )
    .all();
  const hits = rows.filter((r) => SUSPICIOUS.test(r.account));
  console.log('全部非管理员账号（疑似测试账号已标注 ?）：');
  for (const r of rows) {
    const flag = SUSPICIOUS.test(r.account) ? '?' : ' ';
    console.log(` ${flag} ${r.account.padEnd(20)} ${r.nickname}  (${r.role}, 注册于 ${r.created_at})`);
  }
  if (!hits.length) console.log('\n未发现疑似测试账号。');
  else console.log(`\n预览删除效果：node scripts/dev-clean.js ${hits.map((h) => h.account).join(' ')} --yes`);
  process.exit(0);
}

if (accounts.includes('admin')) {
  console.error('[refuse] 不允许删除 admin 账号。');
  process.exit(1);
}

for (const acc of accounts) {
  const user = db.prepare('SELECT id, nickname, role FROM users WHERE account = ?').get(acc);
  if (!user) {
    console.log(`- ${acc}: 不存在，跳过`);
    continue;
  }
  const counts = {
    tasks: db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE owner_id = ?').get(user.id).n,
    checkins: db.prepare('SELECT COUNT(*) AS n FROM checkins WHERE user_id = ?').get(user.id).n,
    duo_checkins: db.prepare('SELECT COUNT(*) AS n FROM duo_checkins WHERE user_id = ?').get(user.id).n,
    notifications: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(user.id).n,
  };
  const line = Object.entries(counts)
    .map(([k, v]) => `${k} ${v}`)
    .join(' / ');
  if (!yes) {
    console.log(`- ${acc}（${user.nickname}）: 将删除 ${line}`);
    continue;
  }
  db.prepare('DELETE FROM users WHERE id = ? AND account != ?').run(user.id, 'admin');
  console.log(`✓ ${acc}（${user.nickname}）已删除（${line}）`);
}

if (!yes) console.log('\n以上为预览。确认无误后追加 --yes 执行删除。');
