// Giao diện màn hình cảm ứng của trạm (1280×800).
// Dùng chung cho bản mô phỏng (nhúng vào scene 3D) và máy thật (chạy fullscreen).
import { telex } from './telex.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';

const socket = window.io({ transports: ['websocket', 'polling'] });
let S = null;                    // trạng thái server
let local = { page: 'idle' };    // trang cục bộ khi IDLE: idle | users | new
let form = { field: 'name', nameRaw: '', account: '', error: '' };
let users = [];
let search = '';
let lastFrame = null;            // ảnh camera quét gần nhất (kèm khung nhận diện)
let payoutDeadline = null;       // thời điểm tự chuyển khoản (ms)
let payoutSending = false;

// ------------------------------------------------------------------ socket
socket.on('connect', () => socket.emit('join', { role: 'screen' }, (r) => r?.state && setState(r.state)));
socket.on('state', setState);
socket.on('screen:message', (m) => { if (m.code !== 'slot') notice(m.text, m.level); });
socket.on('scan:frame', (f) => { lastFrame = { ...f, at: Date.now() }; if (S?.processing) renderProcessing(); });
socket.on('slot:result', showSlotCard);
socket.on('session:countdown', ({ seconds }) => showCountdown(seconds));
const ui = (action, extra = {}) => new Promise((res) => socket.emit('ui', { action, ...extra }, res));

function setState(s) {
  const prev = S;
  S = s;
  if (s.countdown == null) hideCountdown();
  // Về màn hình chờ khi phiên kết thúc (vật bỏ qua lỗ lúc chưa chọn tên thì giữ nguyên trang đang xem)
  if (s.state === 'IDLE' && prev && prev.state !== 'IDLE' && prev.user) { local = { page: 'idle' }; }
  if (s.processing && !prev?.processing) lastFrame = null;
  payoutDeadline = s.payout_in != null ? Date.now() + s.payout_in * 1000 : null;
  payoutSending = false;
  render();
}

// Mọi chạm lên màn hình = có thao tác (reset đồng hồ tự đăng xuất), giới hạn 1 lần / 3 giây
let lastAct = 0;
document.addEventListener('pointerdown', () => {
  const now = Date.now();
  if (S && ['READY', 'RESULT'].includes(S.state) && now - lastAct > 3000) { lastAct = now; ui('activity'); }
}, true);

// ------------------------------------------------------------------ thông báo, đếm ngược, đồng hồ
let noticeTimer;
function notice(text, level = 'info') {
  const el = $('#notice');
  el.className = `notice show ${level}`;
  el.textContent = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.className = 'notice'; }, 4500);
}
function showCountdown(sec) {
  $('#countdown').classList.remove('hidden');
  $('#countdown-num').textContent = sec;
}
function hideCountdown() { $('#countdown').classList.add('hidden'); }
setInterval(() => {
  const d = new Date();
  $('#clock').textContent = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}, 1000);

// ------------------------------------------------------------------ hiển thị
function render() {
  if (!S) { view.innerHTML = '<div class="center muted">Đang kết nối…</div>'; return; }
  $('#bar-user').innerHTML = S.user
    ? `<span class="avatar">${esc(S.user.name[0] || '?')}</span>${esc(S.user.display_name)} · Đã nhận <b>${vnd(S.user.total_received)}</b>`
    : '';
  if (S.state === 'IDLE') {
    if (local.page === 'users') return renderUsers();
    if (local.page === 'new') return renderNewUser();
    return renderIdle();
  }
  if (S.state === 'READY') return renderSession();
  if (S.state === 'RESULT') return renderResult();
  return renderProcessing();
}

