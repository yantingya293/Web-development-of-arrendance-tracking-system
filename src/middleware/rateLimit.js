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

module.exports = { createRateLimiter, createFailureRateLimiter };
