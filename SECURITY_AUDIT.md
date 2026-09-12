# 安全评估报告 · 学习打卡网页（study-checkin-web）

- **评估日期**：2026-09-12
- **评估对象**：develop 分支（commit 12a3ec6）
- **评估方式**：白盒代码审计（全部路由 / 服务层 / 中间件 / 模板 / 前端脚本）+ 本地动态验证（实际复现攻击链）
- **技术栈**：Node.js 20 + Express 4 + better-sqlite3 + cookie-session + EJS + multer

---

## 一、总体评价

项目整体代码质量较高：**SQL 全量参数化（无注入）、EJS 模板全量转义输出、前端 innerHTML 渲染均有 escapeHtml、越权（IDOR）防护体系完整、开放重定向已修复**。此前（commit fc5bae2）已自行修复过存储型 XSS 与开放重定向，说明开发者具备安全意识。

但存在 **2 个严重、1 个高危、5 个中危** 问题。其中「默认 SESSION_SECRET 可伪造任意用户会话」与「默认管理员口令 admin/admin123 且无改密功能」均已**实测复现**，若按现状部署即等于完全失守。多数待加固项项目已自知（代码注释标注 Day 20 安全专项），本报告给出了优先级与具体方案。

### 风险矩阵

| # | 漏洞 | 严重度 | 状态 |
|---|------|--------|------|
| 1 | 默认 SESSION_SECRET → 无密码伪造任意用户/管理员会话 | **严重** | ✅ 已实测复现 |
| 2 | 种子管理员 admin/admin123，且全站无改密功能 | **严重** | ✅ 已实测登录 |
| 3 | 登录/注册/上传无速率限制（暴破 + 轰炸 + CPU DoS） | 高 | ✅ 已实测 |
| 4 | 上传仅信任客户端 Content-Type，无魔数校验 | 中 | ✅ 已实测绕过 |
| 5 | 无 CSRF token（SameSite=Lax 部分缓解） | 中 | 代码分析 |
| 6 | 缺失全部安全响应头（nosniff / CSP / frame-ancestors / HSTS） | 中 | ✅ 已实测 |
| 7 | 会话管理弱点：无 Secure 标志、无服务端吊销、7 天长效 | 中 | ✅ 已实测 |
| 8 | 打卡照片公开可访问 + 上传无配额（磁盘耗尽） | 中 | ✅ 已实测 |
| 9 | 登录时序侧信道账号枚举 | 低 | 代码分析 |
| 10 | 依赖漏洞（qs/express 链，3 个 moderate） | 低 | npm audit |
| 11 | 组队邀请接口可探测账号存在性 + 邀请骚扰 | 低 | 代码分析 |

---

## 二、详细发现

### 【严重】1. 默认 SESSION_SECRET → 任意会话伪造

**位置**：`app.js:30`

```js
keys: [process.env.SESSION_SECRET || 'dev-only-secret-please-change-me'],
```

**问题**：未设置环境变量时使用源码中硬编码的确定性密钥。cookie-session 的会话仅是「HMAC-SHA1(key, 'sid=' + base64JSON)」签名，无服务端状态，密钥一旦可知即可为任意 userId 签发合法会话。

**实测复现**（无需任何密码）：

```js
const Keygrip = require('keygrip');
const kg = new Keygrip(['dev-only-secret-please-change-me']);
const val = Buffer.from(JSON.stringify({ userId: 1 })).toString('base64');
// Cookie: sid=<val>; sid.sig=<kg.sign('sid=' + val)>
```

带该 Cookie 请求 `GET /admin` → **200**，`GET /api/auth/me` → 返回管理员身份。可伪造任意注册用户与管理员，包括读改删任意任务、解绑任意队伍。

**修复建议**：
1. 生产环境强制要求 `SESSION_SECRET`：未设置时直接 `throw` 拒绝启动（仅保留开发模式白名单，如 `NODE_ENV !== 'production'` 时才允许回退，且回退值改为每次启动随机生成的内存密钥——重启失效比可伪造安全得多）；
2. 密钥为 ≥32 字节随机串（`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`）；
3. 支持密钥轮换：`keys: [新密钥, 旧密钥]`。

---

### 【严重】2. 默认管理员 admin/admin123，且无改密功能

**位置**：`src/db/seed.js:15-20`

**问题**：首次启动种子写入 `admin/admin123`（实测可登录）。更糟的是**全站没有修改密码的 API 与页面**（auth 路由仅 register/login/logout/me），注释里「部署后请登录修改密码」目前无法执行——除非手工改数据库。

**修复建议**：
1. 初始密码改从环境变量 `ADMIN_INITIAL_PASSWORD` 读取，未设置则不种子管理员；
2. 在个人中心（Day 13 计划中）加入改密功能：验证旧密码 + bcrypt 新哈希；
3. 管理员首登强制改密（users 表加 `must_change_password` 标记）。

