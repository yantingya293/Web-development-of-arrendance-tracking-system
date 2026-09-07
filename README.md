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
├── public/
│   ├── css/               # 样式（theme.css 统一主题）
│   ├── js/                # 前端脚本
│   └── uploads/           # 打卡照片上传目录（git 忽略）
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

当前进度：**Day 1 · 项目脚手架已就绪**。
