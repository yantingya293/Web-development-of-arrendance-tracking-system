/* 双人协作广场页脚本（Day 8：组队绑定区）
   GET /api/team → 渲染：收到的邀请（接受 / 拒绝）→ 当前搭档（解绑）→ 邀请表单（按账号发出）。
   Day 9 将在此文件追加「共同任务」板块，Day 10 追加「双方打卡」板块。 */
(function () {
  'use strict';

  var teamBody = document.getElementById('duoTeamBody');
  if (!teamBody) return; // 未登录：服务端已渲染登录引导

  var myAccount = teamBody.getAttribute('data-my-account') || '';
  var view = null; // GET /api/team 的最新结果 { team, invites, outgoing }

  /* ---------- 工具 ---------- */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function request(method, url, body) {
    var opts = { method: method };
    if (body !== undefined) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    });
  }

  /* ---------- 组队区渲染 ---------- */

  function renderInvites(invites) {
    return invites
      .map(function (inv) {
        return (
          '<div class="invite-card">' +
            '<div class="invite-info">' +
              '<span class="avatar-sm" aria-hidden="true">' + escapeHtml(String(inv.from_nickname).slice(0, 1)) + '</span>' +
              '<div>' +
                '<p class="invite-text"><strong>' + escapeHtml(inv.from_nickname) + '</strong>（' + escapeHtml(inv.from_account) + '）邀请你组队</p>' +
                '<p class="muted invite-time">发出时间：' + escapeHtml(inv.created_at) + '</p>' +
              '</div>' +
            '</div>' +
            '<div class="invite-actions">' +
              '<button type="button" class="btn btn-primary btn-sm" data-invite="' + inv.id + '" data-act="accept">接受</button>' +
              '<button type="button" class="btn btn-outline btn-sm" data-invite="' + inv.id + '" data-act="decline">拒绝</button>' +
            '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function renderTeamArea() {
    var html = '';

    if (view.invites && view.invites.length) {
      html += '<h3 class="duo-subtitle">收到的邀请</h3>' + renderInvites(view.invites);
    }

    if (view.team) {
      var p = view.team.partner;
      html +=
        '<div class="partner-card">' +
          '<div class="partner-info">' +
            '<span class="avatar" aria-hidden="true">' + escapeHtml(String(p.nickname).slice(0, 1)) + '</span>' +
            '<div>' +
              '<h3 class="partner-name">' + escapeHtml(p.nickname) + '</h3>' +
              '<p class="muted">账号：' + escapeHtml(p.account) + ' · 绑定于 ' + escapeHtml(view.team.bound_at) + '</p>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="btn btn-danger-ghost btn-sm" id="unbindBtn">解除绑定</button>' +
        '</div>';
    } else if (view.outgoing) {
      html +=
        '<div class="partner-card">' +
          '<div class="partner-info">' +
            '<span class="avatar-sm" aria-hidden="true">' + escapeHtml(String(view.outgoing.to_nickname).slice(0, 1)) + '</span>' +
            '<div>' +
              '<p class="invite-text">已向 <strong>' + escapeHtml(view.outgoing.to_nickname) + '</strong>（' + escapeHtml(view.outgoing.to_account) + '）发出邀请</p>' +
              '<p class="muted invite-time">等待对方处理；对方接受后即完成组队。</p>' +
            '</div>' +
          '</div>' +
          '<span class="tag tag-st-in_progress">等待处理</span>' +
        '</div>';
    } else {
      html +=
        '<form class="invite-form" id="inviteForm" novalidate>' +
          '<div class="form-group">' +
            '<label for="inviteAccount">对方账号</label>' +
            '<input type="text" id="inviteAccount" name="account" maxlength="24" placeholder="输入好友的登录账号，发出组队邀请" />' +
            '<p class="field-error" data-error-for="account"></p>' +
          '</div>' +
          '<button type="submit" class="btn btn-primary">发出邀请</button>' +
        '</form>' +
        '<p class="form-hint">还没有伙伴？把你的账号 <strong>' + escapeHtml(myAccount) + '</strong> 告诉同学，让对方注册后邀请你。';
    }

    teamBody.innerHTML = html;
    bindTeamEvents();
  }

  function loadTeamArea() {
    request('GET', '/api/team')
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        view = r.body;
        renderTeamArea();
      })
      .catch(function () {
        teamBody.innerHTML =
          '<div class="empty-state"><p class="empty-title">加载失败</p>' +
          '<p class="empty-hint muted">网络异常，请刷新重试。</p></div>';
      });
  }

  /* ---------- 组队区事件 ---------- */

  function bindTeamEvents() {
    var inviteForm = document.getElementById('inviteForm');
    if (inviteForm) {
      inviteForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = inviteForm.querySelector('#inviteAccount');
        var tip = inviteForm.querySelector('[data-error-for="account"]');
        if (tip) tip.textContent = '';
        if (!String(input.value || '').trim()) {
          if (tip) tip.textContent = '请填写对方账号';
          input.focus();
          return;
        }
        var btn = inviteForm.querySelector('button[type="submit"]');
        btn.disabled = true;
        request('POST', '/api/team/invites', { account: input.value.trim() })
          .then(function (r) {
            if (!r.ok) {
              if (tip && r.body.errors && r.body.errors.account) tip.textContent = r.body.errors.account;
              window.showToast(r.body.message || '邀请发送失败', 'error');
              return;
            }
            window.showToast(r.body.message || '邀请已发出', 'success');
            loadTeamArea();
          })
          .catch(function () {
            window.showToast('网络异常，请稍后再试', 'error');
          })
          .then(function () {
            btn.disabled = false;
          });
      });
    }

    var unbindBtn = document.getElementById('unbindBtn');
    if (unbindBtn) {
      unbindBtn.addEventListener('click', function () {
        if (!window.confirm('确定解除绑定吗？解除后该队伍的共同任务将归档，双方都可另行组队。')) return;
        unbindBtn.disabled = true;
        request('DELETE', '/api/team')
          .then(function (r) {
            if (!r.ok) {
              unbindBtn.disabled = false;
              window.showToast(r.body.message || '解绑失败', 'error');
              return;
            }
            window.showToast(r.body.message || '已解除绑定', 'success');
            loadTeamArea();
          })
          .catch(function () {
            unbindBtn.disabled = false;
            window.showToast('网络异常，请稍后再试', 'error');
          });
      });
    }
  }

  /* 收到 / 发出邀请卡片的接受与拒绝（事件委托） */
  teamBody.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-invite]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    btn.disabled = true;
    request('POST', '/api/team/invites/' + btn.getAttribute('data-invite') + '/' + act)
      .then(function (r) {
        if (!r.ok) {
          window.showToast(r.body.message || '操作失败', 'error');
          loadTeamArea(); // 邀请可能已被处理过，重载拿最新状态
          return;
        }
        window.showToast(r.body.message || '操作成功', 'success');
        loadTeamArea();
      })
      .catch(function () {
        btn.disabled = false;
        window.showToast('网络异常，请稍后再试', 'error');
      });
  });

  loadTeamArea();
})();