function renderIdle() {
  const st = S.station;
  const full = st.is_full;
  const openWarn = !S.sensors.door_closed || !S.sensors.feed_drawer_in;
  view.innerHTML = `
    <section class="idle">
      <div class="hero">
        <div class="hero-logo">♻</div>
        <h1>Đổi chai nhựa & lon nhôm<br>lấy tiền</h1>
        <div class="prices">
          <div class="price"><span class="ico bottle"></span><div><small>Chai nhựa</small><b>${vnd(S.prices.bottle)}</b></div></div>
          <div class="price"><span class="ico can"></span><div><small>Lon nhôm</small><b>${vnd(S.prices.can)}</b></div></div>
        </div>
      </div>
      <div class="idle-side">
        ${full ? `<div class="banner error"><b>Trạm đã đầy</b><br>Vui lòng quay lại sau. Xin lỗi vì sự bất tiện.</div>` : ''}
        ${S.maintenance ? `<div class="banner warning"><b>Đang thu gom / bảo trì</b><br>Trạm tạm ngưng nhận rác trong ít phút.</div>` : ''}
        ${openWarn ? `<div class="banner warning">Vui lòng đẩy khay vào và đóng cửa</div>` : ''}
        <button class="btn btn-primary btn-xl" data-act="start" ${full || S.maintenance ? 'disabled' : ''}>Bắt đầu</button>
        <ol class="steps-mini">
          <li>Chọn tên của bạn</li><li>Mở cửa, kéo khay, bỏ chai/lon</li><li>Đẩy khay, đóng cửa, bấm <b>TÍNH TIỀN</b></li>
        </ol>
        <div class="slot-hint ${S.slot_open ? '' : 'off'}"><span class="slot-dot"></span>
          <span>Bỏ nhanh từng chai/lon qua <b>lỗ tròn phía trên cửa</b>, không cần chọn tên<br><small>Chưa chọn tên: chỉ phân loại, không tính tiền</small></span></div>
        <div class="storage">Kho chứa: ${st.storage_count}/${st.storage_capacity}
          <div class="meter"><i style="width:${Math.min(100, (st.storage_count / st.storage_capacity) * 100)}%"></i></div></div>
      </div>
    </section>`;
}

async function loadUsers() {
  const r = await fetch('/api/users?q=' + encodeURIComponent(search));
  users = await r.json();
}

function renderUsers() {
  const list = users.length
    ? users.map((u) => `<button class="user" data-act="pick" data-id="${u.id}"><span class="avatar">${esc(u.name[0] || '?')}</span><span>${esc(u.display_name)}</span></button>`).join('')
    : `<div class="empty">${search ? 'Không tìm thấy tên phù hợp' : 'Chưa có người dùng nào'}</div>`;
  view.innerHTML = `
    <section class="users">
      <div class="row-head">
        <button class="btn btn-ghost" data-act="home">‹ Quay lại</button>
        <h2>Chọn tên của bạn</h2>
        <button class="btn btn-primary" data-act="new">+ Người dùng mới</button>
      </div>
      <div class="search"><span>🔍</span><input id="search" placeholder="Gõ tên để tìm…" value="${esc(search)}" autocomplete="off"></div>
      <div class="user-grid">${list}</div>
    </section>`;
  const input = $('#search');
  input.addEventListener('input', async () => { search = input.value; await loadUsers(); renderUsersKeepFocus(); });
}
function renderUsersKeepFocus() {
  const pos = $('#search')?.selectionStart;
  renderUsers();
  const i = $('#search'); i.focus(); if (pos != null) i.setSelectionRange(pos, pos);
}

