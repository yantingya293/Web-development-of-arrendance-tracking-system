/* 首页「个人独立任务 & 学习问题」板块脚本（Day 5）
   加载 /api/tasks → 渲染任务卡片；支持分类筛选、新建、编辑、删除与状态流转。
   公共任务（owner_id 为 NULL）对普通用户只读，仅管理员可编辑删除。 */
(function () {
  'use strict';

  var CATEGORY_LABELS = { daily: '每日任务', weekly: '每周重点', question: '学习问题' };
  var STATUS_LABELS = { unstarted: '未开始', in_progress: '进行中', completed: '已完成', overdue: '已逾期' };

  var listBody = document.getElementById('taskListBody');
  if (!listBody) return; // 未登录：服务端已渲染登录引导，无需初始化

  var viewerId = Number(listBody.getAttribute('data-viewer-id'));
  var viewerIsAdmin = listBody.getAttribute('data-viewer-role') === 'admin';

  var tabs = document.getElementById('taskTabs');
  var newTaskBtn = document.getElementById('newTaskBtn');
  var modal = document.getElementById('taskModal');
  var modalTitle = document.getElementById('taskModalTitle');
  var modalClose = document.getElementById('taskModalClose');
  var modalCancel = document.getElementById('taskModalCancel');
  var form = document.getElementById('taskForm');
  var formId = document.getElementById('taskFormId');
  var formError = document.getElementById('taskFormError');
  var inputTitle = document.getElementById('taskTitle');
  var submitBtn = form.querySelector('button[type="submit"]');

  var tasks = [];
  var filter = 'all';

  /* ---------- 工具 ---------- */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function request(method, url, body) {
    return fetch(url, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    });
  }

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
    var text = deadline.slice(0, 16); // 去掉秒
    var diff = deadlineDiffDays(deadline);
    if (diff === null) return text;
    if (diff > 0) return text + '（剩 ' + diff + ' 天）';
    if (diff === 0) return text + '（今天截止）';
    return text + '（已过期 ' + -diff + ' 天）';
  }

  /** 状态流转的下一个主动作（overdue 不可手动设置，由服务端按截止时间判定） */
  function nextStatusAction(status) {
    if (status === 'unstarted') return { label: '开始任务', status: 'in_progress' };
    if (status === 'in_progress') return { label: '标记完成', status: 'completed' };
    if (status === 'overdue') return { label: '标记完成', status: 'completed' };
    if (status === 'completed') return { label: '重新打开', status: 'unstarted' };
    return null;
  }

  /* ---------- 渲染 ---------- */

  function renderCard(t) {
    var canManage = t.owner_id === viewerId || viewerIsAdmin;
    var next = canManage ? nextStatusAction(t.status) : null;
    var meta = [];
    if (t.owner_id === null) meta.push('公共任务');
    if (t.deadline) meta.push('截止 ' + fmtDeadline(t.deadline));

    return (
      '<article class="task-card' + (t.status === 'completed' ? ' completed' : '') + '" data-id="' + t.id + '">' +
        '<div class="task-card-main">' +
          '<div class="task-card-tags">' +
            '<span class="tag tag-cat-' + t.category + '">' + (CATEGORY_LABELS[t.category] || t.category) + '</span>' +
            '<span class="tag tag-st-' + t.status + '">' + (STATUS_LABELS[t.status] || t.status) + '</span>' +
          '</div>' +
          '<h3 class="task-card-title">' + escapeHtml(t.title) + '</h3>' +
          (t.description ? '<p class="task-card-desc">' + escapeHtml(t.description) + '</p>' : '') +
          (meta.length ? '<p class="task-card-meta muted">' + meta.join(' · ') + '</p>' : '') +
        '</div>' +
        (next || canManage
          ? '<div class="task-card-actions">' +
              (next ? '<button type="button" class="btn btn-sm" data-action="status" data-status="' + next.status + '">' + next.label + '</button>' : '') +
              (canManage ? '<button type="button" class="btn btn-sm" data-action="edit">编辑</button>' +
                          '<button type="button" class="btn btn-sm btn-danger-ghost" data-action="delete">删除</button>' : '') +
            '</div>'
          : '') +
      '</article>'
    );
  }

  function renderEmpty() {
    var hint =
      filter === 'all'
        ? '还没有任务，点击「新建任务」开始规划你的学习吧。'
        : '「' + CATEGORY_LABELS[filter] + '」分类下暂无任务。';
    return (
      '<div class="empty-state">' +
        '<span class="empty-illustration" aria-hidden="true"></span>' +
        '<p class="empty-title">暂无任务</p>' +
        '<p class="empty-hint muted">' + hint + '</p>' +
        (filter === 'all'
          ? '<button type="button" class="btn btn-primary btn-sm" data-action="create">新建任务</button>'
          : '') +
      '</div>'
    );
  }

  function updateTabCounts() {
    var counts = { all: tasks.length, daily: 0, weekly: 0, question: 0 };
    tasks.forEach(function (t) {
      if (counts[t.category] !== undefined) counts[t.category]++;
    });
    Array.prototype.forEach.call(tabs.querySelectorAll('.tab'), function (tab) {
      var span = tab.querySelector('.tab-count');
      if (span) span.textContent = counts[tab.getAttribute('data-filter')] || 0;
    });
  }

  function render() {
    var shown = tasks.filter(function (t) {
      return filter === 'all' || t.category === filter;
    });
    listBody.innerHTML = shown.length
      ? shown.map(renderCard).join('')
      : renderEmpty();
  }

  function load() {
    listBody.innerHTML = '';
    listBody.appendChild(buildLoading());
    request('GET', '/api/tasks')
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        tasks = r.body.tasks || [];
        updateTabCounts();
        render();
      })
      .catch(function () {
        listBody.innerHTML =
          '<div class="empty-state"><p class="empty-title">加载失败</p>' +
          '<p class="empty-hint muted">网络异常，请稍后刷新重试。</p></div>';
      });
  }

  function buildLoading() {
    var wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="loading" role="status" aria-live="polite">' +
        '<span class="spinner" aria-hidden="true"></span>' +
        '<p class="loading-text">正在加载任务…</p>' +
      '</div>';
    return wrap.firstElementChild;
  }

  /* ---------- 弹窗 ---------- */

  function clearFieldErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.field-error'), function (p) {
      p.textContent = '';
    });
    formError.hidden = true;
    formError.textContent = '';
  }

  function setFieldError(field, msg) {
    var tip = form.querySelector('[data-error-for="' + field + '"]');
    if (tip) tip.textContent = msg || '';
  }

  function openModal(task) {
    form.reset();
    clearFieldErrors();
    if (task) {
      modalTitle.textContent = '编辑任务';
      formId.value = task.id;
      inputTitle.value = task.title;
      form.querySelector('#taskDesc').value = task.description || '';
      var radio = form.querySelector('input[name="category"][value="' + task.category + '"]');
      if (radio) radio.checked = true;
      form.querySelector('#taskDeadline').value = task.deadline
        ? task.deadline.slice(0, 16).replace(' ', 'T')
        : '';
    } else {
      modalTitle.textContent = '新建任务';
      formId.value = '';
    }
    modal.hidden = false;
    inputTitle.focus();
  }

  function closeModal() {
    modal.hidden = true;
    submitBtn.disabled = false;
  }

  modalClose.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) closeModal(); // 只有点击遮罩本身才关闭
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });
  if (newTaskBtn) newTaskBtn.addEventListener('click', function () { openModal(null); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearFieldErrors();

    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });
    if (!String(data.title || '').trim()) {
      setFieldError('title', '请填写任务标题');
      return;
    }

    var id = formId.value;
    submitBtn.disabled = true;
    request(id ? 'PUT' : 'POST', id ? '/api/tasks/' + id : '/api/tasks', data)
      .then(function (r) {
        if (!r.ok) {
          var errors = r.body.errors || {};
          var first = Object.keys(errors)[0];
          if (first) setFieldError(first, errors[first]);
          formError.textContent = r.body.message || '保存失败，请稍后再试';
          formError.hidden = false;
          submitBtn.disabled = false;
          return;
        }
        closeModal();
        window.showToast(id ? '任务已更新' : '任务已创建', 'success');
        load();
      })
      .catch(function () {
        formError.textContent = '网络异常，请稍后再试';
        formError.hidden = false;
        submitBtn.disabled = false;
      });
  });

  /* ---------- 卡片操作（事件委托） ---------- */

  function setStatus(id, status, btn) {
    btn.disabled = true;
    request('PATCH', '/api/tasks/' + id + '/status', { status: status })
      .then(function (r) {
        if (!r.ok) {
          btn.disabled = false;
          window.showToast(r.body.message || '操作失败', 'error');
          return;
        }
        window.showToast(status === 'completed' ? '任务完成，继续加油！' : '状态已更新', 'success');
        load();
      })
      .catch(function () {
        btn.disabled = false;
        window.showToast('网络异常，请稍后再试', 'error');
      });
  }

  function removeTask(id, btn) {
    if (!window.confirm('确定删除该任务吗？删除后不可恢复。')) return;
    btn.disabled = true;
    request('DELETE', '/api/tasks/' + id)
      .then(function (r) {
        if (!r.ok) {
          btn.disabled = false;
          window.showToast(r.body.message || '删除失败', 'error');
          return;
        }
        window.showToast('任务已删除', 'success');
        load();
      })
      .catch(function () {
        btn.disabled = false;
        window.showToast('网络异常，请稍后再试', 'error');
      });
  }

  listBody.addEventListener('click', function (e) {
    var btn = e.target.closest('button[data-action]');
    if (!btn) return;

    var action = btn.getAttribute('data-action');
    if (action === 'create') return openModal(null);

    var holder = btn.closest('[data-id]');
    if (!holder) return;
    var id = holder.getAttribute('data-id');

    if (action === 'edit') {
      var task = tasks.filter(function (t) { return String(t.id) === id; })[0];
      if (task) openModal(task);
    } else if (action === 'delete') {
      removeTask(id, btn);
    } else if (action === 'status') {
      setStatus(id, btn.getAttribute('data-status'), btn);
    }
  });

  /* ---------- 分类筛选 ---------- */

  tabs.addEventListener('click', function (e) {
    var tab = e.target.closest('button[data-filter]');
    if (!tab) return;
    filter = tab.getAttribute('data-filter');
    Array.prototype.forEach.call(tabs.querySelectorAll('.tab'), function (t) {
      t.classList.toggle('active', t === tab);
    });
    render();
  });

  load();
})();
