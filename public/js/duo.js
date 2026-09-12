/* 双人协作广场页脚本（Day 8：组队绑定区；Day 9：共同任务板块）
   组队区：GET /api/team → 收到的邀请（接受 / 拒绝）→ 当前搭档（解绑）→ 邀请表单。
   任务区：GET /api/duo-tasks → 任务卡片（分工归属 / 截止 / 状态流转 / 编辑 / 删除）+ 新建弹窗。
   Day 10 将在此追加「双方打卡」板块。 */
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
        loadTasksArea();
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

  /* ---------- 共同任务板块（Day 9） ---------- */

  var STATUS_LABELS = { unstarted: '未开始', in_progress: '进行中', completed: '已完成', overdue: '已逾期' };

  var taskBody = document.getElementById('duoTaskBody');
  var newDuoTaskBtn = document.getElementById('newDuoTaskBtn');
  var taskModal = document.getElementById('duoTaskModal');
  var taskModalTitle = document.getElementById('duoTaskModalTitle');
  var taskModalClose = document.getElementById('duoTaskModalClose');
  var taskModalCancel = document.getElementById('duoTaskModalCancel');
  var taskForm = document.getElementById('duoTaskForm');
  var taskFormId = document.getElementById('duoTaskFormId');
  var taskFormError = document.getElementById('duoTaskFormError');
  var taskInputTitle = document.getElementById('duoTaskTitle');
  var taskSubmitBtn = taskForm ? taskForm.querySelector('button[type="submit"]') : null;

  var duoTasks = [];

  /** 'YYYY-MM-DD HH:MM:SS' 距今天的天数（>0 未来 / 0 今天 / <0 已过） */
  function deadlineDiffDays(deadline) {
    var dl = new Date(deadline.replace(' ', 'T'));
    if (isNaN(dl.getTime())) return null;
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var that = new Date(dl.getFullYear(), dl.getMonth(), dl.getDate());
    return Math.round((that - today) / 86400000);
  }

  function fmtDeadline(deadline) {
    var text = deadline.slice(0, 16);
    var diff = deadlineDiffDays(deadline);
    if (diff === null) return text;
    if (diff > 0) return text + '（剩 ' + diff + ' 天）';
    if (diff === 0) return text + '（今天截止）';
    return text + '（已过期 ' + -diff + ' 天）';
  }

  function nextStatusAction(status) {
    if (status === 'unstarted') return { label: '开始任务', status: 'in_progress' };
    if (status === 'in_progress') return { label: '标记完成', status: 'completed' };
    if (status === 'overdue') return { label: '标记完成', status: 'completed' };
    if (status === 'completed') return { label: '重新打开', status: 'unstarted' };
    return null;
  }

  function renderTaskCard(t) {
    var next = nextStatusAction(t.status);
    var meta = [];
    if (t.deadline) meta.push('截止 ' + fmtDeadline(t.deadline));
    var divisions =
      '<div class="duo-task-division">' +
        '<p><span class="duo-division-name">' + escapeHtml(t.members.a.nickname) + '</span>' +
          (t.members.a.division ? '：' + escapeHtml(t.members.a.division) : '：<span class="muted">未分工</span>') + '</p>' +
        '<p><span class="duo-division-name">' + escapeHtml(t.members.b.nickname) + '</span>' +
          (t.members.b.division ? '：' + escapeHtml(t.members.b.division) : '：<span class="muted">未分工</span>') + '</p>' +
      '</div>';
    return (
      '<article class="task-card duo-task-card' + (t.status === 'completed' ? ' completed' : '') + '" data-id="' + t.id + '">' +
        '<div class="task-card-main">' +
          '<div class="task-card-tags">' +
            '<span class="tag tag-duo">共同任务</span>' +
            '<span class="tag tag-st-' + t.status + '">' + (STATUS_LABELS[t.status] || t.status) + '</span>' +
          '</div>' +
          '<h3 class="task-card-title">' + escapeHtml(t.title) + '</h3>' +
          (t.description ? '<p class="task-card-desc">' + escapeHtml(t.description) + '</p>' : '') +
          divisions +
          (meta.length ? '<p class="task-card-meta muted">' + meta.join(' · ') + '</p>' : '') +
        '</div>' +
        '<div class="task-card-actions">' +
          (next ? '<button type="button" class="btn btn-sm" data-action="status" data-status="' + next.status + '">' + next.label + '</button>' : '') +
          '<button type="button" class="btn btn-sm" data-action="edit">编辑</button>' +
          '<button type="button" class="btn btn-sm btn-danger-ghost" data-action="delete">删除</button>' +
        '</div>' +
      '</article>'
    );
  }

  function renderTasksArea() {
    if (!view || !view.team) {
      newDuoTaskBtn.hidden = true;
      taskBody.innerHTML =
        '<div class="empty-state">' +
          '<span class="empty-illustration" aria-hidden="true"></span>' +
          '<p class="empty-title">组队后即可共建任务</p>' +
          '<p class="empty-hint muted">绑定搭档后，双方可以共同发布任务、划分分工并追踪进度。</p>' +
        '</div>';
      return;
    }
    newDuoTaskBtn.hidden = false;
    if (!duoTasks.length) {
      taskBody.innerHTML =
        '<div class="empty-state">' +
          '<span class="empty-illustration" aria-hidden="true"></span>' +
          '<p class="empty-title">还没有共同任务</p>' +
          '<p class="empty-hint muted">点击「新建共同任务」，和搭档一起规划学习目标。</p>' +
          '<button type="button" class="btn btn-primary btn-sm" data-action="create">新建共同任务</button>' +
        '</div>';
      return;
    }
    taskBody.innerHTML = duoTasks.map(renderTaskCard).join('');
  }

  function loadTasksArea() {
    if (!taskBody) return;
    if (!view || !view.team) {
      renderTasksArea();
      return;
    }
    request('GET', '/api/duo-tasks')
      .then(function (r) {
        if (r.ok) {
          duoTasks = r.body.tasks || [];
        } else if (r.body && /请先绑定/.test(r.body.message || '')) {
          duoTasks = []; // 队伍刚解绑等情况：按无队伍渲染
        } else {
          throw new Error(r.body.message);
        }
        renderTasksArea();
      })
      .catch(function () {
        taskBody.innerHTML =
          '<div class="empty-state"><p class="empty-title">加载失败</p>' +
          '<p class="empty-hint muted">网络异常，请刷新重试。</p></div>';
      });
  }

  /* ---------- 共同任务弹窗（新建 / 编辑） ---------- */

  function clearTaskFieldErrors() {
    Array.prototype.forEach.call(taskForm.querySelectorAll('.field-error'), function (p) {
      p.textContent = '';
    });
    taskFormError.hidden = true;
    taskFormError.textContent = '';
  }

  function setTaskFieldError(field, msg) {
    var tip = taskForm.querySelector('[data-error-for="' + field + '"]');
    if (tip) tip.textContent = msg || '';
  }

  /** 弹窗里的分工归属标注：队伍 user_a / user_b 的昵称（me_is_user_a 判断谁是自己） */
  function fillDivisionOwners() {
    var aOwner = document.getElementById('duoDivisionAOwner');
    var bOwner = document.getElementById('duoDivisionBOwner');
    if (!view || !view.team || !aOwner || !bOwner) return;
    var meLabel = '（你）';
    var partnerLabel = '（' + view.team.partner.nickname + '）';
    aOwner.textContent = view.team.me_is_user_a ? meLabel : partnerLabel;
    bOwner.textContent = view.team.me_is_user_a ? partnerLabel : meLabel;
  }

  function openTaskModal(task) {
    taskForm.reset();
    clearTaskFieldErrors();
    fillDivisionOwners();
    if (task) {
      taskModalTitle.textContent = '编辑共同任务';
      taskFormId.value = task.id;
      taskInputTitle.value = task.title;
      taskForm.querySelector('#duoTaskDesc').value = task.description || '';
      taskForm.querySelector('#duoDivisionA').value = task.division_a || '';
      taskForm.querySelector('#duoDivisionB').value = task.division_b || '';
      taskForm.querySelector('#duoTaskDeadline').value = task.deadline
        ? task.deadline.slice(0, 16).replace(' ', 'T')
        : '';
    } else {
      taskModalTitle.textContent = '新建共同任务';
      taskFormId.value = '';
    }
    taskModal.hidden = false;
    taskInputTitle.focus();
  }

  function closeTaskModal() {
    taskModal.hidden = true;
    if (taskSubmitBtn) taskSubmitBtn.disabled = false;
  }

  taskModalClose.addEventListener('click', closeTaskModal);
  taskModalCancel.addEventListener('click', closeTaskModal);
  taskModal.addEventListener('click', function (e) {
    if (e.target === taskModal) closeTaskModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !taskModal.hidden) closeTaskModal();
  });
  newDuoTaskBtn.addEventListener('click', function () { openTaskModal(null); });

  taskForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearTaskFieldErrors();

    var data = {};
    new FormData(taskForm).forEach(function (v, k) { data[k] = v; });
    if (!String(data.title || '').trim()) {
      setTaskFieldError('title', '请填写任务标题');
      return;
    }

    var id = taskFormId.value;
    taskSubmitBtn.disabled = true;
    request(id ? 'PUT' : 'POST', id ? '/api/duo-tasks/' + id : '/api/duo-tasks', data)
      .then(function (r) {
        if (!r.ok) {
          var errors = r.body.errors || {};
          var first = Object.keys(errors)[0];
          if (first) setTaskFieldError(first, errors[first]);
          taskFormError.textContent = r.body.message || '保存失败，请稍后再试';
          taskFormError.hidden = false;
          taskSubmitBtn.disabled = false;
          return;
        }
        closeTaskModal();
        window.showToast(id ? '任务已更新' : '任务已创建', 'success');
        loadTasksArea();
      })
      .catch(function () {
        taskFormError.textContent = '网络异常，请稍后再试';
        taskFormError.hidden = false;
        taskSubmitBtn.disabled = false;
      });
  });

  /* 任务卡片操作（事件委托；Day 10 会新增 data-action="checkin"） */
  taskBody.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    if (action === 'create') return openTaskModal(null);

    var holder = btn.closest('[data-id]');
    if (!holder) return;
    var id = holder.getAttribute('data-id');

    if (action === 'edit') {
      var task = duoTasks.filter(function (t) { return String(t.id) === id; })[0];
      if (task) openTaskModal(task);
    } else if (action === 'delete') {
      if (!window.confirm('确定删除该共同任务吗？双方的全部打卡记录也会一并删除。')) return;
      btn.disabled = true;
      request('DELETE', '/api/duo-tasks/' + id)
        .then(function (r) {
          if (!r.ok) {
            btn.disabled = false;
            window.showToast(r.body.message || '删除失败', 'error');
            return;
          }
          window.showToast('任务已删除', 'success');
          loadTasksArea();
        })
        .catch(function () {
          btn.disabled = false;
          window.showToast('网络异常，请稍后再试', 'error');
        });
    } else if (action === 'status') {
      btn.disabled = true;
      request('PATCH', '/api/duo-tasks/' + id + '/status', { status: btn.getAttribute('data-status') })
        .then(function (r) {
          if (!r.ok) {
            btn.disabled = false;
            window.showToast(r.body.message || '操作失败', 'error');
            return;
          }
          window.showToast('状态已更新', 'success');
          loadTasksArea();
        })
        .catch(function () {
          btn.disabled = false;
          window.showToast('网络异常，请稍后再试', 'error');
        });
    }
  });

  loadTeamArea();
})();
