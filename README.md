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
| 管理员 | `admin` | `admin123`（首次登录后请修改） |

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
│   ├── js/                # 前端脚本（app.js 公共交互 / auth.js 认证表单 / tasks.js 单人任务板块 / checkin.js 打卡表单）
│   └── uploads/           # 打卡照片上传目录（multer 落盘，git 忽略）
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

当前进度：**Day 6 · 单人打卡模块上线（M1 进行中）**。

- ✅ Day 2：SQLite 数据层 —— 七张表（users / tasks / checkins / teams / duo_tasks / duo_checkins / notifications）+ `src/db/db.js` 封装 + 种子数据；运行 `node dbCheck.js` 可验证（26 项检查）
- ✅ Day 3：用户系统 —— 注册 / 登录 / 登出 / `me` 接口，bcrypt 密码哈希，Cookie+Session（7 天，httpOnly / SameSite=Lax），`requireAuth` / `requireAdmin` 中间件，登录 / 注册页面（客户端 + 服务端双重校验），首页用户区与登出，`/admin` 后台占位页（仅管理员）
- ✅ Day 4：前端基础布局 + 首页骨架 —— `theme.css` 补全设计变量（主色 / 字号 / 间距 / 阴影 / 语义色）与响应式断点（900 / 768 / 480px）；首页四板块（左上单人任务 / 右上双人任务 / 中下左打卡表单 / 中下右实时动态）；通用组件 `loading` / `empty` / `toast`（`views/partials/components/`，Toast 经 `window.showToast()` 调用）；顶栏用户菜单可点击展开（个人中心 / 管理后台 / 登出，ESC 与点击外部收起）；`/duo`、`/gallery`、`/history` 导航占位页可达
- ✅ Day 5：单人任务模块 —— `tasks` 表新增 `category` 列（daily 每日任务 / weekly 每周重点 / question 学习问题，老库自动迁移回填）；`/api/tasks` 五个接口（列表 / 新建 / 更新 / 状态流转 / 删除，全部登录保护）；首页单人任务板块接入真实数据：分类筛选 tabs（带计数）、任务卡片（分类 + 状态标签、截止倒计时、完成态划线）、新建 / 编辑弹窗（分类药丸单选、字段校验与错误回显）、删除确认、状态一键流转（开始 / 完成 / 重新打开）；过截止且未完成的任务在读取时自动标记「已逾期」（`overdue` 不可手动设置）；公共任务（管理员发布）全员可见，普通用户只读
- ✅ Day 6：单人打卡模块 —— `/api/checkins`（`GET` 我的打卡记录，`POST` multipart 提交打卡，全部登录保护）；照片上传走 multer 落盘 `public/uploads/`（服务端生成文件名，仅 JPG / PNG、单张 ≤ 10MB、最多 3 张，业务校验失败自动清理残留文件）；打卡校验：任务须为本人或公共的单人任务（他人任务按不存在处理）、至少 1 张照片、备注 ≤ 500 字；提交晚于任务截止自动记 `is_overdue`（逾期仍可补打卡）；未开始的任务打卡后自动转「进行中」；首页打卡表单接入真实数据：任务下拉按分类分组（排除已完成、带「今日已打卡 / 已逾期可补打卡」标记）、照片本地预览与移除、字段校验与错误回显；任务卡片新增「打卡」入口（点击自动选中任务并滚动到表单），打卡成功后任务列表联动刷新

> Day 4 说明：实时动态板块仍为骨架占位，数据源在 Day 7 接入；「刷新」按钮目前演示 Loading → Empty 状态切换。
