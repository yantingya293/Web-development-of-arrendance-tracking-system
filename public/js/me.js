/* 个人中心脚本（Day 7 打卡统计与改密 / Day 13 学习数据看板 / Day 14 个人设置与组队信息）
   速览：GET /api/checkins/stats → 累计 / 今日 / 连续天数 + 近 7 天热度条（4 档着色）。
   看板：GET /api/stats/dashboard?month=YYYY-MM → 任务完成率（进度条）+
   分类分布（占比条）+ 月度打卡日历（单人 + 双人合并着色，可翻月，下月不超过当前月）。
   改密：POST /api/auth/change-password（安全加固）。
   资料：PATCH /api/auth/profile 改昵称；POST /api/auth/avatar 传头像；DELETE /api/auth/avatar 移除。
   组队：GET /api/team → 我的搭档卡（未组队给出组队引导）。 */
(function () {
  'use strict';

  var WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
  var CATEGORY_LABELS = { daily: '每日任务', weekly: '每周重点', question: '学习问题' };

  /* ---------- 工具 ---------- */

  function getJson(url) {
    return fetch(url).then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    });
  }

  function levelOf(count) {
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    return 3;
  }

  function pad2(x) {
    return String(x).padStart(2, '0');
  }

  function currentMonthStr() {
    var n = new Date();
    return n.getFullYear() + '-' + pad2(n.getMonth() + 1);
  }

  function shiftMonth(month, delta) {
    var y = Number(month.slice(0, 4));
    var m = Number(month.slice(5, 7)) - 1 + delta;
    var d = new Date(y, m, 1);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  /* ---------- 打卡速览 + 近 7 天热度（Day 7） ---------- */

  var heatmapRow = document.getElementById('heatmapRow');
  var heatmapHint = document.getElementById('heatmapHint');

  if (heatmapRow) {
    getJson('/api/checkins/stats')
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        var s = r.body.stats || {};
        document.getElementById('statTotal').textContent = s.total || 0;
        document.getElementById('statToday').textContent = s.today || 0;
        document.getElementById('statStreak').textContent = s.streak || 0;

        var last7 = s.last7 || [];
        heatmapRow.innerHTML = last7
          .map(function (d) {
            var weekday = WEEKDAY_SHORT[new Date(d.day + 'T00:00:00').getDay()];
            return (
              '<div class="heatmap-cell" title="' + d.day + ' 打卡 ' + d.count + ' 次">' +
                '<span class="heatmap-box lv' + levelOf(d.count) + '" aria-hidden="true"></span>' +
                '<span class="heatmap-label">' + weekday + '<br />' + d.day.slice(5) + '</span>' +
              '</div>'
            );
          })
          .join('');

        var weekTotal = last7.reduce(function (sum, d) { return sum + d.count; }, 0);
        if (heatmapHint) heatmapHint.textContent = '近 7 天共打卡 ' + weekTotal + ' 次，继续保持！';
      })
      .catch(function () {
        if (heatmapHint) heatmapHint.textContent = '统计数据加载失败，请刷新重试。';
      });
  }

  /* ---------- 学习数据看板（Day 13） ---------- */

  var ratePanel = document.getElementById('taskRatePanel');
  var catPanel = document.getElementById('taskCatPanel');
  var calPanel = document.getElementById('calPanel');
  var calMonth = document.getElementById('calMonth');
  var calSummary = document.getElementById('calSummary');
  var calPrevBtn = document.getElementById('calPrevBtn');
  var calNextBtn = document.getElementById('calNextBtn');

  var calMonthValue = currentMonthStr();
  var calDaysMap = {};

  function renderRatePanel(tasks) {
    if (!ratePanel) return;
    if (!tasks || !tasks.total) {
      ratePanel.innerHTML =
        '<p class="muted cal-empty">还没有自己的单人任务。</p>' +
        '<p><a href="/" class="btn btn-outline btn-sm">去首页创建任务</a></p>';
      return;
    }
    var rate = tasks.completion_rate == null ? 0 : tasks.completion_rate;
    ratePanel.innerHTML =
      '<p class="rate-value">' + rate + '<span class="rate-unit">%</span></p>' +
      '<div class="progress-bar" role="progressbar" aria-valuenow="' + rate + '" aria-valuemin="0" aria-valuemax="100" aria-label="任务完成率">' +
        '<div class="progress-fill" style="width:' + rate + '%"></div>' +
      '</div>' +
      '<p class="muted rate-detail">已完成 ' + tasks.completed + ' / 共 ' + tasks.total + ' 个' +
        (tasks.in_progress ? ' · 进行中 ' + tasks.in_progress : '') +
        (tasks.overdue ? ' · 已逾期 ' + tasks.overdue : '') + '</p>';
  }

  function renderCatPanel(tasks) {
    if (!catPanel) return;
    var byCat = (tasks && tasks.by_category) || {};
    var total = tasks && tasks.total ? tasks.total : 0;
    if (!total) {
      catPanel.innerHTML = '<p class="muted cal-empty">创建任务后，这里会显示分类占比。</p>';
      return;
    }
    catPanel.innerHTML = Object.keys(CATEGORY_LABELS)
      .map(function (key) {
        var n = byCat[key] || 0;
        var pct = Math.round((n / total) * 100);
        return (
          '<div class="cat-row" title="' + CATEGORY_LABELS[key] + ' ' + n + ' 个（' + pct + '%）">' +
            '<span class="cat-name">' + CATEGORY_LABELS[key] + '</span>' +
            '<div class="cat-bar-track"><div class="cat-bar-fill" style="width:' + pct + '%"></div></div>' +
            '<span class="cat-count">' + n + '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  /** 月历网格：周日开头，非本月的前置空白；着色按当日打卡次数 4 档 */
  function renderCalendar() {
    if (!calPanel) return;
    var y = Number(calMonthValue.slice(0, 4));
    var m = Number(calMonthValue.slice(5, 7));
    var lead = new Date(y, m - 1, 1).getDay(); // 0 = 周日
    var daysInMonth = new Date(y, m, 0).getDate();
    var now = new Date();
    var todayStr = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());

    var html =
      '<div class="cal-week">' +
        WEEKDAY_SHORT.map(function (w) { return '<span class="cal-week-cell">' + w + '</span>'; }).join('') +
      '</div><div class="cal-grid">';
    for (var i = 0; i < lead; i++) html += '<span class="cal-cell blank" aria-hidden="true"></span>';
    for (var day = 1; day <= daysInMonth; day++) {
      var dayStr = calMonthValue + '-' + pad2(day);
      var count = calDaysMap[dayStr] || 0;
      html +=
        '<span class="cal-cell lv' + levelOf(count) + (dayStr === todayStr ? ' today' : '') + '"' +
          ' title="' + dayStr + ' 打卡 ' + count + ' 次">' +
        day + '</span>';
    }
    html += '</div>';
    calPanel.innerHTML = html;
  }

  function renderCalSummary(calendar, checkins) {
    if (!calSummary) return;
    calSummary.textContent =
      '本月打卡 ' + calendar.month_total + ' 次 · 有记录 ' + calendar.active_days + ' 天' +
      '（累计：单人 ' + (checkins.solo_total || 0) + ' 次 / 双人 ' + (checkins.duo_total || 0) + ' 次）';
  }

  function renderDashboard(d) {
    renderRatePanel(d.tasks);
    renderCatPanel(d.tasks);
    calMonthValue = d.month || calMonthValue;
    calDaysMap = (d.calendar && d.calendar.days) || {};
    if (calMonth) calMonth.textContent = calMonthValue.slice(0, 4) + ' 年 ' + Number(calMonthValue.slice(5, 7)) + ' 月';
    renderCalendar();
    renderCalSummary(d.calendar || {}, d.checkins || {});
    if (calNextBtn) calNextBtn.disabled = calMonthValue >= currentMonthStr();
  }

  function loadDashboard() {
    var url = '/api/stats/dashboard';
    if (calMonthValue !== currentMonthStr()) url += '?month=' + calMonthValue;
    getJson(url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        renderDashboard(r.body.dashboard || {});
      })
      .catch(function () {
        if (ratePanel) ratePanel.innerHTML = '<p class="muted cal-empty">统计加载失败，请刷新重试。</p>';
        if (catPanel) catPanel.innerHTML = '<p class="muted cal-empty">统计加载失败。</p>';
        if (calPanel) calPanel.innerHTML = '<p class="muted cal-empty">日历加载失败。</p>';
      });
  }

  if (calPrevBtn) {
    calPrevBtn.addEventListener('click', function () {
      calMonthValue = shiftMonth(calMonthValue, -1);
      loadDashboard();
    });
  }
  if (calNextBtn) {
    calNextBtn.addEventListener('click', function () {
      if (calNextBtn.disabled) return;
      calMonthValue = shiftMonth(calMonthValue, 1);
      loadDashboard();
    });
  }

  if (ratePanel || calPanel) loadDashboard();

  /* ---------- 修改密码（安全加固）：POST /api/auth/change-password ---------- */

  var pwdForm = document.getElementById('pwdForm');
  if (pwdForm) {
    pwdForm.addEventListener('submit', function (e) {
      e.preventDefault();
      Array.prototype.forEach.call(pwdForm.querySelectorAll('.field-error'), function (p) {
        p.textContent = '';
      });
      var btn = pwdForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldPassword: document.getElementById('pwdOld').value,
          newPassword: document.getElementById('pwdNew').value,
        }),
      })
        .then(function (res) {
          return res.json().then(function (b) {
            return { ok: res.ok, body: b };
          });
        })
        .then(function (r) {
          if (!r.ok) {
            var errors = r.body.errors || {};
            Object.keys(errors).forEach(function (k) {
              var tip = pwdForm.querySelector('[data-error-for="' + k + '"]');
              if (tip) tip.textContent = errors[k];
            });
            window.showToast(r.body.message || '修改失败，请稍后再试', 'error');
            return;
          }
          pwdForm.reset();
          window.showToast(r.body.message || '密码已修改', 'success');
        })
        .catch(function () {
          window.showToast('网络异常，请稍后再试', 'error');
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  /* ---------- Day 14：个人设置（昵称 / 头像） ---------- */

  var profileAvatar = document.getElementById('profileAvatar');
  var profileNicknameText = document.getElementById('profileNicknameText');
  var profileForm = document.getElementById('profileForm');
  var avatarPickBtn = document.getElementById('avatarPickBtn');
  var avatarRemoveBtn = document.getElementById('avatarRemoveBtn');
  var avatarInput = document.getElementById('avatarInput');

  function setAvatarError(msg) {
    var tip = document.querySelector('[data-error-for="avatar"]');
    if (tip) tip.textContent = msg || '';
  }

  /** 头像变更后同步页头与顶栏（两处都换，避免用户以为没生效），并切换「移除」按钮可见性 */
  function syncAvatar(user) {
    if (profileAvatar) profileAvatar.innerHTML = window.avatarInner(user);
    var topAvatar = document.querySelector('.user-menu-btn .avatar-sm');
    if (topAvatar) topAvatar.innerHTML = window.avatarInner(user);
    if (avatarRemoveBtn) avatarRemoveBtn.hidden = !user.avatar_path;
  }

  if (profileForm) {
    profileForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var tip = profileForm.querySelector('[data-error-for="nickname"]');
      if (tip) tip.textContent = '';
      var btn = profileForm.querySelector('button[type="submit"]');
      btn.disabled = true;
      fetch('/api/auth/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: document.getElementById('profileNickname').value }),
      })
        .then(function (res) {
          return res.json().then(function (b) { return { ok: res.ok, body: b }; });
        })
        .then(function (r) {
          if (!r.ok) {
            var errors = r.body.errors || {};
            if (errors.nickname && tip) tip.textContent = errors.nickname;
            window.showToast(r.body.message || '保存失败，请稍后再试', 'error');
            return;
          }
          var u = r.body.user || {};
          if (profileNicknameText) profileNicknameText.textContent = u.nickname || '';
          var nameEl = document.querySelector('.user-menu-btn .user-menu-name');
          if (nameEl) nameEl.textContent = u.nickname || '';
          window.showToast(r.body.message || '昵称已更新', 'success');
        })
        .catch(function () {
          window.showToast('网络异常，请稍后再试', 'error');
        })
        .then(function () {
          btn.disabled = false;
        });
    });
  }

  if (avatarPickBtn && avatarInput) {
    avatarPickBtn.addEventListener('click', function () {
      avatarInput.click();
    });
    avatarInput.addEventListener('change', function () {
      var file = avatarInput.files && avatarInput.files[0];
      if (!file) return;
      setAvatarError('');
      if (file.size > 2 * 1024 * 1024) {
        setAvatarError('单张头像不能超过 2MB');
        avatarInput.value = '';
        return;
      }
      var fd = new FormData();
      fd.append('avatar', file);
      avatarPickBtn.disabled = true;
      fetch('/api/auth/avatar', { method: 'POST', body: fd })
        .then(function (res) {
          return res.json().then(function (b) { return { ok: res.ok, body: b }; });
        })
        .then(function (r) {
          if (!r.ok) {
            setAvatarError((r.body.errors || {}).avatar || '');
            window.showToast(r.body.message || '头像上传失败', 'error');
            return;
          }
          syncAvatar(r.body.user || {});
          window.showToast(r.body.message || '头像已更新', 'success');
        })
        .catch(function () {
          window.showToast('网络异常，请稍后再试', 'error');
        })
        .then(function () {
          avatarPickBtn.disabled = false;
          avatarInput.value = '';
        });
    });
  }

  if (avatarRemoveBtn) {
    avatarRemoveBtn.addEventListener('click', function () {
      if (!window.confirm('确定移除当前头像吗？')) return;
      avatarRemoveBtn.disabled = true;
      fetch('/api/auth/avatar', { method: 'DELETE' })
        .then(function (res) {
          return res.json().then(function (b) { return { ok: res.ok, body: b }; });
        })
        .then(function (r) {
          if (!r.ok) {
            window.showToast(r.body.message || '操作失败，请稍后再试', 'error');
            return;
          }
          syncAvatar(r.body.user || {});
          window.showToast(r.body.message || '头像已移除', 'success');
        })
        .catch(function () {
          window.showToast('网络异常，请稍后再试', 'error');
        })
        .then(function () {
          avatarRemoveBtn.disabled = false;
        });
    });
  }

  /* ---------- Day 14：我的搭档（组队信息，GET /api/team） ---------- */

  var teamPanel = document.getElementById('teamPanel');

  function renderTeamPanel(view) {
    if (!teamPanel) return;
    var t = view.team;
    if (!t) {
      teamPanel.innerHTML =
        '<p class="muted">还没有绑定学习搭档。</p>' +
        (view.outgoing
          ? '<p class="muted">已向 <strong>' + window.escapeHtml(view.outgoing.to_nickname) + '</strong> 发出邀请，等待对方处理。</p>'
          : '') +
        '<p><a href="/duo" class="btn btn-outline btn-sm">去双人协作广场组队</a></p>';
      return;
    }
    var p = t.partner || {};
    teamPanel.innerHTML =
      '<div class="partner-mini">' +
        '<span class="avatar" aria-hidden="true">' + window.avatarInner(p) + '</span>' +
        '<div class="partner-mini-main">' +
          '<p class="partner-mini-name">' + window.escapeHtml(p.nickname || '') + '</p>' +
          '<p class="muted">账号：' + window.escapeHtml(p.account || '-') +
            ' · 绑定于 ' + window.escapeHtml(t.bound_at || '') + '</p>' +
        '</div>' +
        '<a href="/duo" class="btn btn-outline btn-sm">去管理</a>' +
      '</div>';
  }

  if (teamPanel) {
    getJson('/api/team')
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        renderTeamPanel(r.body || {});
      })
      .catch(function () {
        teamPanel.innerHTML = '<p class="muted">组队信息加载失败，请刷新重试。</p>';
      });
  }
})();