// ---- Người dùng mới: bàn phím ảo (chữ có Telex / số)
const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function renderNewUser() {
  const name = telex(form.nameRaw);
  const kb = form.field === 'name'
    ? `<div class="kb">
        ${KEYS.map((row, i) => `<div class="kb-row">${[...row].map((k) => `<button class="key" data-key="${k}">${k}</button>`).join('')}${i === 2 ? '<button class="key wide" data-key="back">⌫</button>' : ''}</div>`).join('')}
        <div class="kb-row"><button class="key wide" data-key="clear">Xóa</button><button class="key space" data-key=" ">Dấu cách</button><button class="key wide primary" data-key="next">Tiếp ›</button></div>
        <p class="kb-hint">Gõ Telex: aa=â, aw=ă, ee=ê, oo=ô, ow=ơ, uw=ư, dd=đ · dấu: s sắc, f huyền, r hỏi, x ngã, j nặng</p>
      </div>`
    : `<div class="pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="key" data-key="${n}">${n}</button>`).join('')}
        <button class="key" data-key="clear">Xóa</button><button class="key" data-key="0">0</button><button class="key" data-key="back">⌫</button>
      </div>`;
  view.innerHTML = `
    <section class="newuser">
      <div class="row-head">
        <button class="btn btn-ghost" data-act="users">‹ Quay lại</button>
        <h2>Người dùng mới</h2>
        <button class="btn btn-primary" data-act="save" ${name.trim() && form.account.length >= 6 ? '' : 'disabled'}>Lưu</button>
      </div>
      <div class="fields">
        <button class="field ${form.field === 'name' ? 'active' : ''}" data-act="field" data-f="name">
          <small>Họ và tên</small><span>${esc(name) || '<i>Nhập tên…</i>'}</span></button>
        <button class="field ${form.field === 'account' ? 'active' : ''}" data-act="field" data-f="account">
          <small>Số tài khoản (6–19 số)</small><span>${esc(form.account) || '<i>Nhập số tài khoản…</i>'}</span></button>
      </div>
      ${form.error ? `<div class="banner error">${esc(form.error)}</div>` : ''}
      ${kb}
    </section>`;
}

function typeKey(k) {
  form.error = '';
  if (form.field === 'name') {
    if (k === 'back') form.nameRaw = form.nameRaw.slice(0, -1);
    else if (k === 'clear') form.nameRaw = '';
    else if (k === 'next') form.field = 'account';
    else if (k === ' ') { if (form.nameRaw && !form.nameRaw.endsWith(' ')) form.nameRaw += ' '; }
    else if (form.nameRaw.length < 120) form.nameRaw += k;
  } else {
    if (k === 'back') form.account = form.account.slice(0, -1);
    else if (k === 'clear') form.account = '';
    else if (/^\d$/.test(k) && form.account.length < 19) form.account += k;
  }
  renderNewUser();
}

// Bàn phím thật (bản mô phỏng / máy có bàn phím)
document.addEventListener('keydown', (e) => {
  if (!S || S.state !== 'IDLE' || local.page !== 'new') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  let k = null;
  if (e.key === 'Backspace') k = 'back';
  else if (e.key === 'Enter') k = form.field === 'name' ? 'next' : null;
  else if (e.key === 'Tab') { e.preventDefault(); form.field = form.field === 'name' ? 'account' : 'name'; renderNewUser(); return; }
  else if (e.key.length === 1) k = form.field === 'name' ? (/[a-zA-Z ]/.test(e.key) ? e.key.toLowerCase() : null) : e.key;
  if (k) { e.preventDefault(); typeKey(k); }
  if (e.key === 'Enter' && form.field === 'account') save();
});

async function save() {
  const name = telex(form.nameRaw).trim();
  const r = await fetch('/api/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, account_number: form.account }),
  });
  const data = await r.json();
  if (!r.ok) { form.error = data.error || 'Không lưu được'; renderNewUser(); return; }
  form = { field: 'name', nameRaw: '', account: '', error: '' };
  const res = await ui('select_user', { user_id: data.id });
  if (!res?.ok) { local.page = 'users'; await loadUsers(); render(); }
}

// ---- Phiên làm việc
function check(ok, text) { return `<li class="${ok ? 'ok' : ''}"><span class="tick">${ok ? '✓' : ''}</span><span>${text}</span></li>`; }
let sessionUserId = null;
let trayOpened = false; // trong phiên này người dùng đã kéo khay ra chưa
function renderSession() {
  const sen = S.sensors;
  if (sessionUserId !== S.user.id) { sessionUserId = S.user.id; trayOpened = false; }
  if (!sen.feed_drawer_in) trayOpened = true;
  const closed = sen.door_closed && sen.feed_drawer_in;
  const ready = closed && sen.return_drawer_in && !sen.feed_drawer_jammed && !S.station.is_full && !S.maintenance;
  view.innerHTML = `
    <section class="session">
      <div class="greet">
        <h2>Xin chào, ${esc(S.user.name)}</h2>
        <p>STK nhận tiền: <b>${esc(S.user.masked_account)}</b></p>
      </div>
      <ol class="checklist">
        ${check(trayOpened, 'Mở cửa và kéo khay ra')}
        ${check(trayOpened && sen.feed_drawer_in, 'Bỏ <b>chai nhựa / lon nhôm</b> vào khay (không đổ cao quá miệng khay)')}
        ${check(trayOpened && closed, 'Đẩy khay vào và đóng cửa')}
        ${check(false, 'Bấm nút <b>TÍNH TIỀN</b> màu xanh bên dưới màn hình')}
      </ol>
      ${S.pending?.amount > 0 ? `<div class="pending"><span>Đã bỏ qua lỗ: <b>${countText(S.pending)}</b></span><b class="pending-amt">${vnd(S.pending.amount)}</b><small>Bấm TÍNH TIỀN để nhận tiền</small></div>`
        : `<p class="slot-tip">Mẹo: có thể bỏ từng chai/lon qua <b>lỗ tròn phía trên cửa</b> mà không cần mở cửa.</p>`}
      ${sen.feed_drawer_jammed ? '<div class="banner warning">Khay bị kẹt: rác quá nhiều, vui lòng bớt ra</div>' : ''}
      ${!sen.return_drawer_in ? '<div class="banner warning">Ngăn trả rác đang mở – vui lòng đóng lại</div>' : ''}
      ${S.station.is_full ? '<div class="banner error">Trạm đã đầy, không thể nhận thêm rác</div>' : ''}
      ${S.maintenance ? '<div class="banner warning">Trạm đang thu gom / bảo trì, tạm ngưng nhận rác</div>' : ''}
      <div class="session-foot">
        <div class="pill ${ready ? 'ok' : ''}">${ready ? '● Sẵn sàng – bấm TÍNH TIỀN' : '○ Chưa sẵn sàng tính tiền'}</div>
        <button class="btn btn-ghost btn-lg" data-act="logout">Kết thúc</button>
      </div>
    </section>`;
}

const STEPS = [
  ['PROCESSING_TRANSFER', 'Đổ rác xuống mặt phẳng'],
  ['PROCESSING_PRESCAN', 'Quét sơ bộ'],
  ['PROCESSING_VIBRATE', 'Rung dàn đều rác'],
  ['PROCESSING_SCAN', 'Quét nhận diện'],
  ['DECIDE', 'Phân loại & tính tiền'],
];
const SLOT_STEPS = [['PROCESSING_SLOT', 'Quét nhận diện'], ['DECIDE', 'Phân loại']];
function renderProcessing() {
  const slot = S.state === 'PROCESSING_SLOT';
  const steps = slot ? SLOT_STEPS : STEPS;
  const cur = ['ACCEPTING', 'REJECTING'].includes(S.state) ? 'DECIDE' : S.state;
  const idx = steps.findIndex(([k]) => k === cur);
  view.innerHTML = `
    <section class="processing ${lastFrame ? 'with-frame' : ''}">
      <div class="proc-main">
        <div class="spinner"></div>
        <h2>${slot ? 'Đang kiểm tra vật bỏ qua lỗ…' : 'Đang xử lý, vui lòng chờ…'}</h2>
        <p class="muted">${slot ? 'Vui lòng chờ trước khi bỏ vật tiếp theo' : 'Cửa đã khóa trong lúc máy hoạt động'}</p>
        <ol class="progress">
          ${steps.map(([k, t], i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${t}</li>`).join('')}
        </ol>
      </div>
      ${lastFrame ? frameView(lastFrame) : ''}
    </section>`;
}

/** Ảnh camera buồng quét + khung nhận diện (xanh = hợp lệ, đỏ = không hợp lệ, vàng = đè nhau) */
function frameView(f) {
  const fresh = Date.now() - f.at < 600;
  const boxes = f.boxes.map((b) => {
    const [x1, y1, x2, y2] = b.bbox;
    const cls = b.overlapped ? 'warn' : b.valid ? 'ok' : 'bad';
    return `<g class="bx ${cls}"><rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="4"/>
      <text x="${x1 + 6}" y="${Math.max(18, y1 - 6)}">${esc(b.label_vi)}${b.overlapped ? ' · đè nhau' : ''}</text></g>`;
  }).join('');
  return `<figure class="scanview ${fresh ? 'fresh' : ''}">
      <div class="scan-img"><img src="${f.image}" alt="Ảnh camera buồng quét">
        <svg viewBox="0 0 ${f.width} ${f.height}" preserveAspectRatio="none">${boxes}</svg><i class="flash"></i></div>
      <figcaption>Camera buồng quét · ${f.boxes.length ? `nhận diện ${f.boxes.length} vật` : 'không thấy vật nào'}</figcaption>
    </figure>`;
}

const countText = (p) => [p.bottles ? `${p.bottles} chai nhựa` : '', p.cans ? `${p.cans} lon nhôm` : ''].filter(Boolean).join(', ') || '0 vật';

/** Hộp chọn Chuyển khoản / Từ thiện, hoặc kết quả sau khi chọn */
function payoutBox(compact) {
  const p = S.pending, lp = S.last_payout;
  if (p && p.amount > 0) {
    const left = payoutDeadline ? Math.max(0, Math.ceil((payoutDeadline - Date.now()) / 1000)) : null;
    return `
      <div class="payout ${compact ? 'compact' : ''}">
        <div class="po-head"><small>Số tiền bạn nhận được</small><div class="amount">${vnd(p.amount)}</div>
          <div class="counts"><span>${countText(p)}</span></div></div>
        <div class="po-btns">
          <button class="po-btn transfer" data-act="payout" data-m="transfer" ${payoutSending ? 'disabled' : ''}>
            <span class="po-ic">🏦</span><span><b>Chuyển khoản</b><small>vào STK ${esc(S.user.masked_account)}</small></span></button>
          <button class="po-btn charity" data-act="payout" data-m="charity" ${payoutSending ? 'disabled' : ''}>
            <span class="po-ic">❤</span><span><b>Từ thiện</b><small>góp vào quỹ từ thiện của trạm</small></span></button>
        </div>
        ${left != null ? `<p class="po-auto">Tự động chuyển khoản sau <b id="po-left">${left}</b> giây</p>` : ''}
      </div>`;
  }
  if (lp) {
    return lp.method === 'transfer'
      ? `<div class="po-done transfer ${compact ? 'compact' : ''}"><div class="res-icon">✓</div>
          <h2>${lp.auto ? 'Đã tự động chuyển khoản' : 'Chuyển khoản thành công'}</h2>
          <div class="amount">+${vnd(lp.amount)}</div>
          <p>Đã chuyển vào STK <b>${esc(lp.masked_account)}</b></p>
          <p class="muted">Tổng tiền bạn đã nhận: <b>${vnd(lp.total_received)}</b></p></div>`
      : `<div class="po-done charity ${compact ? 'compact' : ''}"><div class="res-icon">❤</div>
          <h2>Cảm ơn tấm lòng của bạn!</h2>
          <div class="amount">${vnd(lp.amount)}</div>
          <p>đã được góp vào <b>quỹ từ thiện</b> của trạm</p>
          <p class="muted">Tổng bạn đã góp: <b>${vnd(lp.total_donated)}</b></p></div>`;
  }
  return '';
}

function renderResult() {
  const r = S.last_result || {};
  const po = payoutBox(['rejected', 'scan_failed', 'error'].includes(r.status));
  let body;
  if (r.status === 'accepted' || (r.status === 'empty' && po)) {
    body = `<div class="res ok">${r.status === 'empty' && S.pending?.amount > 0 ? '<p class="muted">Khay không có rác – tính tiền các vật đã bỏ qua lỗ</p>' : ''}${po}</div>`;
  } else if (r.status === 'rejected') {
    body = `
      <div class="res bad ${po ? 'with-po' : ''}">
        <h2>Phát hiện ${r.rejected.length} vật không hợp lệ</h2>
        <div class="crops">${r.rejected.map((x) => `
          <figure><img src="${esc(x.crop_url)}" alt="${esc(x.label_vi)}"><figcaption>${esc(x.label_vi)}</figcaption></figure>`).join('')}</div>
        <p>Toàn bộ rác trong khay đã được trả về <b>ngăn dưới cùng</b>. Vui lòng lấy rác, loại bỏ vật trên rồi thử lại.</p>
        ${po}
      </div>`;
  } else {
    body = `
      <div class="res ${r.status === 'empty' ? 'info' : 'bad'}">
        <div class="res-icon">${r.status === 'empty' ? 'i' : '!'}</div>
        <h2>${esc(r.message || 'Đã xảy ra lỗi')}</h2>
        ${r.status === 'scan_failed' || r.status === 'error' ? '<p>Rác đã được trả về ngăn dưới cùng.</p>' : ''}
        ${po}
      </div>`;
  }
  const choosing = S.pending?.amount > 0;
  view.innerHTML = `
    <section class="result">${body}
      ${choosing ? '' : `<div class="result-actions">
        <button class="btn btn-primary btn-lg" data-act="continue">Tiếp tục bỏ rác</button>
        <button class="btn btn-ghost btn-lg" data-act="logout">Kết thúc</button>
      </div>`}
    </section>`;
}

// Đếm ngược tự chuyển khoản
setInterval(() => {
  const el = $('#po-left');
  if (el && payoutDeadline) el.textContent = Math.max(0, Math.ceil((payoutDeadline - Date.now()) / 1000));
}, 250);

// ------------------------------------------------------------------ thẻ kết quả lỗ bỏ chai
let slotTimer;
function showSlotCard(r) {
  const el = $('#slotcard');
  const ok = r.status === 'accepted';
  const crop = r.rejected?.[0];
  el.className = `slotcard show ${ok ? 'ok' : 'bad'}`;
  el.innerHTML = `
    ${crop ? `<img src="${esc(crop.crop_url)}" alt="${esc(crop.label_vi)}">` : `<div class="sc-icon">${ok ? '✓' : '!'}</div>`}
    <div class="sc-text">
      <b>${ok ? 'Đã nhận ' + esc(r.label_vi) : esc(r.message)}</b>
      ${ok ? (r.guest ? '<small>Chưa chọn tên nên không tính tiền. Chọn tên trước khi bỏ để nhận tiền.</small>'
        : `<small>+${vnd(r.amount)} · cộng vào lần bấm TÍNH TIỀN</small>`)
        : '<small>Vui lòng lấy lại ở ngăn trả rác phía dưới</small>'}
    </div>`;
  clearTimeout(slotTimer);
  slotTimer = setTimeout(() => { el.className = 'slotcard'; }, ok ? 3500 : 6000);
}

// ------------------------------------------------------------------ sự kiện chạm
view.addEventListener('click', async (e) => {
  const key = e.target.closest('[data-key]');
  if (key) { typeKey(key.dataset.key); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const act = el.dataset.act;
  if (act === 'start' || act === 'users') { search = ''; local.page = 'users'; await loadUsers(); render(); }
  else if (act === 'home') { local.page = 'idle'; render(); }
  else if (act === 'new') { local.page = 'new'; form = { field: 'name', nameRaw: '', account: '', error: '' }; render(); }
  else if (act === 'field') { form.field = el.dataset.f; renderNewUser(); }
  else if (act === 'save') save();
  else if (act === 'pick') { await ui('select_user', { user_id: Number(el.dataset.id) }); }
  else if (act === 'logout') { await ui('logout'); local.page = 'idle'; }
  else if (act === 'continue') { await ui('continue'); }
  else if (act === 'payout') {
    payoutSending = true; render();
    const r = await ui('payout', { method: el.dataset.m });
    if (!r?.ok) { payoutSending = false; render(); }
  }
});
$('#countdown').addEventListener('click', (e) => {
  if (e.target.closest('[data-act="stay"]')) { ui('activity'); hideCountdown(); }
});

render();
