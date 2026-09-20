/**
 * 轻量内存限流中间件（安全加固补）
 *
 * 模块说明：
 *   createRateLimiter({ windowMs, max, keyFn, message })
 *     计数全部请求，超出返回 429 + Retry-After。适合注册 / 打卡 / 改密这类
 *     “正常用量远低于上限”的接口（改密含暴破旧密码场景，成功与否都算一次尝试）。
 *
 *   createFailureRateLimiter({ windowMs, max, keyFn, message, failStatus })
 *     只计“失败”请求：进入时先占位计数（并发下保守拦截），响应结束时若
 *     状态码不是 failStatus（默认 401）则退还配额——成功登录不应消耗暴破限额，
 *     否则正常用户连续登录 10 次就会被锁住。适合登录接口。
 *
 * 公共参数：
 *   windowMs  窗口时长（毫秒）
 *   max       窗口内最大次数
 *   keyFn(req) 限流键（如 req.ip / req.user.id）
 *   message   429 时的提示文案
 *
 * 适用范围：单进程部署（本项目 SQLite 单机模型一致）。计数在内存中，
 * 重启即清零；若未来多进程 / 多实例部署，需换外部存储（Redis 等）。
 * 键用 req.ip：反代部署时需设置 app.set('trust proxy', 1) 才能拿到真实客户端 IP。
 */

/** @type {Map<string, {count: number, resetAt: number}>} */
const buckets = new Map();

// 定期清扫过期桶，避免长窗口键（如每日打卡上限）无限堆积
const SWEEP_INTERVAL = 10 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key);
  }
}, SWEEP_INTERVAL);
if (sweeper.unref) sweeper.unref(); // 不阻止进程退出

function createRateLimiter({ windowMs, max, keyFn, message }) {
  return function rateLimit(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }
    next();
  };
}

/**
 * 只计失败的限流：进入时占位计数（并发下保守拦截），响应结束时按状态码修正——
 * 仅 failStatus（如登录 401）计入，成功 / 429 / 5xx 均退还配额。
 * 注：429 分支在注册 finish 监听之前 return，不会误退自己。
 */
function createFailureRateLimiter({ windowMs, max, keyFn, message, failStatus = 401 }) {
  return function rateLimit(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ message });
    }
    res.on('finish', () => {
      if (res.statusCode !== failStatus) {
        bucket.count = Math.max(0, bucket.count - 1); // 非失败响应：退还本次配额
      }
    });
    next();
  };
}

/* ---------- Day 21 复测（v1.0.3）：登录节流（IP + 账号双计数，凭据验证前置） ----------
 * 修复渗透测试 vuln-0002（认证 DoS）：原先单一「按 IP 失败计数 + 入口硬拦」会把共享
 * NAT（校园网 / 宿舍出口）下的全部用户锁死，且正确密码也被 429。
 * 新模型：登录路由先验证凭据——成功永远放行并清空对应账号桶；仅对「失败尝试」
 * 按 IP（10 次 / 15 分钟）与按账号（5 次 / 15 分钟）双计数，超阈值后的失败尝试
 * 返回 429。注意：凭据验证前置意味着每条登录尝试都会执行一次 bcrypt——429 只是对
 * 「密码错误」的响应修饰，并不阻止该次猜测被评估，也不节省 bcrypt 成本；在线爆破的
 * 实际吞吐由 /api 全局限流与 /login 防爆破闸门（见 auth.routes）约束。但正确凭据
 * 任何时刻都可登录。通用文案与等时时序维持不变（不泄漏账号存在性）。 */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_IP_MAX = 10;
const LOGIN_ACCOUNT_MAX = 5;

function loginBucket(key, now) {
  let b = buckets.get(key);
  if (!b || now > b.resetAt) {
    b = { count: 0, resetAt: now + LOGIN_WINDOW_MS };
    buckets.set(key, b);
  }
  return b;
}

/** 记录一次登录失败，返回 { throttled, retryAfterSec }：
 *  throttled = 该 IP 或该账号的失败数超出阈值（之后的失败尝试返回 429）。 */
function recordLoginFailure(req, account) {
  const now = Date.now();
  const ipBucket = loginBucket('login-ip:' + req.ip, now);
  const acctBucket = loginBucket('login-acct:' + String(account || '').trim(), now);
  ipBucket.count += 1;
  acctBucket.count += 1;
  const throttled = ipBucket.count > LOGIN_IP_MAX || acctBucket.count > LOGIN_ACCOUNT_MAX;
  return {
    throttled,
    retryAfterSec: Math.max(1, Math.ceil((ipBucket.resetAt - now) / 1000)),
    ipFails: ipBucket.count,
    accountFails: acctBucket.count,
    ipCrossed: ipBucket.count === LOGIN_IP_MAX + 1,
    accountCrossed: acctBucket.count === LOGIN_ACCOUNT_MAX + 1,
  };
}

/** 登录成功：清空该账号的失败桶（该账号此前的失败尝试不再累积）。 */
function clearLoginFailures(account) {
  buckets.delete('login-acct:' + String(account || '').trim());
}

/** 只读快照（供监控 / 测试）。 */
function loginThrottleSnapshot(req, account) {
  const now = Date.now();
  const ip = buckets.get('login-ip:' + req.ip);
  const acct = buckets.get('login-acct:' + String(account || '').trim());
  return {
    ipFails: ip && now <= ip.resetAt ? ip.count : 0,
    accountFails: acct && now <= acct.resetAt ? acct.count : 0,
  };
}

module.exports = {
  createRateLimiter,
  createFailureRateLimiter,
  loginThrottle: {
    LOGIN_IP_MAX,
    LOGIN_ACCOUNT_MAX,
    recordFailure: recordLoginFailure,
    clear: clearLoginFailures,
    snapshot: loginThrottleSnapshot,
  },
};
