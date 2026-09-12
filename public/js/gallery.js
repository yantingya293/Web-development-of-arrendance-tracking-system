/* 全员打卡广场页脚本（Day 12）
   统计卡：GET /api/gallery/stats（全站累计 / 今日打卡 / 今日参与人数）。
   打卡流：GET /api/gallery（单人 + 双人合并，scope 来源筛选 + offset 分页），
   「加载更多」按 total 判断是否还有下一页；照片点击新窗口查看原图。 */
(function () {
  'use strict';

  var PAGE_LIMIT = 20;

  var statsRow = document.getElementById('galleryStatsRow');
  var tabs = document.getElementById('galleryTabs');
  var listBody = document.getElementById('galleryListBody');
  var moreBtn = document.getElementById('galleryMoreBtn');
  if (!listBody) return;

  var checkins = [];
  var total = 0;
  var scope = ''; // '' | 'solo' | 'duo'
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

  function fmtTime(submittedAt) {
    var s = String(submittedAt);
    var now = new Date();
    var p = function (x) { return String(x).padStart(2, '0'); };
    var todayStr = now.getFullYear() + '-' + p(now.getMonth() + 1) + '-' + p(now.getDate());
    if (s.slice(0, 10) === todayStr) return '今天 ' + s.slice(11, 16);
    return s.slice(5, 16);
  }

  /* ---------- 统计卡 ---------- */

  function loadStats() {
    if (!statsRow) return;
    getJson('/api/gallery/stats')
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        var s = r.body.stats || {};
        document.getElementById('gStatTotal').textContent = s.total || 0;
        document.getElementById('gStatToday').textContent = s.today || 0;
        document.getElementById('gStatUsers').textContent = s.today_users || 0;
      })
      .catch(function () {
        /* 统计失败不影响打卡流 */
      });
  }

  /* ---------- 打卡流 ---------- */

  function renderEmpty() {
    listBody.innerHTML =
      '<div class="empty-state">' +
        '<span class="empty-illustration" aria-hidden="true"></span>' +
        '<p class="empty-title">还没有打卡成果</p>' +
        '<p class="empty-hint muted">全站的单人与双人打卡会实时展示在这里，去首页提交今天的打卡吧。</p>' +
      '</div>';
  }

  function renderItem(c) {
    var photoHtml = (c.image_paths || [])
      .map(function (p) {
        return '<a class="history-photo" href="/' + escapeHtml(p) + '" target="_blank" rel="noopener">' +
          '<img src="/' + escapeHtml(p) + '" alt="打卡照片" loading="lazy" /></a>';
      })
      .join('');
    return (
      '<article class="history-item gallery-item">' +
        '<div class="history-item-main">' +
          '<p class="gallery-item-user">' +
            '<span class="avatar-sm" aria-hidden="true">' + escapeHtml(String(c.nickname).slice(0, 1)) + '</span>' +
            '<span class="gallery-item-text"><strong>' + escapeHtml(c.nickname) + '</strong> 打卡了' +
              '<strong>「' + escapeHtml(c.task_title) + '」</strong>' +
              (c.kind === 'duo' ? '<span class="tag tag-duo">共同任务</span>' : '<span class="tag">单人</span>') +
              (c.is_overdue ? '<span class="tag tag-st-overdue">逾期补卡</span>' : '') +
            '</span>' +
          '</p>' +
          '<p class="muted gallery-item-time">' + fmtTime(c.submitted_at) + '</p>' +
          (c.note ? '<p class="history-item-note">' + escapeHtml(c.note) + '</p>' : '') +
        '</div>' +
        (photoHtml ? '<div class="history-item-photos">' + photoHtml + '</div>' : '') +
      '</article>'
    );
  }

  function renderList() {
    if (!checkins.length) {
      renderEmpty();
      return;
    }
    listBody.innerHTML = checkins.map(renderItem).join('');
    moreBtn.hidden = checkins.length >= total;
  }

  function loadList(reset) {
    if (loading) return;
    loading = true;
    if (reset) {
      checkins = [];
      total = 0;
      moreBtn.hidden = true;
      listBody.innerHTML = '';
      listBody.appendChild(buildLoading());
    }
    var url = '/api/gallery?limit=' + PAGE_LIMIT + '&offset=' + checkins.length;
    if (scope) url += '&scope=' + scope;
    getJson(url)
      .then(function (r) {
        if (!r.ok) throw new Error(r.body.message);
        checkins = checkins.concat(r.body.checkins || []);
        total = r.body.total || 0;
        renderList();
      })
      .catch(function () {
        if (!checkins.length) {
          listBody.innerHTML =
            '<div class="empty-state"><p class="empty-title">加载失败</p>' +
            '<p class="empty-hint muted">网络异常，请刷新重试。</p></div>';
        } else {
          window.showToast('加载失败，请稍后再试', 'error');
        }
      })
      .then(function () {
        loading = false;
      });
  }

  /** 与服务端 loading 组件同构的加载态（切换筛选时插入列表顶部） */
  function buildLoading() {
    var div = document.createElement('div');
    div.className = 'loading';
    div.setAttribute('role', 'status');
    div.innerHTML =
      '<span class="spinner" aria-hidden="true"></span><p class="loading-text">正在加载打卡广场…</p>';
    return div;
  }

  /* ---------- 筛选与分页事件 ---------- */

  if (tabs) {
    tabs.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-scope]');
      if (!btn || btn.classList.contains('active')) return;
      tabs.querySelectorAll('.tab').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      scope = btn.getAttribute('data-scope') || '';
      loadList(true);
    });
  }

  if (moreBtn) {
    moreBtn.addEventListener('click', function () {
      loadList(false);
    });
  }

  loadStats();
  loadList(true);
})();
