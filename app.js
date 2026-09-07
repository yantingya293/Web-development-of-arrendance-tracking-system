const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// 后续里程碑将按 src/routes 下的模块挂载路由（如用户 /api/auth、任务 /api/tasks 等）
app.get('/', (req, res) => {
  res.render('index', { title: '学习打卡网页' });
});

app.listen(PORT, () => {
  console.log(`学习打卡网页已启动: http://localhost:${PORT}`);
});