---

### 【高】3. 无速率限制：登录暴破 / 注册轰炸 / bcrypt CPU DoS

**位置**：`src/routes/auth.routes.js`、全部上传路由

**实测**：连续 10 次错误密码登录全部被受理（10×401，无锁定、无验证码、无延迟）；3 个连续注册请求全部 201 成功。

**放大因素**：`bcrypt.compareSync` 是同步调用（cost 10 约几十毫秒），并发暴破请求会同时阻塞 Node 事件循环——既能猜口令又能做 CPU 拒绝服务；bcrypt.hashSync 同理作用于注册。

**修复建议**：
1. 引入 `express-rate-limit`：
   - `/api/auth/login`：按 IP 5 次/15 分钟，超限 429；
   - `/api/auth/register`：按 IP 3 个/小时；
   - `/api/checkins`、`/api/duo-checkins`（multipart 上传）：按用户 10 次/分钟；
2. 改用异步 API（`bcrypt.compare`/`bcrypt.hash`）避免阻塞事件循环；
3. 若公网部署，登录前加图形/行为验证码。

---

### 【中】4. 上传校验仅信任客户端 Content-Type（无魔数校验）

**位置**：`src/middleware/upload.js:30,35-38`

```js
const ext = MIME_EXT[file.mimetype] || '';      // mimetype 由客户端声明
if (MIME_EXT[file.mimetype]) return cb(null, true); // 仅校验声明值
```

**实测绕过**：将 `<html><script>alert(1)</script></html>` 内容的文件以 `Content-Type: image/png` 提交 → 服务端接受并落盘为 `uploads/1789198040129-aeee1c86c152.png`，可公开访问。响应 `Content-Type: image/png`（按扩展名）且**无 `X-Content-Type-Options: nosniff`**。

**现有缓解**：扩展名强制白名单映射、文件名服务端随机生成（不信任原始名）、现代浏览器对 `image/png` 声明不嗅探执行——所以当前直接 XSS 利用面有限；但嗅探型旧浏览器/内嵌 WebView（如微信内置浏览器的历史版本、IE）会把 HTML 内容当页面执行，构成存储型 XSS 通道。代码注释已自知留到 Day 20。

**修复建议**：
1. 落盘前读文件头魔数：JPG `FF D8 FF`、PNG `89 50 4E 47 0D 0A 1A 0A`，不匹配即 400 并删除（`fileFilter` 阶段拿不到内容，放在 `filename` 回调后的二次校验或路由层）；
2. 全局加 `X-Content-Type-Options: nosniff`（见发现 6）；
3. 可选：用 `sharp` 重编码图片（顺带剥离 PNG 中的文本块等隐藏载荷，并压缩体积）。

---

### 【中】5. 无 CSRF token

**位置**：`app.js:27-36`（注释自知 Day 20 处理）

**现状缓解**：`SameSite=Lax` 使现代浏览器不再随跨站 POST 携带会话 Cookie；JSON 接口（Content-Type: application/json）跨站提交会触发 CORS 预检且被无 CORS 配置拦截。

**残余风险**：
- 打卡接口接受 `multipart/form-data`（`/api/checkins`、`/api/duo-checkins`），跨站 `<form>` 可无预检构造该类型——在未实施 SameSite 的旧浏览器上可被 CSRF 强制打卡/上传；
- Lax 下顶层 GET 导航仍带 Cookie，未来若增加 GET 状态变更接口即破防。

**修复建议**：登录时在 session 存随机 token，前端统一在 `fetch` 封装里带 `X-CSRF-Token` 头，服务端中间件对所有非 GET 校验（比表单隐藏域更适合本项目的 SPA 式交互）。

---

### 【中】6. 缺失全部安全响应头

**实测** `GET /` 响应头：仅 `X-Powered-By: Express`（信息泄露），无任何安全头。

| 缺失头 | 后果 |
|---|---|
| `X-Content-Type-Options: nosniff` | 与发现 4 组合放大嗅探风险 |
| `X-Frame-Options` / `CSP frame-ancestors` | 点击劫持（诱导已登录用户点击） |
| `Content-Security-Policy` | 一旦出现 XSS 无纵深防线 |
| `Strict-Transport-Security` | HTTPS 部署后首次降级劫持 |

**修复建议**：`app.disable('x-powered-by')` + 引入 `helmet`（默认即含上述各项），CSP 可按 `default-src 'self'` 起步，内联样式按需放开 `style-src 'unsafe-inline'`。

---

### 【中】7. 会话管理弱点

**实测** Cookie 属性：`HttpOnly ✓ SameSite=Lax ✓ Secure ✗`。

