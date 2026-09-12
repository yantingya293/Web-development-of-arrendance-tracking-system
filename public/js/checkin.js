/* 首页「打卡提交」板块脚本（Day 6）
   任务下拉（/api/tasks，排除已完成，按分类分组）+ 今日已打卡标记（/api/checkins）
   照片选择与本地预览（JPG / PNG，单张 ≤ 10MB，最多 3 张）
   提交 multipart → POST /api/checkins；成功后派发 checkin:created 事件（tasks.js 联动刷新）。
   tasks.js 的卡片「打卡」按钮通过 window.selectCheckinTask(taskId) 联动本表单。 */
(function () {
  'use strict';

  var CATEGORY_LABELS = { daily: '每日任务', weekly: '每周重点', question: '学习问题' };
  var CATEGORY_ORDER = ['daily', 'weekly', 'question'];
  var ACCEPT_MIMES = ['image/jpeg', 'image/png'];
  var MAX_PHOTOS = 3;
  var MAX_SIZE = 10 * 1024 * 1024;

  var form = document.getElementById('checkinForm');
  if (!form) return; // 未登录：服务端渲染的是禁用占位表单，无需初始化

  var taskSelect = document.getElementById('checkinTask');
  var photoPickBtn = document.getElementById('photoPickBtn');
  var photoInput = document.getElementById('photoInput');
  var photoPreview = document.getElementById('photoPreview');
  var noteInput = document.getElementById('checkinNote');
  var submitBtn = document.getElementById('checkinSubmitBtn');
  var formError = document.getElementById('checkinFormError');

  var photos = []; // { file: File, url: objectURL }

  /* ---------- 工具 ---------- */

  function request(method, url, body) {
    return fetch(url, {
      method: method,
      body: body, // FormData：不设 Content-Type，交给浏览器补 multipart 边界
    }).then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    });
  }

  function getJson(url) {
    return fetch(url).then(function (res) {
      return res.json().then(function (b) {
        return { ok: res.ok, body: b };
      });
    });
  }

  /** 本地日期 'YYYY-MM-DD'（与服务端 localtime 字符串的前 10 位对齐比较） */
  function todayStr() {
    var d = new Date();
    var p = function (x) { return String(x).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function setFieldError(field, msg) {
    var tip = form.querySelector('[data-error-for="' + field + '"]');
    if (tip) tip.textContent = msg || '';
  }

  function clearErrors() {
    ['taskId', 'photos', 'note'].forEach(function (f) { setFieldError(f, ''); });
    formError.hidden = true;
    formError.textContent = '';
  }

  /* ---------- 任务下拉 + 今日已打卡标记 ---------- */

  function buildOption(task, checkedToday) {
    var opt = document.createElement('option');
    opt.value = task.id;
    var label = task.title;
    if (task.owner_id === null) label = '[公共] ' + label;
    if (task.status === 'overdue') label += '（已逾期，可补打卡）';
    if (checkedToday) label += ' · 今日已打卡';
    opt.textContent = label;
    return opt;
  }

  function renderSelect(tasks, checkedTodayIds, keepId) {
    taskSelect.innerHTML = '';

    var available = tasks.filter(function (t) { return t.status !== 'completed'; });
    if (!available.length) {
      var none = document.createElement('option');
      none.value = '';
      none.textContent = '暂无可打卡的任务，先去新建一个吧';
      taskSelect.appendChild(none);
      submitBtn.disabled = true;
      return;
    }

    var placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '请选择要打卡的任务';
    taskSelect.appendChild(placeholder);

    CATEGORY_ORDER.forEach(function (cat) {
      var group = available.filter(function (t) { return t.category === cat; });
      if (!group.length) return;
      var og = document.createElement('optgroup');
      og.label = CATEGORY_LABELS[cat] || cat;
      group.forEach(function (t) {
        og.appendChild(buildOption(t, checkedTodayIds.indexOf(t.id) !== -1));
      });
      taskSelect.appendChild(og);
    });

    submitBtn.disabled = false;
    if (keepId) {
      var keep = taskSelect.querySelector('option[value="' + keepId + '"]');
      taskSelect.value = keep ? String(keepId) : '';
    } else {
      taskSelect.value = '';
    }
  }

  var lastTasks = [];
  var lastCheckedToday = [];

  function refreshSelect(keepId) {
    Promise.all([getJson('/api/tasks'), getJson('/api/checkins?limit=50')])
      .then(function (rs) {
        if (!rs[0].ok || !rs[1].ok) throw new Error('加载失败');
        lastTasks = rs[0].body.tasks || [];
        var today = todayStr();
        lastCheckedToday = (rs[1].body.checkins || [])
          .filter(function (c) { return String(c.submitted_at).slice(0, 10) === today; })
          .map(function (c) { return c.task_id })
          .filter(function (v, i, arr) { return arr.indexOf(v) === i; });
        renderSelect(lastTasks, lastCheckedToday, keepId);
      })
      .catch(function () {
        taskSelect.innerHTML = '';
        var opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '任务加载失败，请刷新重试';
        taskSelect.appendChild(opt);
      });
  }

  /* ---------- 照片选择与预览 ---------- */

  function renderPreview() {
    photoPreview.innerHTML = '';
    photos.forEach(function (p, i) {
      var item = document.createElement('div');
      item.className = 'photo-item';

      var img = document.createElement('img');
      img.src = p.url;
      img.alt = '打卡照片预览 ' + (i + 1);

      var rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'photo-remove';
      rm.setAttribute('aria-label', '移除照片 ' + (i + 1));
      rm.textContent = '×';
      rm.dataset.index = String(i);

      item.appendChild(img);
      item.appendChild(rm);
      photoPreview.appendChild(item);
    });
    photoPreview.hidden = photos.length === 0;
    if (photos.length >= MAX_PHOTOS) {
      photoPickBtn.disabled = true;
      photoPickBtn.classList.add('is-full');
    } else {
      photoPickBtn.disabled = false;
      photoPickBtn.classList.remove('is-full');
    }
  }

  function addFiles(fileList) {
    setFieldError('photos', '');
    var rejected = [];
    var added = 0;
    Array.prototype.forEach.call(fileList, function (f) {
      if (photos.length >= MAX_PHOTOS) return;
      if (ACCEPT_MIMES.indexOf(f.type) === -1 || !/\.(jpe?g|png)$/i.test(f.name)) {
        rejected.push(f.name + '（仅支持 JPG / PNG）');
        return;
      }
      if (f.size > MAX_SIZE) {
        rejected.push(f.name + '（超过 10MB）');
        return;
      }
      photos.push({ file: f, url: URL.createObjectURL(f) });
      added++;
    });
    var skipped = fileList.length - added - rejected.length;
    if (skipped > 0) window.showToast('最多上传 ' + MAX_PHOTOS + ' 张照片，多余部分已忽略', 'info');
    if (rejected.length) {
      setFieldError('photos', '以下文件未添加：' + rejected.join('、'));
    }
    renderPreview();
  }

  photoPickBtn.addEventListener('click', function () {
    photoInput.click();
  });

  photoInput.addEventListener('change', function () {
    if (photoInput.files && photoInput.files.length) addFiles(photoInput.files);
    photoInput.value = ''; // 允许移除后重新选择同一文件
  });

  photoPreview.addEventListener('click', function (e) {
    var btn = e.target.closest('.photo-remove');
    if (!btn) return;
    var i = Number(btn.dataset.index);
    if (photos[i]) {
      URL.revokeObjectURL(photos[i].url);
      photos.splice(i, 1);
      renderPreview();
    }
  });

  function clearPhotos() {
    photos.forEach(function (p) { URL.revokeObjectURL(p.url); });
    photos = [];
    renderPreview();
  }

  /* ---------- 提交 ---------- */

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearErrors();

    var taskId = taskSelect.value;
    if (!taskId) {
      setFieldError('taskId', '请选择要打卡的任务');
      taskSelect.focus();
      return;
    }
    if (!photos.length) {
      setFieldError('photos', '请至少上传 1 张照片作为打卡凭证');
      return;
    }

    var data = new FormData();
    data.append('taskId', taskId);
    data.append('note', noteInput.value.trim());
    photos.forEach(function (p) { data.append('photos', p.file, p.file.name); });

    submitBtn.disabled = true;
    submitBtn.textContent = '提交中…';
    request('POST', '/api/checkins', data)
      .then(function (r) {
        if (!r.ok) {
          var errors = r.body.errors || {};
          Object.keys(errors).forEach(function (k) { setFieldError(k, errors[k]); });
          formError.textContent = r.body.message || '打卡失败，请稍后再试';
          formError.hidden = false;
          if (r.body && /不存在/.test(r.body.message || '')) refreshSelect(); // 任务已被删除等情况
          return;
        }
        window.showToast('打卡成功，继续保持！', 'success');
        noteInput.value = '';
        clearPhotos();
        refreshSelect(); // 刷新「今日已打卡」标记
        document.dispatchEvent(new CustomEvent('checkin:created', { detail: { taskId: Number(taskId) } }));
      })
      .catch(function () {
        formError.textContent = '网络异常，请稍后再试';
        formError.hidden = false;
      })
      .then(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = '提交打卡';
      });
  });

  /* ---------- 供任务卡片「打卡」按钮联动 ---------- */

  window.selectCheckinTask = function (taskId) {
    var opt = taskSelect.querySelector('option[value="' + taskId + '"]');
    if (!opt) return false;
    taskSelect.value = String(taskId);
    // 瞬时滚动：不依赖动画完成（移动端 / 降级动画环境也能一次到位）
    form.scrollIntoView({ block: 'center' });
    noteInput.focus({ preventScroll: true });
    return true;
  };

  refreshSelect();
})();
