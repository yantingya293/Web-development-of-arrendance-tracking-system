/* 首页「双人共同协作任务」板块脚本（Day 8 组队 / Day 9 共同任务预览）
   GET /api/team + GET /api/duo-tasks → 未组队：引导去 /duo 组队；已组队：搭档速览 +
   共同任务预览（进行中优先，最多 3 条）与「进入广场」入口。 */
(function () {
  'use strict';

  var body = document.getElementById('duoHomeBody');
  if (!body) return; // 未登录：服务端已渲染登录引导

  var STATUS_LABELS = { unstarted: '未开始', in_progress: '进行中', completed: '已完成', overdue: '已逾期' };

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function request(method, url) {
    return fetch(url, { method: method }).then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    });
  }

  function emptyState(title, hint, actionText, actionHref) {
    return (
      '<div class="empty-state">' +
        '<span class="empty-illustration" aria-hidden="true"></span>' +
        '<p class="empty-title">' + title + '</p>' +
        '<p class="empty-hint muted">' + hint + '</p>' +
        (actionHref ? '<a class="btn btn-outline btn-sm" href="' + actionHref + '">' + actionText + '</a>' : '') +
      '</div>'
    );
  }

  function renderTaskPreview(t) {
    var done = 0;
    if (t.today) {
      if (t.today.a) done++;
      if (t.today.b) done++;
    }
    return (
      '<li class="duo-home-task">' +
        '<span class="tag tag-st-' + t.status + '">' + (STATUS_LABELS[t.status] || t.status) + '</span>' +
        '<span class="duo-home-task-title">' + escapeHtml(t.title) + '</span>' +
        (t.status !== 'completed' ? '<span class="duo-home-today' + (done === 2 ? ' all' : '') + '">今日 ' + done + '/2</span>' : '') +
      '</li>'
    );
  }

  function render(view, tasks) {
    if (view.invites && view.invites.length) {
      body.innerHTML =
        '<div class="duo-home-notice">' +
          '你有 <strong>' + view.invites.length + '</strong> 个组队邀请待处理' +
          '<a class="btn btn-primary btn-sm" href="/duo">去处理</a>' +
        '</div>' +
        emptyState('暂未绑定学习搭档', '接受邀请即可开始双人协作。', '前往处理', '/duo');
      return;
    }
    if (view.team) {
      var p = view.team.partner;
      var listHtml = tasks && tasks.length
        ? '<ul class="duo-home-tasks">' + tasks.slice(0, 3).map(renderTaskPreview).join('') + '</ul>' +
          (tasks.length > 3 ? '<p class="muted duo-home-more">还有 ' + (tasks.length - 3) + ' 个任务…</p>' : '')
        : '<p class="muted duo-home-more">还没有共同任务，去广场和 ' + escapeHtml(p.nickname) + ' 创建第一个吧。</p>';
      body.innerHTML =
        '<div class="duo-home-partner">' +
          '<span class="avatar-sm" aria-hidden="true">' + escapeHtml(String(p.nickname).slice(0, 1)) + '</span>' +
          '<div class="duo-home-partner-main">' +
            '<p class="duo-home-partner-name">与 <strong>' + escapeHtml(p.nickname) + '</strong> 搭档中</p>' +
            listHtml +
          '</div>' +
          '<a class="btn btn-outline btn-sm" href="/duo">进入广场</a>' +
        '</div>';
      return;
    }
    body.innerHTML = emptyState(
      '暂未绑定学习搭档',
      view.outgoing
        ? '已向 ' + escapeHtml(view.outgoing.to_nickname) + ' 发出邀请，等待对方处理。'
        : '绑定学习搭档，共建共同任务、双方打卡互相监督。',
      '去组队',
      '/duo'
    );
  }

  request('GET', '/api/team')
    .then(function (r) {
      if (!r.ok) throw new Error(r.body.message);
      var view = r.body;
      // 已组队才拉任务；未组队直接渲染（/api/duo-tasks 对未组队返回 409）
      if (!view.team) return { view: view, tasks: [] };
      return request('GET', '/api/duo-tasks').then(function (rt) {
        return { view: view, tasks: rt.ok ? rt.body.tasks || [] : [] };
      });
    })
    .then(function (r) {
      render(r.view, r.tasks);
    })
    .catch(function () {
      body.innerHTML = emptyState('加载失败', '网络异常，请刷新重试。', '刷新页面', '/');
    });
})();