1. **无 Secure 标志**：HTTPS 部署后 Cookie 可能在 HTTP 明文请求中泄露；
2. **无服务端吊销**：cookie-session 无状态，`logout` 仅清客户端；Cookie 被盗后 7 天内无法使其失效，且因无改密功能（发现 2），「改密踢下线」也不存在；
3. **登录后不轮换会话**：cookie-session 场景下会话固定风险本就低，可接受。

**修复建议**：生产环境 `secure: true`（用 `NODE_ENV` 或 `TRUST_PROXY` 判断）；maxAge 收敛到 1–2 天并加「记住我」选项；长期方案改用服务端 session 存储（如 SQLite sessions 表）以支持吊销。

---

### 【中】8. 上传照片公开可访问 + 无上传配额

1. **公开访问**：`public/uploads` 直挂静态目录（app.js:46），任何人无需登录、无需 Cookie 即可拉取照片（实测 200）。文件名含 12 位 hex 随机串不可枚举，但所有打卡页面的 `<img src>` 都引用真实 URL——复制即分享，且**永久公开**。对「学习笔记照片」这类可能含个人信息的凭证，默认应鉴权。
2. **磁盘耗尽**：单人任务同一天可无限次打卡（设计如此），每次最多 3×10MB；无按用户/按日配额，登录用户可脚本化填满磁盘。

**修复建议**：上传文件移出 `public/`，经 `/api/photos/:name` 鉴权路由（校验该用户拥有对应打卡记录或同队可见）再返回；配额建议按用户每日 ≤ 20 张。

---

### 【低】9. 登录时序侧信道账号枚举

**位置**：`src/services/user.service.js:69-75`

账号不存在时直接返回（无 bcrypt 计算，~1ms），账号存在时执行 bcrypt（~50-100ms），响应时间差可用于探测账号是否注册。注册接口 409 本就泄露账号存在性（常见取舍，可接受），登录侧建议补齐：账号不存在时也执行一次假哈希比较（`bcrypt.compareSync(password, DUMMY_HASH)`）拉平耗时。

### 【低】10. 依赖漏洞

`npm audit`：3 个 moderate——`qs`（array-limit bypass / DoS via isBuffer），经 `body-parser → express@4.22.2` 传入。`npm audit fix` 需升 express@5（破坏性变更）。建议：锁依赖关注 advisory，在 Day 20 专项中评估 express 5 迁移或等待 qs 补丁回移；当前均需攻击者控制解析入参结构，实际可利用性有限。

### 【低】11. 账号探测与邀请骚扰

- `POST /api/team/invites` 对不存在账号返回 404「该账号不存在」→ 可枚举注册账号（结合发现 3 无速率限制时批量探测）；
- 任意登录用户可向任意账号发组队邀请（站内通知），存在骚扰面——「同一时刻仅一条待处理发出邀请」的约束已部分缓解。
- 加上速率限制后风险可控，可不单独改动。

---

## 三、已做对的事（保持）

