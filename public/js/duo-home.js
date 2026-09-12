/* 首页「双人共同协作任务」板块脚本（Day 8）
   GET /api/team → 未组队：引导去 /duo 组队；已组队：搭档速览卡。
   Day 9 将在此接入 /api/duo-tasks 共同任务预览。 */
(function () {
  'use strict';

  var body = document.getElementById('duoHomeBody');
  if (!body) return; // 未登录：服务端已渲染登录引导

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
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

  function render(view) {
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
      body.innerHTML =
        '<div class="duo-home-partner">' +
          '<span class="avatar-sm" aria-hidden="true">' + escapeHtml(String(p.nickname).slice(0, 1)) + '</span>' +
          '<div class="duo-home-partner-main">' +
            '<p class="duo-home-partner-name">与 <strong>' + escapeHtml(p.nickname) + '</strong> 搭档中</p>' +
            '<p class="muted">共同任务发布将在 Day 9 上线，先去双人广场看看。</p>' +
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

  fetch('/api/team')
    .then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    })
    .then(function (r) {
      if (!r.ok) throw new Error(r.body.message);
      render(r.body);
    })
    .catch(function () {
      body.innerHTML = emptyState('加载失败', '网络异常，请刷新重试。', '刷新页面', '/');
    });
})();
