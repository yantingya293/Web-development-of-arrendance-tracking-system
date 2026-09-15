/* 管理员后台脚本（Day 14）
   概览：GET /api/admin/overview → 全站统计卡（用户 / 任务完成率 / 打卡 / 组队）。
   用户：GET /api/admin/users?q=&limit=&offset= → 表格 + 关键词搜索 + 分页。
   公共任务：GET / POST / DELETE /api/admin/public-tasks → 发布与删除，删除后概览联动刷新。 */
(function () {
  'use strict';

  var PAGE_SIZE = 20;
  var CATEGORY_LABELS = { daily: '每日任务', weekly: '每周重点', question: '学习问题' };
  var STATUS_LABELS = { unstarted: '未开始', in_progress: '进行中', completed: '已完成', overdue: '已逾期' };

  function esc(s) {
    return window.escapeHtml(s);
  }

  function request(method, url, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(url, opts).then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    });
  }

  function loadingHtml(text) {
    return (
      '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>' +
      '<p class="loading-text">' + esc(text || '加载中…') + '</p></div>'
    );
  }

  function rateText(v) {
    return v == null ? '—' : v + '%';
  }

  /* ---------- 全站概览 ---------- */

  var statsHost = document.getElementById('adminStats');

  function statCard(value, label, sub) {
    return (
      '<div class="stat-card card">' +
        '<p class="stat-value">' + esc(value) + '</p>' +
        '<p class="stat-label">' + esc(label) + '</p>' +
        (sub ? '<p class="stat-sub muted">' + esc(sub) + '</p>' : '') +
      '</div>'
    );
  }

  function renderOverview(o) {
    if (!statsHost) return;
    var u = o.users || {};
    var t = o.tasks || {};
    var d = o.duo_tasks || {};
    var c = o.checkins || {};
    var tm = o.teams || {};
    statsHost.innerHTML = [
      statCard(u.total, '用户总数', '普通 ' + u.normal + ' · 管理员 ' + u.admins),
      statCard(u.new_today, '今日新增用户', null),
      statCard(u.bound, '组队中用户', '进行中队伍 ' + tm.active + ' 支'),
      statCard(rateText(t.solo_completion_rate), '单人任务完成率', '已完成 ' + t.solo_completed + ' / ' + t.solo_total),
      statCard(rateText(d.completion_rate), '双人任务完成率', '已完成 ' + d.completed + ' / ' + d.total),
      statCard(c.total, '打卡总数', '单人 ' + c.solo + ' · 双人 ' + c.duo),
      statCard(c.today, '今日打卡', null),
      statCard(t.public_total, '公共任务', null),
    ].join('');
  }

  function loadOverview() {
    if (!statsHost) return;
    request('GET', '/api/admin/overview')
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        renderOverview(r.body.overview || {});
      })
      .catch(function () {
        statsHost.innerHTML = '<p class="muted">统计加载失败，请刷新重试。</p>';
      });
  }

  /* ---------- 用户列表 ---------- */

  var userTable = document.getElementById('userTable');
  var userPager = document.getElementById('userPager');
  var userSearchForm = document.getElementById('userSearchForm');
  var userSearchInput = document.getElementById('userSearchInput');
  var userSearchReset = document.getElementById('userSearchReset');

  var userState = { q: '', offset: 0 };

  function renderUsers(data) {
    if (!userTable) return;
    var users = data.users || [];
    if (!users.length) {
      userTable.innerHTML = '<p class="muted">没有符合条件的用户。</p>';
    } else {
      userTable.innerHTML =
        '<div class="table-wrap"><table class="data-table"><thead><tr>' +
          '<th>ID</th><th>昵称</th><th>账号</th><th>角色</th>' +
          '<th class="num">自建任务</th><th class="num">单人打卡</th><th class="num">双人打卡</th>' +
          '<th>组队中</th><th>注册时间</th>' +
        '</tr></thead><tbody>' +
        users
          .map(function (u) {
            return (
              '<tr>' +
                '<td>' + esc(u.id) + '</td>' +
                '<td><div class="user-cell">' +
                  '<span class="avatar-sm" aria-hidden="true">' + window.avatarInner(u) + '</span>' +
                  '<span>' + esc(u.nickname) + '</span>' +
                '</div></td>' +
                '<td>' + esc(u.account) + '</td>' +
                '<td>' + (u.role === 'admin' ? '<span class="badge badge-admin">管理员</span>' : '普通用户') + '</td>' +
                '<td class="num">' + esc(u.task_count) + '</td>' +
                '<td class="num">' + esc(u.solo_checkin_count) + '</td>' +
                '<td class="num">' + esc(u.duo_checkin_count) + '</td>' +
                '<td>' + (u.in_team ? '<span class="tag tag-duo">组队中</span>' : '<span class="muted">—</span>') + '</td>' +
                '<td class="muted">' + esc(u.created_at) + '</td>' +
              '</tr>'
            );
          })
          .join('') +
        '</tbody></table></div>';
    }
    renderPager(data);
  }

  function renderPager(data) {
    if (!userPager) return;
    var limit = data.limit || PAGE_SIZE;
    var total = data.total || 0;
    var from = total ? data.offset + 1 : 0;
    var to = Math.min(data.offset + (data.users || []).length, total);
    var pages = Math.max(Math.ceil(total / limit), 1);
    var page = Math.floor(data.offset / limit) + 1;
    userPager.innerHTML =
      '<span class="muted">共 ' + total + ' 人 · 当前 ' + from + '–' + to + '</span>' +
      '<span class="pager-actions">' +
        '<button type="button" class="btn btn-outline btn-sm" id="userPrevBtn"' + (page <= 1 ? ' disabled' : '') + '>上一页</button>' +
        '<span class="muted">第 ' + page + ' / ' + pages + ' 页</span>' +
        '<button type="button" class="btn btn-outline btn-sm" id="userNextBtn"' + (page >= pages ? ' disabled' : '') + '>下一页</button>' +
      '</span>';

    var prev = document.getElementById('userPrevBtn');
    var next = document.getElementById('userNextBtn');
    if (prev) {
      prev.addEventListener('click', function () {
        loadUsers(data.offset - limit);
      });
    }
    if (next) {
      next.addEventListener('click', function () {
        loadUsers(data.offset + limit);
      });
    }
  }

  function loadUsers(offset) {
    if (!userTable) return;
    userTable.innerHTML = loadingHtml('加载用户…');
    userState.offset = Math.max(offset || 0, 0);
    var url = '/api/admin/users?limit=' + PAGE_SIZE + '&offset=' + userState.offset;
    if (userState.q) url += '&q=' + encodeURIComponent(userState.q);
    request('GET', url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        renderUsers(r.body || {});
      })
      .catch(function () {
        userTable.innerHTML = '<p class="muted">用户列表加载失败，请刷新重试。</p>';
        if (userPager) userPager.innerHTML = '';
      });
  }

  if (userSearchForm) {
    userSearchForm.addEventListener('submit', function (e) {
      e.preventDefault();
      userState.q = (userSearchInput.value || '').trim();
      loadUsers(0);
    });
  }

  if (userSearchReset) {
    userSearchReset.addEventListener('click', function () {
      userSearchInput.value = '';
      userState.q = '';
      loadUsers(0);
    });
  }

  /* ---------- 公共任务管理 ---------- */

  var publicForm = document.getElementById('publicTaskForm');
  var publicList = document.getElementById('publicTaskList');

  function renderPublicTasks(tasks) {
    if (!publicList) return;
    if (!tasks.length) {
      publicList.innerHTML = '<p class="muted">还没有公共任务。</p>';
      return;
    }
    publicList.innerHTML = tasks
      .map(function (t) {
        return (
          '<div class="public-task-item">' +
            '<div class="public-task-main">' +
              '<p class="public-task-title">' +
                '<span class="tag tag-cat-' + esc(t.category) + '">' + esc(CATEGORY_LABELS[t.category] || t.category) + '</span>' +
                esc(t.title) +
              '</p>' +
              '<p class="muted">状态：' + esc(STATUS_LABELS[t.status] || t.status) +
                ' · 截止：' + esc(t.deadline || '不限') +
                ' · 发布于 ' + esc(t.created_at) + '</p>' +
              (t.description ? '<p class="muted">' + esc(t.description) + '</p>' : '') +
            '</div>' +
            '<button type="button" class="btn btn-danger-ghost btn-sm" data-del-public="' + esc(t.id) + '">删除</button>' +
          '</div>'
        );
      })
      .join('');
  }

  function loadPublicTasks() {
    if (!publicList) return;
    publicList.innerHTML = loadingHtml('加载公共任务…');
    request('GET', '/api/admin/public-tasks')
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        renderPublicTasks(r.body.tasks || []);
      })
      .catch(function () {
        publicList.innerHTML = '<p class="muted">公共任务加载失败，请刷新重试。</p>';
      });
  }

  if (publicList) {
    publicList.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-del-public]') : null;
      if (!btn) return;
      var id = btn.getAttribute('data-del-public');
      if (!window.confirm('删除后该公共任务及其下所有打卡记录都会消失，确定删除吗？')) return;
      btn.disabled = true;
      request('DELETE', '/api/admin/public-tasks/' + id)
        .then(function (r) {
          if (!r.ok) {
            window.showToast(r.body.message || '删除失败，请稍后再试', 'error');
            btn.disabled = false;
            return;
          }
          window.showToast(r.body.message || '公共任务已删除', 'success');
          loadPublicTasks();
          loadOverview(); // 概览里的「公共任务」计数同步刷新
        })
        .catch(function () {
          window.showToast('网络异常，请稍后再试', 'error');
          btn.disabled = false;
        });
    });
  }

  if (publicForm) {
    publicForm.addEventListener('submit', function (e) {
      e.preventDefault();
      Array.prototype.forEach.call(publicForm.querySelectorAll('.field-error'), function (p) {
        p.textContent = '';
      });
      var btn = publicForm.querySelector('button[type="submit"]');
      var catEl = publicForm.querySelector('input[name="category"]:checked');
      btn.disabled = true;
      request('POST', '/api/admin/public-tasks', {
        category: catEl ? catEl.value : 'daily',
        title: document.getElementById('publicTaskTitle').value,
        description: document.getElementById('publicTaskDesc').value,
        deadline: document.getElementById('publicTaskDeadline').value,
      })
        .then(function (r) {
          if (!r.ok) {
            var errors = r.body.errors || {};
            Object.keys(errors).forEach(function (k) {
              var tip = publicForm.querySelector('[data-error-for="' + k + '"]');
              if (tip) tip.textContent = errors[k];
            });
            window.showToast(r.body.message || '发布失败，请检查表单', 'error');
            return;
          }
          publicForm.reset();
          window.showToast(r.body.message || '公共任务已发布', 'success');
          loadPublicTasks();
          loadOverview();
        })
        .catch(function () {
          window.showToast('网络异常，请稍后再试', 'error');
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  /* ---------- 初始化 ---------- */

  if (statsHost) loadOverview();
  if (userTable) loadUsers(0);
  if (publicList) loadPublicTasks();
})();
