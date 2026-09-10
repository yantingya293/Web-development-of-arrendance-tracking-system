/* 登录 / 注册页脚本（Day 3）：客户端校验 + 提交 + 错误提示
   服务端策略（保持一致）：账号 3–24 位字母数字下划线；密码 6–32 位且含字母和数字。 */
(function () {
  var form = document.getElementById('authForm');
  if (!form) return;

  var formError = document.getElementById('formError');
  var isRegister = form.getAttribute('action').indexOf('/register') !== -1;

  function setErrorFor(field, msg) {
    var tip = form.querySelector('[data-error-for="' + field + '"]');
    if (tip) tip.textContent = msg || '';
    return !msg;
  }

  function validate(data) {
    var ok = true;
    ok = setErrorFor('nickname', '') && ok; // 先清空旧提示
    ok = setErrorFor('account', '') && ok;
    ok = setErrorFor('password', '') && ok;
    ok = setErrorFor('confirmPassword', '') && ok;
    hideFormError();

    if (isRegister) {
      var nickname = (data.nickname || '').trim();
      if (!nickname) ok = setErrorFor('nickname', '请填写昵称') && ok;
      else if (nickname.length > 20) ok = setErrorFor('nickname', '昵称不能超过 20 个字符') && ok;
    }

    var account = (data.account || '').trim();
    if (!account) ok = setErrorFor('account', '请填写账号') && ok;
    else if (!/^[A-Za-z0-9_]{3,24}$/.test(account))
      ok = setErrorFor('account', '账号为 3–24 位字母、数字或下划线') && ok;

    var password = data.password || '';
    if (!password) ok = setErrorFor('password', '请填写密码') && ok;
    else if (!/^(?=.*[A-Za-z])(?=.*\d)\S{6,32}$/.test(password))
      ok = setErrorFor('password', '密码为 6–32 位，且须同时包含字母和数字') && ok;

    if (isRegister && password !== (data.confirmPassword || ''))
      ok = setErrorFor('confirmPassword', '两次输入的密码不一致') && ok;

    return ok;
  }

  function showFormError(msg) {
    formError.textContent = msg;
    formError.hidden = false;
  }
  function hideFormError() {
    formError.hidden = true;
    formError.textContent = '';
  }

  function submit(data) {
    var btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    fetch(form.getAttribute('action'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(function (res) {
        return res.json().then(function (body) { return { ok: res.ok, body: body }; });
      })
      .then(function (_ref) {
        var ok = _ref.ok, body = _ref.body;
        if (!ok) {
          var errors = body.errors || {};
          var firstField = Object.keys(errors)[0];
          if (firstField) setErrorFor(firstField, errors[firstField]);
          showFormError(body.message || '提交失败，请稍后再试');
          btn.disabled = false;
          return;
        }
        if (isRegister) {
          // 注册成功 → 去登录页（服务端已自动登录，这里仍引导走一遍登录流程）
          window.location.href = '/login?registered=1';
        } else {
          window.location.href = form.getAttribute('data-next') || '/';
        }
      })
      .catch(function () {
        showFormError('网络异常，请稍后再试');
        btn.disabled = false;
      });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var data = {};
    new FormData(form).forEach(function (v, k) { data[k] = v; });
    if (validate(data)) submit(data);
  });
})();
