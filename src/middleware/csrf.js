/**
 * CSRF 防护（Day 20 安全专项；Strix 报告建议 #4）
 *
 * 原理：跨站攻击者无法伪造受害者的 Origin / Referer 头——浏览器发起的
 * 跨站请求会带上恶意站点的 Origin（fetch/XHR）或 Referer（表单）。
 * 校验规则（对全部状态变更方法生效）：
 *   * 请求带 Origin 或 Referer → 其 host 必须与本次请求的 Host 一致，否则 403；
 *   * 两者都缺 → 放行（非浏览器客户端本就无法被 CSRF；同源表单在现代浏览器
 *     也会带 Origin，正常流量不受影响）。
 * 与 SameSite=Lax 会话 Cookie 互为纵深：Lax 挡大多数跨站携带，本校验兜住
 * 例外场景（如部分老浏览器的 GET 表单跳转后再 POST）。
 *
 * 已知约束：反向代理部署时需保证 Host 头为对外域名（或配置 trust proxy 后
 * 用 X-Forwarded-Host），否则同源请求会被误判。
 */
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sameOriginGuard(req, res, next) {
  if (!STATE_CHANGING.has(req.method)) return next();

  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return next();

  try {
    if (new URL(origin).host === req.headers.host) return next();
  } catch (_) { /* 格式非法按不匹配处理 */ }

  return res.status(403).json({ message: '跨站请求已拒绝（Origin/Referer 校验失败）' });
}

module.exports = { sameOriginGuard };
