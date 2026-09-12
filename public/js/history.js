/* 历史记录页脚本（Day 7）
   统计卡：GET /api/checkins/stats（累计 / 今日 / 连续天数）
   历史列表：GET /api/checkins（category / date 筛选 + offset 分页），按打卡日期分组渲染，
   「加载更多」按 total 判断是否还有下一页。 */
(function () {
  'use strict';

  var CATEGORY_LABELS = { daily: '每日任务', weekly: '每周重点', question: '学习问题' };
  var PAGE_LIMIT = 20;

  var statsRow = document.getElementById('statsRow');
  var filterForm = document.getElementById('historyFilter');
  var filterCategory = document.getElementById('filterCategory');
  var filterDate = document.getElementById('filterDate');
  var filterReset = document.getElementById('filterReset');
  var listBody = document.getElementById('historyListBody');
  var moreBtn = document.getElementById('historyMoreBtn');
  if (!listBody) return;

  var checkins = [];
  var total = 0;
  var loading = false;

  /* ---------- 工具 ---------- */

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getJson(url) {
    return fetch(url).then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    });
  }

  function todayStr() {
    var d = new Date();
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function shiftDay(day, n) {
    var d = new Date(day + 'T00:00:00');
    d.setTime(d.getTime() + n * 86400000);
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  var WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  function dayLabel(day) {
    var today = todayStr();
    if (day === today) return '今天';
    if (day === shiftDay(today, -1)) return '昨天';
    var d = new Date(day + 'T00:00:00');
    return day + ' · ' + WEEKDAYS[d.getDay()];
  }

  /* ---------- 统计卡 ---------- */

  function loadStats() {
    if (!statsRow) return;
    getJson('/api/checkins/stats')
      .then(function (r) {
        if (!r.ok) return;
        var s = r.body.stats || {};
        document.getElementById('statTotal').textContent = s.total || 0;
        document.getElementById('statToday').textContent = s.today || 0;
        document.getElementById('statStreak').textContent = s.streak || 0;
      })
      .catch(function () { /* 统计加载失败不打扰列表 */ });
  }

  /* ---------- 历史列表 ---------- */

  function buildQuery() {
    var params = ['limit=' + PAGE_LIMIT, 'offset=' + checkins.length];
    if (filterCategory.value) params.push('category=' + encodeURIComponent(filterCategory.value));
    if (filterDate.value) params.push('date=' + encodeURIComponent(filterDate.value));
    return params.join('&');
  }

  function renderGroup(day, items) {
    var rows = items
      .map(function (c) {
        var meta = [];
        meta.push('<span class="tag tag-cat-' + c.task_category + '">' + (CATEGORY_LABELS[c.task_category] || c.task_category) + '</span>');
        if (c.is_overdue) meta.push('<span class="tag tag-st-overdue">逾期补卡</span>');
        var photos = (c.image_paths || [])
          .map(function (p) {
            return '<a class="history-photo" href="/' + escapeHtml(p) + '" target="_blank" rel="noopener">' +
              '<img src="/' + escapeHtml(p) + '" alt="打卡照片" loading="lazy" /></a>';
          })
          .join('');
        return (
          '<article class="history-item">' +
            '<div class="history-item-main">' +
              '<p class="history-item-time muted">' + escapeHtml(String(c.submitted_at).slice(11, 16)) + '</p>' +
              '<h3 class="history-item-title">' + escapeHtml(c.task_title) + '</h3>' +
              '<div class="history-item-tags">' + meta.join('') + '</div>' +
              (c.note ? '<p class="history-item-note">' + escapeHtml(c.note) + '</p>' : '') +
            '</div>' +
            (photos ? '<div class="history-item-photos">' + photos + '</div>' : '') +
          '</article>'
        );
      })
      .join('');
    return (
      '<section class="history-group">' +
        '<h3 class="history-group-day">' + dayLabel(day) + '</h3>' +
        rows +
      '</section>'
    );
  }

  function renderList() {
    if (!checkins.length) {
      listBody.innerHTML =
        '<div class="empty-state">' +
          '<span class="empty-illustration" aria-hidden="true"></span>' +
          '<p class="empty-title">暂无打卡记录</p>' +
          '<p class="empty-hint muted">还没有符合筛选条件的打卡，回首页完成一次打卡吧。</p>' +
          '<a class="btn btn-primary btn-sm" href="/">去打卡</a>' +
        '</div>';
      return;
    }
    var groups = [];
    var currentDay = null;
    var currentItems = [];
    checkins.forEach(function (c) {
      var day = String(c.submitted_at).slice(0, 10);
      if (day !== currentDay) {
        if (currentDay) groups.push(renderGroup(currentDay, currentItems));
        currentDay = day;
        currentItems = [];
      }
      currentItems.push(c);
    });
    if (currentDay) groups.push(renderGroup(currentDay, currentItems));
    listBody.innerHTML = groups.join('');
  }

  function loadMore() {
    if (loading) return;
    loading = true;
    moreBtn.disabled = true;
    getJson('/api/checkins?' + buildQuery())
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        checkins = checkins.concat(r.body.checkins || []);
        total = r.body.total || 0;
        renderList();
        moreBtn.hidden = checkins.length >= total;
      })
      .catch(function () {
        window.showToast('加载失败，请稍后重试', 'error');
      })
      .then(function () {
        loading = false;
        moreBtn.disabled = false;
      });
  }

  filterForm.addEventListener('submit', function (e) {
    e.preventDefault();
    checkins = [];
    listBody.innerHTML =
      '<div class="loading" role="status" aria-live="polite">' +
        '<span class="spinner" aria-hidden="true"></span><p class="loading-text">正在加载打卡历史…</p>' +
      '</div>';
    moreBtn.hidden = true;
    loadMore();
  });

  filterReset.addEventListener('click', function () {
    filterCategory.value = '';
    filterDate.value = '';
    filterForm.dispatchEvent(new Event('submit', { cancelable: true }));
  });

  moreBtn.addEventListener('click', loadMore);

  loadStats();
  loadMore();
})();
