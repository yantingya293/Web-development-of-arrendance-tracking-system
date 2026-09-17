/* 主题引导（Day 20 从 header.ejs 内联脚本外置，配合 CSP script-src 'self'）。
   必须在 theme.css 之前同步加载：首屏绘制前定主题，避免深色用户闪白（FOUC）。
   优先读用户手选（localStorage），否则跟随系统 prefers-color-scheme。 */
(function () {
  try {
    var t = localStorage.getItem('checkin-theme');
    if (t !== 'light' && t !== 'dark') {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    if (t === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  } catch (e) { /* 隐私模式等场景下静默回退浅色 */ }
})();
