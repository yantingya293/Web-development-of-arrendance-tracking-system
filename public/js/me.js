/* 个人中心脚本（Day 7）
   GET /api/checkins/stats → 数据速览（累计 / 今日 / 连续天数）+ 近 7 天热度条。
   热度按当日打卡次数分 4 档着色（0 / 1 / 2–3 / ≥4），悬停显示具体次数。 */
(function () {
  'use strict';

  var WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

  var heatmapRow = document.getElementById('heatmapRow');
  var heatmapHint = document.getElementById('heatmapHint');
  if (!heatmapRow) return;

  function levelOf(count) {
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    return 3;
  }

  fetch('/api/checkins/stats')
    .then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    })
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
      heatmapHint.textContent = '近 7 天共打卡 ' + weekTotal + ' 次，继续保持！';
    })
    .catch(function () {
      heatmapHint.textContent = '统计数据加载失败，请刷新重试。';
    });

  /* 修改密码（安全加固）：POST /api/auth/change-password */
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
