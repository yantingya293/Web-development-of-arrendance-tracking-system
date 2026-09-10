/* 全站公共脚本
   Day 3：顶栏用户区登出
   Day 4：通用组件交互（用户菜单 / Toast / Loading） + 首页实时动态骨架 */
(function () {
  'use strict';

  var toastContainer = document.getElementById('toastContainer');
  var toastTemplate = document.getElementById('toastTemplate');

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

  /* 首页「实时打卡动态」骨架：Loading → Empty
     Day 6 接入真实接口后，替换为 fetch('/api/checkins') 并渲染列表 */
  var refreshBtn = document.getElementById('refreshFeedBtn');
  var feedBody = document.getElementById('feedBody');
  if (refreshBtn && feedBody) {
    var feedLoading = feedBody.querySelector('.feed-loading');
    var feedEmpty = feedBody.querySelector('.feed-empty');

    refreshBtn.addEventListener('click', function () {
      refreshBtn.disabled = true;
      feedLoading.hidden = false;
      feedEmpty.hidden = true;

      setTimeout(function () {
        feedLoading.hidden = true;
        feedEmpty.hidden = false;
        refreshBtn.disabled = false;
        window.showToast('暂无新动态（骨架占位，Day 6 接入真实数据）');
      }, 600);
    });
  }
})();
