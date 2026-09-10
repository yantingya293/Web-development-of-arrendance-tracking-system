/* 全站公共脚本（Day 3）：顶栏用户区交互 */
(function () {
  // 登出：POST /api/auth/logout 成功后回首页
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
          alert('退出失败，请稍后再试');
        });
    });
  }
})();
