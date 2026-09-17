# 学习打卡网页 (Study Check-in Web)

支持**单人学习任务打卡**与**双人共同任务协作**的轻量化网页。覆盖六大核心能力：学习问题 / 单人任务罗列、双人任务共建、个人照片打卡、双人联合打卡、全员成果查看、双人协作数据统计。

## 技术栈

- 前端：HTML5 + CSS3 + 原生 JavaScript（EJS 服务端模板渲染）
- 后端：Node.js + Express
- 数据库：SQLite（better-sqlite3，本地文件）
- 鉴权：Cookie + Session + bcrypt 密码哈希
- 实时同步：轮询（每 10s 拉取进度，后续里程碑引入）

## 快速开始

```bash
npm install
npm start
```

浏览器访问 <http://localhost:3000>。

开发模式（文件变更自动重启）：

```bash
npm run dev
```

### 内置测试账号（种子数据）

| 角色 | 账号 | 密码 |
| --- | --- | --- |
| 管理员 | `admin` | 开发环境默认 `admin123`（仅限本地开发；用 `ADMIN_PASSWORD` 覆盖，生产未设置时自动生成一次性随机密码并打印在启动日志里） |

普通用户在注册页自助注册即可。

## 环境变量

复制 `.env.example` 为 `.env` 后按需修改（本地默认值可直接运行，无需 .env）。

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 服务端口 |
| `SESSION_SECRET` | 无 | Session 密钥，部署时必须设置为随机长字符串 |
| `DB_PATH` | `data/app.db` | SQLite 数据库文件路径（Day2 引入） |

## 目录结构

```
├── app.js                 # 服务入口
├── views/                 # EJS 模板
│   ├── partials/          # 公共布局（header / footer）
│   │   └── components/    # 通用组件（loading / empty / toast）
│   └── index.ejs          # 首页四板块骨架
├── public/
│   ├── css/               # 样式（theme.css 统一主题与设计变量）
│   ├── js/                # 前端脚本（app.js 公共交互与首页动态 / auth.js 认证表单 / tasks.js 单人任务板块 / checkin.js 打卡表单 / history.js 历史记录页 / me.js 个人中心 / admin.js 管理后台）
│   └── uploads/           # 打卡照片与头像上传目录（multer 落盘，git 忽略；头像在 uploads/avatars/）
└── src/
    ├── routes/            # 路由层
    ├── services/          # 业务逻辑层
    ├── db/                # 数据库（schema / 连接 / seed）
    └── middleware/        # 鉴权等中间件
```

## 项目里程碑（21 工作日）

- M0 立项与基建（Day 1–3）：脚手架、数据库、用户系统
- M1 单人核心闭环（Day 4–7）：单人任务 + 打卡 + 历史
- M2 双人核心闭环（Day 8–12）：组队 / 共同任务 / 双方打卡 / 进度可视化 / 成果展示
- M3 扩展与打磨（Day 13–18）：数据统计 / 个人中心 / 响应式 / UI
- M4 验收与交付（Day 19–21）：测试 / 安全 / 文档 / 部署

当前进度：**Day 18 · 照片鉴权访问（P1 安全收口，M3 收官）**。

