/* 双人协作广场页脚本（Day 8 组队 / Day 9 共同任务 / Day 10 双方打卡）
   组队区：GET /api/team → 收到的邀请（接受 / 拒绝）→ 当前搭档（解绑）→ 邀请表单。
   任务区：GET /api/duo-tasks → 任务卡片（今日双方进度 / 分工 / 截止 / 状态流转 / 打卡）。
   打卡区：POST /api/duo-checkins（每日一次）；记录区 GET /api/duo-checkins；
   协作动态：GET /api/notifications（搭档打卡 / 解绑 / 邀请通知）。 */
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

  /** 我是队伍的 a 槽还是 b 槽（今日打卡进度判定用；无队伍时为 null） */
  function mySlot() {
    if (!view || !view.team) return null;
    return view.team.me_is_user_a ? 'a' : 'b';
  }

  function renderTodayProgress(t) {
    function side(slot) {
      var at = t.today && t.today[slot];
      var name = escapeHtml(t.members[slot].nickname);
      return at
        ? '<span class="duo-today-done">' + name + ' ✓ ' + at + '</span>'
        : '<span class="duo-today-todo">' + name + ' 待打卡</span>';
    }
    return (
      '<p class="duo-today-line">今日进度：' + side('a') + ' · ' + side('b') + '</p>'
    );
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
    // 打卡入口：未完成 + 我今天还没打过（overdue 可补打卡，completed 不再打卡）
    var slot = mySlot();
    var iCheckedToday = slot && t.today && t.today[slot];
    var canCheckin = t.status !== 'completed' && slot && !iCheckedToday;
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
          renderTodayProgress(t) +
          (meta.length ? '<p class="task-card-meta muted">' + meta.join(' · ') + '</p>' : '') +
        '</div>' +
        '<div class="task-card-actions">' +
          (canCheckin ? '<button type="button" class="btn btn-sm btn-checkin" data-action="checkin">打卡</button>' : '') +
          (slot && iCheckedToday && t.status !== 'completed'
            ? '<span class="tag tag-st-completed duo-today-mine">今日已打卡</span>' : '') +
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
      duoTasks = [];
      renderTasksArea();
      renderRecordFilter();
      renderRecords();
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
        renderRecordFilter();
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

  /* 任务卡片操作（事件委托） */
  taskBody.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    if (action === 'create') return openTaskModal(null);

    var holder = btn.closest('[data-id]');
    if (!holder) return;
    var id = holder.getAttribute('data-id');

    if (action === 'checkin') {
      var taskToCheck = duoTasks.filter(function (t) { return String(t.id) === id; })[0];
      if (taskToCheck) openCheckinModal(taskToCheck);
    } else if (action === 'edit') {
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

  /* ---------- 双人打卡板块（Day 10） ---------- */

  var CHECKIN_ACCEPT_MIMES = ['image/jpeg', 'image/png'];
  var CHECKIN_MAX_PHOTOS = 3;
  var CHECKIN_MAX_SIZE = 10 * 1024 * 1024;

  var checkinModal = document.getElementById('duoCheckinModal');
  var checkinModalClose = document.getElementById('duoCheckinModalClose');
  var checkinModalCancel = document.getElementById('duoCheckinModalCancel');
  var checkinForm = document.getElementById('duoCheckinForm');
  var checkinFormError = document.getElementById('duoCheckinFormError');
  var checkinTaskName = document.getElementById('duoCheckinTaskName');
  var checkinMyDivision = document.getElementById('duoCheckinMyDivision');
  var checkinNote = document.getElementById('duoCheckinNote');
  var checkinSubmitBtn = checkinForm ? checkinForm.querySelector('button[type="submit"]') : null;
  var photoPickBtn = document.getElementById('duoPhotoPickBtn');
  var photoInput = document.getElementById('duoPhotoInput');
  var photoPreview = document.getElementById('duoPhotoPreview');

  var checkinTask = null; // 正在打卡的任务
  var photos = [];        // { file: File, url: objectURL }

  function setCheckinFieldError(field, msg) {
    var tip = checkinForm.querySelector('[data-error-for="' + field + '"]');
    if (tip) tip.textContent = msg || '';
  }

  function clearCheckinErrors() {
    ['photos', 'note'].forEach(function (f) { setCheckinFieldError(f, ''); });
    checkinFormError.hidden = true;
    checkinFormError.textContent = '';
  }

  /* 照片选择与预览（逻辑与首页单人打卡表单一致，独立实现避免跨页脚本耦合） */
  function renderCheckinPreview() {
    photoPreview.innerHTML = '';
    photos.forEach(function (p, i) {
      var item = document.createElement('div');
      item.className = 'photo-item';

      var img = document.createElement('img');
      img.src = p.url;
      img.alt = '打卡照片预览 ' + (i + 1);

      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'photo-remove';
      rm.setAttribute('aria-label', '移除照片 ' + (i + 1));
      rm.textContent = '×';
      rm.dataset.index = String(i);

      item.appendChild(img);
      item.appendChild(rm);
      photoPreview.appendChild(item);
    });
    photoPreview.hidden = photos.length === 0;
    if (photos.length >= CHECKIN_MAX_PHOTOS) {
      photoPickBtn.disabled = true;
      photoPickBtn.classList.add('is-full');
    } else {
      photoPickBtn.disabled = false;
      photoPickBtn.classList.remove('is-full');
    }
  }

  function addCheckinFiles(fileList) {
    setCheckinFieldError('photos', '');
    var rejected = [];
    var added = 0;
    Array.prototype.forEach.call(fileList, function (f) {
      if (photos.length >= CHECKIN_MAX_PHOTOS) return;
      if (CHECKIN_ACCEPT_MIMES.indexOf(f.type) === -1 || !/\.(jpe?g|png)$/i.test(f.name)) {
        rejected.push(f.name + '（仅支持 JPG / PNG）');
        return;
      }
      if (f.size > CHECKIN_MAX_SIZE) {
        rejected.push(f.name + '（超过 10MB）');
        return;
      }
      photos.push({ file: f, url: URL.createObjectURL(f) });
      added++;
    });
    var skipped = fileList.length - added - rejected.length;
    if (skipped > 0) window.showToast('最多上传 ' + CHECKIN_MAX_PHOTOS + ' 张照片，多余部分已忽略', 'info');
    if (rejected.length) setCheckinFieldError('photos', '以下文件未添加：' + rejected.join('、'));
    renderCheckinPreview();
  }

  photoPickBtn.addEventListener('click', function () {
    photoInput.click();
  });

  photoInput.addEventListener('change', function () {
    if (photoInput.files && photoInput.files.length) addCheckinFiles(photoInput.files);
    photoInput.value = ''; // 允许移除后重新选择同一文件
  });

  photoPreview.addEventListener('click', function (e) {
    var btn = e.target.closest('.photo-remove');
    if (!btn) return;
    var i = Number(btn.dataset.index);
    if (photos[i]) {
      URL.revokeObjectURL(photos[i].url);
      photos.splice(i, 1);
      renderCheckinPreview();
    }
  });

  function clearCheckinPhotos() {
    photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
    photos = [];
    renderCheckinPreview();
  }

  function openCheckinModal(task) {
    checkinTask = task;
    checkinTaskName.textContent = '「' + task.title + '」';
    var slot = mySlot();
    var myDivision = slot ? task.members[slot].division : '';
    checkinMyDivision.textContent = myDivision
      ? '我的分工：' + myDivision
      : '我的分工：未划分（可在编辑任务时补充）';
    checkinNote.value = '';
    clearCheckinPhotos();
    clearCheckinErrors();
    checkinModal.hidden = false;
    photoPickBtn.focus();
  }

  function closeCheckinModal() {
    checkinModal.hidden = true;
    checkinTask = null;
    if (checkinSubmitBtn) {
      checkinSubmitBtn.disabled = false;
      checkinSubmitBtn.textContent = '提交打卡';
    }
  }

  checkinModalClose.addEventListener('click', closeCheckinModal);
  checkinModalCancel.addEventListener('click', closeCheckinModal);
  checkinModal.addEventListener('click', function (e) {
    if (e.target === checkinModal) closeCheckinModal();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !checkinModal.hidden) closeCheckinModal();
  });

  checkinForm.addEventListener('submit', function (e) {
    e.preventDefault();
    clearCheckinErrors();
    if (!checkinTask) return;

    if (!photos.length) {
      setCheckinFieldError('photos', '请至少上传 1 张照片作为打卡凭证');
      return;
    }

    var data = new FormData();
    data.append('duoTaskId', checkinTask.id);
    data.append('note', checkinNote.value.trim());
    photos.forEach(function (p) { data.append('photos', p.file, p.file.name); });

    checkinSubmitBtn.disabled = true;
    checkinSubmitBtn.textContent = '提交中…';
    fetch('/api/duo-checkins', { method: 'POST', body: data })
      .then(function (res) {
        return res.json().then(function (b) {
          return { ok: res.ok, body: b };
        });
      })
      .then(function (r) {
        if (!r.ok) {
          var errors = r.body.errors || {};
          Object.keys(errors).forEach(function (k) { setCheckinFieldError(k, errors[k]); });
          checkinFormError.textContent = r.body.message || '打卡失败，请稍后再试';
          checkinFormError.hidden = false;
          if (/今天已/.test(r.body.message || '')) loadTasksArea(); // 卡片进度可能过期
          return;
        }
        window.showToast('打卡成功，搭档已收到通知！', 'success');
        closeCheckinModal();
        loadTasksArea();
        loadRecords();
      })
      .catch(function () {
        checkinFormError.textContent = '网络异常，请稍后再试';
        checkinFormError.hidden = false;
      })
      .then(function () {
        checkinSubmitBtn.disabled = false;
        checkinSubmitBtn.textContent = '提交打卡';
      });
  });

  /* ---------- 双人打卡记录区（Day 10） ---------- */

  var recordBody = document.getElementById('duoRecordBody');
  var recordFilter = document.getElementById('duoRecordFilter');
  var recordTaskSelect = document.getElementById('duoRecordTask');

  function renderRecordFilter() {
    if (!recordTaskSelect) return;
    var keep = recordTaskSelect.value;
    recordTaskSelect.innerHTML = '<option value="">全部任务</option>';
    duoTasks.forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.title;
      recordTaskSelect.appendChild(opt);
    });
    var keepOpt = recordTaskSelect.querySelector('option[value="' + keep + '"]');
    recordTaskSelect.value = keepOpt ? keep : '';
  }

  function renderRecordItem(c) {
    var photoHtml = (c.image_paths || [])
      .map(function (p) {
        return '<a class="history-photo" href="/' + escapeHtml(p) + '" target="_blank" rel="noopener">' +
          '<img src="/' + escapeHtml(p) + '" alt="打卡照片" loading="lazy" /></a>';
      })
      .join('');
    return (
      '<article class="history-item">' +
        '<div class="history-item-main">' +
          '<p class="history-item-time muted">' + escapeHtml(c.user_nickname) + ' · ' +
            escapeHtml(String(c.submitted_at).slice(0, 16)) + '</p>' +
          '<h3 class="history-item-title">' + escapeHtml(c.task_title) + '</h3>' +
          (c.note ? '<p class="history-item-note">' + escapeHtml(c.note) + '</p>' : '') +
        '</div>' +
        (photoHtml ? '<div class="history-item-photos">' + photoHtml + '</div>' : '') +
      '</article>'
    );
  }

  function renderRecords() {
    if (!recordBody) return;
    recordBody.innerHTML =
      '<div class="empty-state">' +
        '<span class="empty-illustration" aria-hidden="true"></span>' +
        '<p class="empty-title">' + (view && view.team ? '暂无打卡记录' : '组队后查看打卡记录') + '</p>' +
        '<p class="empty-hint muted">' +
          (view && view.team ? '双方完成打卡后，照片凭证与备注会展示在这里。' : '先在上方绑定学习搭档。') +
        '</p>' +
      '</div>';
  }

  function loadRecords() {
    if (!recordBody) return;
    if (!view || !view.team) {
      renderRecords();
      return;
    }
    var url = '/api/duo-checkins?limit=20' + (recordTaskSelect.value ? '&taskId=' + recordTaskSelect.value : '');
    request('GET', url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        var checkins = r.body.checkins || [];
        recordBody.innerHTML = checkins.length
          ? checkins.map(renderRecordItem).join('')
          : '';
        if (!checkins.length) renderRecords();
      })
      .catch(function () {
        recordBody.innerHTML =
          '<div class="empty-state"><p class="empty-title">加载失败</p>' +
          '<p class="empty-hint muted">网络异常，请刷新重试。</p></div>';
      });
  }

  recordFilter.addEventListener('submit', function (e) {
    e.preventDefault();
    loadRecords();
  });

  /* ---------- 协作动态（站内通知，Day 10） ---------- */

  var notifBody = document.getElementById('notifBody');
  var notifReadAllBtn = document.getElementById('notifReadAllBtn');

  var NOTIF_TEXT = {
    invite: function (p) { return (p.fromNickname || '有人') + ' 邀请你组队'; },
    team_unbound: function (p) { return (p.nickname || '搭档') + ' 解除了与你的搭档绑定'; },
    partner_checkin: function (p) {
      return (p.nickname || '搭档') + ' 完成了共同任务「' + (p.taskTitle || '') + '」的今日打卡';
    },
  };

  function renderNotifications(notifications) {
    var unread = notifications.filter(function (n) { return !n.read_at; }).length;
    notifReadAllBtn.hidden = unread === 0;
    if (!notifications.length) {
      notifBody.innerHTML =
        '<div class="empty-state">' +
          '<span class="empty-illustration" aria-hidden="true"></span>' +
          '<p class="empty-title">暂无协作动态</p>' +
          '<p class="empty-hint muted">搭档打卡、组队邀请与解绑通知会展示在这里。</p>' +
        '</div>';
      return;
    }
    notifBody.innerHTML = notifications
      .map(function (n) {
        var render = NOTIF_TEXT[n.type];
        var text = render ? render(n.payload || {}) : '收到一条新通知';
        return (
          '<div class="notif-item' + (n.read_at ? '' : ' unread') + '">' +
            '<p class="notif-text">' + escapeHtml(text) + '</p>' +
            '<p class="muted notif-time">' + escapeHtml(n.created_at) + '</p>' +
          '</div>'
        );
      })
      .join('');
  }

  function loadNotifications() {
    if (!notifBody) return;
    request('GET', '/api/notifications?limit=10')
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        renderNotifications(r.body.notifications || []);
      })
      .catch(function () {
        notifBody.innerHTML =
          '<div class="empty-state"><p class="empty-title">加载失败</p>' +
          '<p class="empty-hint muted">网络异常，请刷新重试。</p></div>';
      });
  }

  notifReadAllBtn.addEventListener('click', function () {
    notifReadAllBtn.disabled = true;
    request('POST', '/api/notifications/read-all')
      .then(function (r) {
        if (!r.ok) {
          window.showToast(r.body.message || '操作失败', 'error');
          return;
        }
        loadNotifications();
      })
      .catch(function () {
        window.showToast('网络异常，请稍后再试', 'error');
      })
      .then(function () {
        notifReadAllBtn.disabled = false;
      });
  });

  loadTeamArea();
  loadRecords();
  loadNotifications();
})();