| 项 | 评价 |
|---|---|
| SQL 注入防护 | 全部语句参数化，动态 WHERE 仅拼接白名单片段 ✅ |
| XSS 防护 | EJS 全量 `<%=` 输出，`<%->` 仅用于 include；前端 6 个脚本 innerHTML 渲染抽查全部有 escapeHtml ✅ |
| 越权（IDOR） | 所有查询按 user_id / team_id 过滤；跨队/他人资源统一 404 不泄露存在性 ✅ |
| 开放重定向 | `safeNext` 拒绝 `//`、`/\` 前缀，属性注入被 EJS 转义阻断 ✅（实测逻辑审查通过） |
| 密码存储 | bcrypt cost 10 ✅ |
| 上传文件名 | 服务端生成（时间戳+6 字节随机），不信任原始文件名，扩展名白名单映射 ✅ |
| 信息泄露 | 错误统一兜底不回栈；`publicUser` 剥离 password_hash；git 历史无 .db/.env/uploads 泄露 ✅ |
| 自检 | dbCheck.js 38 项验收测试 ✅ |

---

## 四、加固路线图（建议并入 Day 20 专项）

**上线前必须（P0）**
1. 强制随机 SESSION_SECRET，未设置拒绝启动（发现 1）
2. 管理员初始密码走环境变量 + 实现改密功能（发现 2）
3. 登录/注册速率限制 + bcrypt 异步化（发现 3）
4. `helmet` + `app.disable('x-powered-by')`（发现 6）

**上线后两周内（P1）**

5. 上传魔数校验 + nosniff（发现 4，nosniff 随 helmet 一并解决）
6. CSRF token（发现 5）
7. Cookie Secure 标志 + maxAge 收敛（发现 7）
8. 照片鉴权访问 + 上传配额（发现 8）

**择机（P2）**

9. 登录时序拉平（发现 9）、依赖升级评估（发现 10）

---

*本报告由白盒审计 + 本地动态验证产出；动态测试产生的数据（3 个测试账号、1 条打卡探针）已全部清理，测试服务已停止。*

---

## 五、复审记录（2026-09-12 第二轮，修复后复查）

对修复后的工作区代码（14 个文件变更 + 新增 `src/middleware/rateLimit.js`）做了完整 diff 复审 + 动态回归，**dbCheck 41 项自检全部通过**。

### 已修复并实测验证 ✔

| 原发现 | 修复方式 | 验证结果 |
|---|---|---|
| 1 严重 · 默认 SESSION_SECRET | 生产未设置密钥直接拒绝启动；开发环境每次启动随机临时密钥 | 旧硬编码密钥伪造的会话 → 401；`NODE_ENV=production` 无密钥 → fatal 退出 |
| 2 严重 · admin/admin123 无改密 | 新增 `/api/auth/change-password` + 个人中心改密表单；种子密码可由 `ADMIN_PASSWORD` 覆盖 | 改密后：旧密码登录 401、新密码 200、其他会话全部 401、当前会话续期存活 |
| 3 高 · 无速率限制 | 自研内存限流中间件：登录 10 次/15 分/IP、注册 5 次/时/IP、打卡 30 次/日/用户；bcrypt 改异步 | 第 11 次错误登录 → 429 + Retry-After |
| 4 中 · 上传仅信 Content-Type | 落盘后文件头魔数校验（PNG 8 字节 / JPEG 3 字节），非图片删除并 400 | HTML 伪装 image/png → 400 拒绝；真实 PNG → 201 通过 |
| 6 中 · 缺安全响应头 | nosniff / X-Frame-Options: DENY / Referrer-Policy | 响应头实测在位（CSP/HSTS 仍留待后续） |
| 7 中 · 会话管理 | Secure 标志按 HTTPS 动态开启；改密推进 `session_not_before` 作废全部旧会话（含被盗 Cookie） | 见发现 2 验证；老库自动迁移新列 |
| 8 中 · 磁盘耗尽（后半） | 打卡每日 30 次封顶（单人 + 双人各一档） | 限流键按用户，逻辑复审通过 |

### 本轮新发现（建议尽快补）

- **`/api/auth/change-password` 未挂限流**：持有被盗会话的攻击者可对该接口无限次暴破旧密码（每次都真实跑 bcrypt，却不受登录限流约束），成功后改密踢掉真主人、永久接管账号。建议挂一个按用户的严限流（如 5 次/15 分），或复用 loginLimiter。
- 小可用性问题：登录限流对成功登录同样计数，连续正常登录 10 次也会被锁 15 分钟；可改为只计失败。

### 仍遗留（计划内/低优先级）

- 打卡照片仍存 `public/uploads` 公开可访问（原发现 8 前半，鉴权访问未做）；
- `X-Powered-By: Express` 未关闭；CSP / HSTS 未加；
- CSRF token（Day 20 计划）、登录时序账号枚举（P2）、npm audit 3 moderate（P2）；
- ⚠ 运维提醒：`ADMIN_PASSWORD` 仅影响**新建库**；已存在的库（含当前 data/app.db）管理员仍是 admin123，请立即用新的改密功能改掉。

**复审结论：P0 全部修复且实现质量良好，未发现回归；补上 change-password 限流即可达到本报告的上线标准（P1 项可按路线图继续）。**

---

## 六、终审记录（2026-09-12 第三轮，继续开发前最终检验）

本轮增量仅两处：`rateLimit.js` 新增 `createFailureRateLimiter`（仅计失败，成功响应在 `finish` 时退还配额，429 分支先于监听注册不会自退款）、`auth.routes.js` 为 change-password 挂按用户 5 次/15 分限流并让登录限流只计失败。

| 终审项 | 结果 |
|---|---|
| change-password 暴破旧密码 → 6 连发 | ✅ 5×400 后 429 |
| 登录误锁修复 → 12 连正确登录 | ✅ 全部 200，正常用户不再被锁 |
| 暴破拦截 → 11 连错误密码 | ✅ 10×401 后 429，锁定中正确密码也拒（固定窗口标准行为） |
| 页面冒烟 9 条路由 | ✅ 公开页 200、鉴权页 302、未知路由 404 |
| dbCheck 自检 | ✅ 41/41 |

**终审结论：达到上线安全标准，可继续后续功能开发。** 移交清单（按优先级）：
1. 【运维，上线时】现有库 admin 仍是 admin123，立即用改密功能改掉；设置 `SESSION_SECRET` 与 `ADMIN_PASSWORD` 环境变量；HTTPS 部署时确认 Secure Cookie 生效。
2. 【P1，功能开发中顺带】打卡照片鉴权访问；`app.disable('x-powered-by')` + CSP/HSTS；CSRF token（原计划 Day 20）。
3. 【P2】登录时序拉平、npm audit 依赖升级评估。
