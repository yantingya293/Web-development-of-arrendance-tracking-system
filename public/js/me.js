/* 个人中心脚本（Day 7 打卡统计与改密 / Day 13 学习数据看板）
   速览：GET /api/checkins/stats → 累计 / 今日 / 连续天数 + 近 7 天热度条（4 档着色）。
   看板：GET /api/stats/dashboard?month=YYYY-MM → 任务完成率（进度条）+
   分类分布（占比条）+ 月度打卡日历（单人 + 双人合并着色，可翻月，下月不超过当前月）。
   改密：POST /api/auth/change-password（安全加固）。 */
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
})();