- ✅ Day 2：SQLite 数据层 —— 七张表（users / tasks / checkins / teams / duo_tasks / duo_checkins / notifications）+ `src/db/db.js` 封装 + 种子数据；运行 `node dbCheck.js` 可验证（检查项随里程碑递增，Day 15 为 58 项）
- ✅ Day 3：用户系统 —— 注册 / 登录 / 登出 / `me` 接口，bcrypt 密码哈希，Cookie+Session（7 天，httpOnly / SameSite=Lax），`requireAuth` / `requireAdmin` 中间件，登录 / 注册页面（客户端 + 服务端双重校验），首页用户区与登出，`/admin` 后台占位页（仅管理员）
- ✅ Day 4：前端基础布局 + 首页骨架 —— `theme.css` 补全设计变量（主色 / 字号 / 间距 / 阴影 / 语义色）与响应式断点（900 / 768 / 480px）；首页四板块（左上单人任务 / 右上双人任务 / 中下左打卡表单 / 中下右实时动态）；通用组件 `loading` / `empty` / `toast`（`views/partials/components/`，Toast 经 `window.showToast()` 调用）；顶栏用户菜单可点击展开（个人中心 / 管理后台 / 登出，ESC 与点击外部收起）；`/duo`、`/gallery`、`/history` 导航占位页可达
- ✅ Day 5：单人任务模块 —— `tasks` 表新增 `category` 列（daily 每日任务 / weekly 每周重点 / question 学习问题，老库自动迁移回填）；`/api/tasks` 五个接口（列表 / 新建 / 更新 / 状态流转 / 删除，全部登录保护）；首页单人任务板块接入真实数据：分类筛选 tabs（带计数）、任务卡片（分类 + 状态标签、截止倒计时、完成态划线）、新建 / 编辑弹窗（分类药丸单选、字段校验与错误回显）、删除确认、状态一键流转（开始 / 完成 / 重新打开）；过截止且未完成的任务在读取时自动标记「已逾期」（`overdue` 不可手动设置）；公共任务（管理员发布）全员可见，普通用户只读
- ✅ Day 6：单人打卡模块 —— `/api/checkins`（`GET` 我的打卡记录，`POST` multipart 提交打卡，全部登录保护）；照片上传走 multer 落盘 `public/uploads/`（服务端生成文件名，仅 JPG / PNG、单张 ≤ 10MB、最多 3 张，业务校验失败自动清理残留文件）；打卡校验：任务须为本人或公共的单人任务（他人任务按不存在处理）、至少 1 张照片、备注 ≤ 500 字；提交晚于任务截止自动记 `is_overdue`（逾期仍可补打卡）；未开始的任务打卡后自动转「进行中」；首页打卡表单接入真实数据：任务下拉按分类分组（排除已完成、带「今日已打卡 / 已逾期可补打卡」标记）、照片本地预览与移除、字段校验与错误回显；任务卡片新增「打卡」入口（点击自动选中任务并滚动到表单），打卡成功后任务列表联动刷新
- ✅ Day 7：历史记录模块（M1 收尾）—— `/api/checkins` 增加 `category` / `date` 筛选并返回符合条件的 `total`；新增 `/api/checkins/stats`（累计 / 今日 / 连续打卡天数 / 近 7 天逐日次数）；`/history` 历史记录页：统计卡（累计 / 今日 / 连续天数）+ 打卡列表按日期分组（今天 / 昨天 / 周几友好标注、逾期补卡标记、照片缩略图点击放大）+ 分类与日期筛选 + 「加载更多」分页；首页「实时打卡动态」接入真实数据（本人最近 10 条打卡，刷新按钮生效，打卡成功后联动刷新）；个人中心接入数据速览与近 7 天打卡热度条（4 档着色，悬停显示次数）
- ✅ Day 8：双人组队模块（M2 开篇）—— 站内通知服务 `notification.service.js`（notifications 表落地，类型：invite / team_unbound / partner_checkin）；`/api/team` 五个接口（组队全貌 / 按账号发邀请 / 接受 / 拒绝 / 解绑，全部登录保护）；组队规则：一个用户同一时刻最多一支 active 队伍（唯一索引 + 应用层双重校验）、同一时刻仅一个待处理的发出邀请、双向邀请自动引导去处理、接受时二次校验双方未组队（并发兜底）、接受后其余邀请自动过期；解绑改 `teams.status = unbound` 保留历史并向搭档发通知；`/duo` 双人协作广场页上线（收到的邀请接受 / 拒绝、搭档卡、按账号邀请表单、解除绑定）；首页双人板块接入组队数据（待处理邀请提醒 / 搭档速览 / 去组队引导）
- ✅ Day 9：双人共同任务模块 —— `/api/duo-tasks` 五个接口（列表 / 新建 / 更新 / 状态流转 / 删除，全部登录保护且需 active 队伍）；「共建」语义：队伍任一成员都可创建、编辑、流转与删除；`division_a` / `division_b` 对应队伍双方分工（≤ 100 字符，列表返回时附带成员昵称归属）；截止时间复用单人任务归一化逻辑；状态机与单人一致（`overdue` 只由系统按截止时间自动标记）；解绑后任务保留在库但不再展示；`/duo` 页新增共同任务板块：任务卡片（双方分工区 / 截止倒计时 / 状态标签）、新建 / 编辑弹窗（分工字段按「你 / 搭档昵称」标注归属）、删除确认、状态一键流转；首页双人板块升级为共同任务预览（进行中优先，最多 3 条）
- ✅ Day 10：双人打卡模块 —— 照片上传抽公共中间件 `src/middleware/upload.js`（单人 / 双人打卡复用同一套落盘与清理规则）；`/api/duo-checkins` 两个接口（队伍打卡记录双方可见 + multipart 提交打卡）；打卡规则：同一成员对同一共同任务每日最多一次（应用层预检 + `duo_checkins` 唯一索引兜底）、照片 1–3 张与备注 ≤ 500 字（复用单人校验）、未开始任务打卡后自动转进行中、已完成任务不可打卡（overdue 可补打卡）、每次打卡向搭档发 `partner_checkin` 站内通知；任务列表返回双方今日打卡进度（`today.a` / `today.b` 带打卡时间）；`/api/notifications`（最新通知 + 全部已读）；`/duo` 页新增：任务卡片今日进度行（「XX ✓ 14:30 · XX 待打卡」）与「打卡」入口（今日已打卡显示标记）、打卡弹窗（任务名 + 我的分工提醒 + 照片预览）、双人打卡记录区（按任务筛选、双方照片凭证与备注）、协作动态区（搭档打卡 / 邀请 / 解绑通知，未读圆点 + 全部已读）；首页共同任务预览增加「今日 n/2」进度角标；`dbCheck.js` 验收脚本同步升级至 38 项检查（新增 Day 7–10 服务层探针，事务内回滚不落盘）
- ✅ Day 11：双人协作进度可视化（M2）—— `/api/duo-checkins/stats` 队伍协作统计（任务状态分布 / 双方打卡累计与相对视角 / 今日双方进度 / 连续协作天数（双方同日都打卡的连续自然日，口径与单人连续打卡一致）/ 近 7 天逐日双方次数）；`/duo` 页新增「协作数据」板块（未组队自动隐藏）：四张统计卡（连续协作 / 累计双人打卡 / 我的打卡 / 搭档打卡）+ 共同任务分布摘要行 + 近 7 天双方打卡对比柱状图（柱高按 7 天峰值等比缩放、柱顶数字、今日列高亮、图例区分我 / 搭档，横向可滚动）；任务与打卡的增删流转均联动刷新统计；`dbCheck.js` 升级至 43 项（新增协作统计探针：分布 / 累计 / 今日 / 连续天数 + 解绑后 409）
- ✅ Day 12：全员打卡广场（M2 收官）—— 新增 `src/services/gallery.service.js` + `/api/gallery` 两个接口（登录保护）：`GET /api/gallery` 全站打卡流（单人 `checkins` 与双人 `duo_checkins` 用 UNION ALL 合并，`kind` 字段区分来源，时间倒序 + `scope=solo|duo` 筛选 + limit/offset 分页 + `total`）、`GET /api/gallery/stats`（全站累计 / 今日打卡 / 今日参与人数去重）；`/gallery` 从占位页转为真实页面（登录可见）：三张统计卡 + 来源筛选 tabs + 打卡卡片流（头像昵称 / 任务标题 / 单人·共同任务标签 / 逾期补卡标记 / 友好时间 / 备注 / 照片缩略图点击查看）+「加载更多」分页；双人打卡在解绑后作为历史成果继续展示；`dbCheck.js` 升级至 45 项（合并流 / 倒序 / scope 拆分 / 统计探针，真实库含历史数据故全部相对断言）
- ✅ Day 13：个人中心数据看板（M3 开篇）—— 新增 `src/services/stats.service.js` + `GET /api/stats/dashboard?month=YYYY-MM`（登录保护，非法月份回退当前月）：任务完成率与状态分布（只算自己的单人任务，公共任务与双人任务不计入；`completion_rate` 整数百分比，无任务为 null）、分类分布（daily / weekly / question 数量）、月度打卡日历（单人 `submitted_at` 与双人 `day` 列按日合并聚合，含当月合计与有记录天数）、单人 / 双人打卡累计；`/me` 页新增「学习数据统计」板块：任务完成率卡（大数字 + 进度条 + 已完成 x/y 明细）、任务分类分布卡（三行占比条）、打卡日历卡（周日开头月历网格、4 档着色复用热度口径、今日描边、上/下月翻页且不超过当前月、月度摘要行）；无任务时显示创建引导；`dbCheck.js` 升级至 47 项（分布 / 完成率 / 日历合并 / 历史月与非法月份回退探针）
- ✅ Day 14：个人设置与管理员后台（M3）—— 个人资料：`users.avatar_path` 正式启用，`PATCH /api/auth/profile`（改昵称，沿用注册的 1–20 字符规则）、`POST /api/auth/avatar`（multipart 单图，字段 `avatar`，JPG / PNG ≤ 2MB，落 `public/uploads/avatars/`，MIME 白名单 → 文件头魔数双重校验）、`DELETE /api/auth/avatar`；换头像自动清理旧文件、验证失败删除残留，头像写入只接受 `uploads/` 前缀；头像在前端全站生效（顶栏用户菜单 / 个人中心 / 双人广场搭档卡与邀请卡，`window.avatarInner` 统一渲染，无头像回落昵称首字）；`/me` 页新增「个人设置」（昵称表单 + 更换 / 移除头像）与「我的搭档」（组队信息卡：搭档头像昵称账号 + 绑定时间 + 去管理，未组队给出组队引导）；管理员后台 `/admin` 从占位页升级为真实页面：新增 `src/services/admin.service.js`（`overview` 全站统计 / `listUsers` 用户列表含自建任务数、单人 / 双人打卡数、组队状态）、`src/routes/admin.routes.js`（`GET /api/admin/overview`、`GET /api/admin/users` 支持关键词搜索与分页、`GET/POST/DELETE /api/admin/public-tasks` 公共任务管理，全部 `requireAdmin`），`/admin` 页呈现八张统计卡 + 用户表格（搜索 / 重置 / 分页）+ 公共任务发布表单与列表（删除二次确认，概览计数联动刷新）；`src/middleware/upload.js` 抽出 `uploadAvatar` / `fileHasImageMagic` / `removeStoredFile`，`multerErrorResponse` 支持自定义字段与文案；`dbCheck.js` 升级至 52 项（昵称校验与更新、头像路径写入与清除、概览统计口径、用户搜索分页、公共任务 CRUD 与越权拦截探针）
- ✅ Day 15：安全加固专项（M3）—— Strix 扫描报告遗留短期项全部落地：单人打卡状态副作用收权（普通用户打卡公共任务只写打卡记录，不再把全员可见的任务从「未开始」推进为「进行中」，仅任务主人 / 管理员可触发状态流转；双人任务因队伍双方共有维持任一成员可推进）；注册接口时序 / 并发 oracle 收口（重复账号路径先做等量 bcrypt 比较再返回 409，并发撞 `users.account` 唯一索引的竞态与预检路径返回完全同形的 409，抹平「账号是否存在」的探测面）；上传生命周期闭环（删除单人任务 / 公共任务 / 共同任务时收集其下打卡照片并逐个清理磁盘文件，`upload.js` 新增 `removeStoredFiles` 批量尽力而为删除）；列表分页参数取整钳制（`limit` / `offset` 统一 `Math.trunc` + 上下界钳制，`1.7` / `'abc'` / 负数不再让 SQLite LIMIT 报 500，覆盖 gallery / 通知 / 管理员用户列表）；依赖告警清零（`overrides` 将 qs 钉到修复版 6.16.0，`npm audit` 归零）；登录回跳 `safeNext` 导出供测试；`dbCheck.js` 升级至 58 项（状态收权 / 回跳消毒 7 组变体 / 重复注册同形等时 / 真实文件清理×2 / 分页取整钳制探针）
- ✅ Day 16：响应式适配专项（M3）—— 真实浏览器实测（375 / 768 / 1280 三档视口逐页截图：登录 / 首页 / 双人广场 / 打卡广场 / 历史记录 / 个人中心 / 管理员后台）后落地五项修复：≤600px 顶栏两行化（品牌 + 用户区一行，导航独占一行横向滑动，替代原先三段互相挤压截断的布局）；全局 `.btn` 文案 `white-space: nowrap`（修掉窄屏下「登录 / 注册」「+ 新建任务」竖排折行）；导航横向滚动条隐藏（`scrollbar-width: none` + `::-webkit-scrollbar`，保留触屏滑动能力）；`public/js/app.js` 启动时将当前页对应的 `.nav a.active` `scrollIntoView` 居中（窄屏导航滑不动到当前项的问题）；≤480px 统计卡收窄内边距并缩小数值 / 文案字号（「全站累计打卡」等长标签不再折成三行）；`.data-table` 加 `min-width: 720px`（窄屏下由 `.table-wrap` 内部横向滚动，列宽不被压缩到不可读）。回归确认 768 / 1280 桌面布局无变化
- ✅ Day 17：UI 打磨 · 深色模式（M3）—— 全站深色主题：`theme.css` 新增 `[data-theme="dark"]` 变量覆盖（背景 / 卡片走 slate 深色阶，语义色整体提亮保证对比度，阴影加重成层次，`color-scheme` 声明让输入框 / 日期选择等原生控件跟随主题）；把高频硬编码描边色 `#bfdbfe`（15 处）收编为 `--primary-border` 变量供深色覆盖，并为 alert 提示条、管理员徽章、分类 / 状态 / 双人标签、双人邀请提醒条等 pastel 配色组件补齐深色阶；顶栏新增主题切换按钮 `.theme-toggle`（图标随主题同步 🌙 / ☀️，`aria-label` 同步更新），`header.ejs` 头部内联脚本在首屏绘制前定主题（localStorage `checkin-theme` 手选优先，否则跟随系统 `prefers-color-scheme`，杜绝深色用户闪白 FOUC），`app.js` 负责切换交互与持久化；清理死代码 `views/coming-soon.ejs`（确认全站无引用）。浏览器实测（768 宽）：深色下登录 / 首页 / 广场 / 个人中心日历与表单原生控件全部协调，浅→深→浅双向切换、刷新持久化、图标与无障碍标签同步逐项通过，浅色主题观感与此前完全一致
- ✅ Day 18：照片鉴权访问（P1 安全收口，M3 收官）—— 上传文件整体移出公开静态目录：存储目录从 `public/uploads` 迁至 `data/uploads`（`.gitignore` 既有 `uploads/` 通配继续生效，库内相对路径与访问 URL 保持 `uploads/...` 不变，前端零改动）；`app.js` 在 public 静态之前挂载 `app.use('/uploads', requireAuth, express.static(UPLOAD_DIR))`——打卡照片与头像必须登录后才能访问（借力 `express.static` 自带的路径穿越防护，且优先于 public 挂载，旧文件残留也不会被直出）；`upload.js` 启动时把老 `public/uploads` 递归合并迁移到新目录（幂等、同名不覆盖，子目录逐文件搬移避免整目录跳过导致文件被清理逻辑误删），老目录迁移后删除；`removeStoredFile` 清理基准同步改到新目录；实测通过：未登录访问照片 / 头像目录 401、登录后 200 `image/png`、`/uploads/../` 穿越探测 404、真实 multipart 上传落盘新目录、历史照片自动迁移完好、幂等重跑无副作用；`dbCheck.js` 照片清理探针改用新目录，58 项全过
- ✅ Day 19：HTTP 层验收套件（M4 开篇）—— 新增 `httpCheck.js`（`npm test`）：以临时数据库 + 独立端口拉起真实 `app.js` 子进程，用 Node 内置 fetch / FormData / Blob（零新依赖）在真实 HTTP 栈上做端到端验收，与 `dbCheck.js` 服务层探针互补；19 项覆盖：页面可达、安全响应头基线（nosniff / X-Frame-Options / Referrer-Policy）、鉴权守卫（未登录 401 / 未知 API 404）、注册（成功 / 表单 400 / 重复 409 同形 + 等时≥20ms）、登录（失败统一文案 / 成功下发 Cookie / me 回读）、单人任务 CRUD 与状态机（overdue 不可手动设置）、multipart 打卡上传 + 照片鉴权（未登录 401 / 登录 200 image/png）、广场分页取整钳制、双人全链路（邀请→接受→共同任务→双人打卡→协作统计）、管理员守卫（403/200）与公共任务管理、登录回跳消毒、登出后会话失效、临时库与测试照片用后即清；套件暴露并修复真实弱点：登出原本仅清除 Cookie，被盗 Cookie 副本可重放复用——现登出时推进 `session_not_before` 作废该账号全部已签发会话（与改密同一机制，`user.service.bumpSessionNotBefore`）
