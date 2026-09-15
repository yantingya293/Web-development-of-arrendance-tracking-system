/* 全站公共脚本
   Day 3：顶栏用户区登出
   Day 4：通用组件交互（用户菜单 / Toast / Loading）
   Day 7：首页「实时打卡动态」接入 /api/checkins（登录用户本人最近 10 条；全员广场 Day 12 上线）
   Day 14：全局头像渲染工具 window.avatarInner（有头像出图，否则回落昵称首字） */
(function () {
  'use strict';

  var toastContainer = document.getElementById('toastContainer');
  var toastTemplate = document.getElementById('toastTemplate');

  /** HTML 转义（属性与文本通用） */
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  window.escapeHtml = escapeHtml;

  /* 头像内容片段：有 avatar_path 出 <img>，否则回落昵称首字。
     用法：el.innerHTML = window.avatarInner(user)（user 需含 nickname / avatar_path） */
  window.avatarInner = function (user) {
    var u = user || {};
    if (u.avatar_path) return '<img src="/' + escapeHtml(u.avatar_path) + '" alt="" />';
    return escapeHtml(String(u.nickname || '?').slice(0, 1));
  };

  /* Toast：window.showToast(message, type, duration)
     type: info（默认）| success | error */
  window.showToast = function (message, type, duration) {
    if (!toastContainer || !toastTemplate) return;
    var toast = toastTemplate.content.firstElementChild.cloneNode(true);
    toast.classList.add('toast-' + (type || 'info'));
    toast.querySelector('.toast-message').textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(function () {
      toast.classList.add('hide');
      setTimeout(function () {
        toast.remove();
      }, 200);
    }, duration || 2600);
  };

  /* 顶栏用户菜单：点击展开 / 点击外部或 ESC 收起 */
  var menuBtn = document.getElementById('userMenuBtn');
  var menuList = document.getElementById('userMenuList');
  if (menuBtn && menuList) {
    var setMenuOpen = function (open) {
      menuList.hidden = !open;
      menuBtn.setAttribute('aria-expanded', String(open));
    };

    menuBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      setMenuOpen(menuList.hidden);
    });

    document.addEventListener('click', function (e) {
      if (!menuList.hidden && !menuList.contains(e.target) && !menuBtn.contains(e.target)) {
        setMenuOpen(false);
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !menuList.hidden) {
        setMenuOpen(false);
        menuBtn.focus();
      }
    });
  }

  /* 登出：POST /api/auth/logout 成功后回首页 */
  var logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function () {
      logoutBtn.disabled = true;
      fetch('/api/auth/logout', { method: 'POST' })
        .then(function () {
          window.location.href = '/';
        })
        .catch(function () {
          logoutBtn.disabled = false;
          window.showToast('退出失败，请稍后再试', 'error');
        });
    });
  }

  /* 首页「实时打卡动态」（Day 7）：拉取本人最近 10 条单人打卡
     checkin.js 提交成功后派发 checkin:created，这里联动刷新 */
  var refreshBtn = document.getElementById('refreshFeedBtn');
  var feedList = document.getElementById('feedList');
  if (refreshBtn && feedList) {
    var feedLoading = feedList.previousElementSibling; // .feed-loading（服务端渲染在列表前面）

    function escapeFeedHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
      });
    }

    function fmtFeedTime(submittedAt) {
      var s = String(submittedAt);
      var today = new Date();
      var p = function (x) { return String(x).padStart(2, '0'); };
      var todayStr = today.getFullYear() + '-' + p(today.getMonth() + 1) + '-' + p(today.getDate());
      if (s.slice(0, 10) === todayStr) return '今天 ' + s.slice(11, 16);
      return s.slice(5, 16);
    }

    function renderFeed(checkins) {
      if (!checkins.length) {
        feedList.innerHTML =
          '<div class="empty-state">' +
            '<span class="empty-illustration" aria-hidden="true"></span>' +
            '<p class="empty-title">暂无打卡动态</p>' +
            '<p class="empty-hint muted">完成左侧打卡提交后，动态会实时显示在这里。</p>' +
          '</div>';
        return;
      }
      feedList.innerHTML = checkins
        .map(function (c) {
          var photo = c.image_paths && c.image_paths[0];
          return (
            '<article class="feed-item">' +
              '<span class="avatar-sm" aria-hidden="true">我</span>' +
              '<div class="feed-item-main">' +
                '<p class="feed-item-text">打卡了「<strong>' + escapeFeedHtml(c.task_title) + '</strong>」' +
                  (c.is_overdue ? '<span class="tag tag-st-overdue">逾期补卡</span>' : '') +
                '</p>' +
                '<p class="feed-item-time muted">' + fmtFeedTime(c.submitted_at) + '</p>' +
              '</div>' +
              (photo
                ? '<a class="feed-thumb" href="/' + escapeFeedHtml(photo) + '" target="_blank" rel="noopener">' +
                    '<img src="/' + escapeFeedHtml(photo) + '" alt="打卡照片" loading="lazy" /></a>'
                : '') +
            '</article>'
          );
        })
        .join('');
    }

    function loadFeed(manual) {
      refreshBtn.disabled = true;
      if (feedLoading) feedLoading.hidden = false;
      feedList.innerHTML = '';
      fetch('/api/checkins?limit=10')
        .then(function (res) {
          if (res.status === 401) {
            // 未登录：index.ejs 已渲染登录引导，这里保持安静
            feedList.innerHTML = '';
            return null;
          }
          return res.json().then(function (b) {
            return { ok: res.ok, body: b };
          });
        })
        .then(function (r) {
          if (feedLoading) feedLoading.hidden = true;
          if (!r) return;
          if (!r.ok) throw new Error(r.body.message);
          renderFeed(r.body.checkins || []);
          if (manual) window.showToast('动态已刷新', 'success');
        })
        .catch(function () {
          if (feedLoading) feedLoading.hidden = true;
          feedList.innerHTML =
            '<div class="empty-state"><p class="empty-title">加载失败</p>' +
            '<p class="empty-hint muted">网络异常，请稍后点击「刷新」重试。</p></div>';
        })
        .then(function () {
          refreshBtn.disabled = false;
        });
    }

    refreshBtn.addEventListener('click', function () {
      loadFeed(true);
    });

    document.addEventListener('checkin:created', function () {
      loadFeed(false);
    });

    loadFeed(false);
  }
})();
