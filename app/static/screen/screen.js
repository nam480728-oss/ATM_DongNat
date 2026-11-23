// Giao diện màn hình cảm ứng của trạm (1280×800).
// Dùng chung cho bản mô phỏng (nhúng vào scene 3D) và máy thật (chạy fullscreen).
// Đăng nhập bằng SỐ ĐIỆN THOẠI (dùng chung mọi trạm của hệ sinh thái), số mới thì đăng ký nhanh bằng họ tên.
// Sau khi tính tiền: 3 nút Từ thiện | Chuyển vào STK (nhập ngân hàng + STK, không lưu) | Lấy voucher QR.
import { telex } from './telex.js';

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const STATION = new URLSearchParams(location.search).get('station') || '1';

const socket = window.io({ transports: ['websocket', 'polling'], query: { station: STATION } });
let S = null;                    // trạng thái server
// trang cục bộ khi IDLE: idle | phone | confirm | register
let local = { page: 'idle' };
let login = { phone: '', name: '', nameRaw: '', error: '', busy: false };
// form chuyển vào STK (không lưu): null | { bank, account, error }
let transfer = null;
let lastFrame = null;            // ảnh camera quét gần nhất (kèm khung nhận diện)
let lastScan = null;             // ảnh nhận diện mẻ gần nhất – dùng cho màn cảnh báo
let payoutDeadline = null;       // thời điểm hết giờ chọn (ms)
let payoutSending = false;

// ------------------------------------------------------------------ socket
socket.on('connect', () => socket.emit('join', { role: 'screen' }, (r) => r?.state && setState(r.state)));
socket.on('state', setState);
socket.on('station:missing', () => { view.innerHTML = `<div class="center muted">Không có trạm số ${esc(STATION)}</div>`; });
socket.on('screen:message', (m) => { if (m.code !== 'slot') notice(m.text, m.level, m.code); });
socket.on('scan:frame', (f) => { lastFrame = { ...f, at: Date.now() }; if (S?.processing) renderProcessing(); });
socket.on('slot:result', showSlotCard);
socket.on('scan:result', (d) => { lastScan = d; if (S?.state === 'ALARM') render(); });
socket.on('session:countdown', ({ seconds }) => showCountdown(seconds));
const ui = (action, extra = {}) => new Promise((res) => socket.emit('ui', { action, ...extra }, res));

function setState(s) {
  const prev = S;
  S = s;
  if (s.countdown == null) hideCountdown();
  if (s.state === 'IDLE' && prev && prev.state !== 'IDLE' && prev.user) { local = { page: 'idle' }; resetLogin(); }
  if (s.user?.id !== prev?.user?.id) transfer = null;
  if (!s.pending?.amount) transfer = null;
  if (s.processing && !prev?.processing) lastFrame = null;
  payoutDeadline = s.payout_in != null ? Date.now() + s.payout_in * 1000 : null;
  payoutSending = false;
  render();
}
function resetLogin() { login = { phone: '', name: '', nameRaw: '', error: '', busy: false }; }

// Mọi chạm lên màn hình = có thao tác (reset đồng hồ tự đăng xuất), giới hạn 1 lần / 3 giây
let lastAct = 0;
document.addEventListener('pointerdown', () => {
  const now = Date.now();
  if (S && ['READY', 'RESULT'].includes(S.state) && now - lastAct > 3000) { lastAct = now; ui('activity'); }
}, true);

// ------------------------------------------------------------------ thông báo, đếm ngược, đồng hồ
let noticeTimer;
function notice(text, level = 'info', code = '') {
  const el = $('#notice');
  const sec = code === 'security';            // cảnh báo camera giám sát: nổi bật + lâu hơn
  el.className = `notice show ${level}${sec ? ' security' : ''}`;
  el.textContent = sec ? `📹 ${text}` : text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { el.className = 'notice'; }, sec ? 9000 : 4500);
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
  $('#bar-station').textContent = `${S.station.code ? S.station.code + ' · ' : ''}${S.station.name}`;
  const rec = $('#bar-rec');
  if (rec) { rec.classList.toggle('blocked', !!S.camera_blocked); rec.title = S.camera_blocked ? 'Camera giám sát đang bị che' : 'Khu vực có camera giám sát'; }
  $('#bar-user').innerHTML = S.user
    ? `<span class="avatar">${esc(S.user.initial)}</span>${esc(S.user.display_name)} · ${esc(S.user.phone)}`
    : '';
  if (S.state === 'IDLE') {
    if (local.page === 'phone') return renderPhone();
    if (local.page === 'confirm') return renderConfirm();
    if (local.page === 'register') return renderRegister();
    return renderIdle();
  }
  if (transfer && S.pending?.amount > 0 && ['READY', 'RESULT', 'ALARM'].includes(S.state)) return renderTransfer();
  if (S.state === 'READY') return renderSession();
  if (S.state === 'ALARM') return renderAlarm();
  if (S.state === 'RESULT') return renderResult();
  return renderProcessing();
}

function renderIdle() {
  const st = S.station;
  const full = st.is_full;
  const openWarn = !S.sensors.door_closed;
  view.innerHTML = `
    <section class="idle">
      <div class="hero">
        <div class="hero-logo">♻</div>
        <h1>Đổi nhựa & kim loại<br>lấy tiền</h1>
        <div class="prices">
          <div class="price"><span class="ico bottle"></span><div><small>Nhựa</small><b>${vnd(S.prices.bottle)}</b></div></div>
          <div class="price"><span class="ico can"></span><div><small>Kim loại</small><b>${vnd(S.prices.can)}</b></div></div>
        </div>
        <p class="eco">Một tài khoản (số điện thoại) dùng được ở <b>mọi trạm</b> · nhận tiền bằng <b>chuyển khoản</b>, <b>voucher</b> hoặc <b>từ thiện</b></p>
      </div>
      <div class="idle-side">
        ${full ? `<div class="banner error"><b>Trạm đã đầy</b><br>Vui lòng quay lại sau. Xin lỗi vì sự bất tiện.</div>` : ''}
        ${S.maintenance ? `<div class="banner warning"><b>Đang thu gom / bảo trì</b><br>Trạm tạm ngưng nhận rác trong ít phút.</div>` : ''}
        ${openWarn ? `<div class="banner warning">Vui lòng đóng cửa khoang nạp</div>` : ''}
        <button class="btn btn-primary btn-xl" data-act="start" ${full || S.maintenance ? 'disabled' : ''}>Bắt đầu</button>
        <ol class="steps-mini">
          <li>Nhập <b>số điện thoại</b> của bạn</li><li>Mở cửa, rút khay, bỏ <b>chai nhựa / lon</b></li><li>Đẩy khay, đóng cửa – máy tự quét và <b>tính tiền ngay</b></li>
        </ol>
        <div class="slot-hint ${S.slot_open ? '' : 'off'}"><span class="slot-dot"></span>
          <span><b>♥ Lỗ từ thiện</b> bên trái cửa: bỏ chai/lon không cần đăng nhập<br><small>Không tính tiền · rác khác bỏ vào 2 thùng rác mini hai bên trạm</small></span></div>
        <div class="storage">Kho chứa: ${st.storage_count}/${st.storage_capacity}
          <div class="meter"><i style="width:${Math.min(100, (st.storage_count / st.storage_capacity) * 100)}%"></i></div></div>
      </div>
    </section>`;
}

// ---- Nhập số điện thoại (bàn phím số)
const phoneText = (p) => (p.length > 7 ? `${p.slice(0, 4)} ${p.slice(4, 7)} ${p.slice(7)}` : p.length > 4 ? `${p.slice(0, 4)} ${p.slice(4)}` : p);
const numPad = (ok, okLabel) => `
  <div class="pad">
    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button class="key" data-key="${n}">${n}</button>`).join('')}
    <button class="key" data-key="clear">Xóa</button><button class="key" data-key="0">0</button><button class="key" data-key="back">⌫</button>
  </div>
  <button class="btn btn-primary btn-lg pad-ok" data-act="${ok}" ${okLabel.disabled ? 'disabled' : ''}>${okLabel.text}</button>`;

function renderPhone() {
  const ok = /^0\d{9}$/.test(login.phone);
  view.innerHTML = `
    <section class="phone">
      <div class="row-head">
        <button class="btn btn-ghost" data-act="home">‹ Quay lại</button>
        <h2>Nhập số điện thoại của bạn</h2><span class="spacer"></span>
      </div>
      <div class="phone-box ${login.error ? 'err' : ''}">${esc(phoneText(login.phone)) || '<i>0__ ___ ____</i>'}</div>
      <p class="phone-note">${login.error ? `<span class="err-text">${esc(login.error)}</span>` : 'Dùng chung cho tất cả trạm PEACE. Chưa có tài khoản? Nhập số mới để đăng ký nhanh.'}</p>
      ${numPad('phone_next', { text: login.busy ? 'Đang kiểm tra…' : 'Tiếp tục ›', disabled: !ok || login.busy })}
    </section>`;
}

function renderConfirm() {
  view.innerHTML = `
    <section class="confirm">
      <div class="avatar big">${esc(login.name[0] || '?')}</div>
      <h2>Xin chào, <span>${esc(login.name)}</span></h2>
      <p class="muted">${esc(phoneText(login.phone))}</p>
      ${login.balance ? `<div class="banner info">Bạn còn <b>${vnd(login.balance)}</b> chưa nhận từ lần trước – chọn cách nhận ngay sau khi vào.</div>` : ''}
      <div class="confirm-btns">
        <button class="btn btn-ghost btn-lg" data-act="phone_again">Không phải tôi</button>
        <button class="btn btn-primary btn-lg" data-act="phone_login" ${login.busy ? 'disabled' : ''}>Đúng, bắt đầu ›</button>
      </div>
    </section>`;
}

// ---- Đăng ký nhanh: họ tên (bàn phím chữ, gõ Telex)
const KEYS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
function renderRegister() {
  const name = telex(login.nameRaw);
  view.innerHTML = `
    <section class="newuser">
      <div class="row-head">
        <button class="btn btn-ghost" data-act="phone_again">‹ Quay lại</button>
        <h2>Đăng ký tài khoản mới</h2>
        <button class="btn btn-primary" data-act="register" ${name.trim() && !login.busy ? '' : 'disabled'}>Đăng ký</button>
      </div>
      <div class="fields">
        <div class="field active"><small>Họ và tên</small><span>${esc(name) || '<i>Nhập họ tên…</i>'}</span></div>
        <div class="field"><small>Số điện thoại</small><span>${esc(phoneText(login.phone))}</span></div>
      </div>
      ${login.error ? `<div class="banner error">${esc(login.error)}</div>` : ''}
      <div class="kb">
        ${KEYS.map((row, i) => `<div class="kb-row">${[...row].map((k) => `<button class="key" data-key="${k}">${k}</button>`).join('')}${i === 2 ? '<button class="key wide" data-key="back">⌫</button>' : ''}</div>`).join('')}
        <div class="kb-row"><button class="key wide" data-key="clear">Xóa</button><button class="key space" data-key=" ">Dấu cách</button></div>
        <p class="kb-hint">Gõ Telex: aa=â, aw=ă, ee=ê, oo=ô, ow=ơ, uw=ư, dd=đ · dấu: s sắc, f huyền, r hỏi, x ngã, j nặng</p>
      </div>
    </section>`;
}

// ---- Chuyển vào STK: chọn ngân hàng + nhập STK (chỉ dùng cho lần này, không lưu)
function renderTransfer() {
  const t = transfer;
  const ok = t.bank && t.account.length >= 6;
  const left = payoutDeadline ? Math.max(0, Math.ceil((payoutDeadline - Date.now()) / 1000)) : null;
  view.innerHTML = `
    <section class="transfer">
      <div class="row-head">
        <button class="btn btn-ghost" data-act="transfer_cancel">‹ Chọn cách khác</button>
        <h2>Chuyển <span class="amt">${vnd(S.pending.amount)}</span> vào tài khoản</h2><span class="spacer"></span>
      </div>
      <div class="tf-grid">
        <div>
          <small class="lbl">1. Chọn ngân hàng / ví</small>
          <div class="banks">${S.banks.map((b) => `<button class="bank ${t.bank === b ? 'on' : ''}" data-act="bank" data-b="${esc(b)}">${esc(b)}</button>`).join('')}</div>
        </div>
        <div>
          <small class="lbl">2. Số tài khoản (6–19 số)</small>
          <div class="phone-box small">${esc(t.account) || '<i>Nhập số tài khoản…</i>'}</div>
          ${t.error ? `<p class="err-text">${esc(t.error)}</p>` : '<p class="tf-note">🔒 Số tài khoản chỉ dùng cho lần chuyển này, trạm không lưu lại.</p>'}
          ${numPad('transfer_send', { text: payoutSending ? 'Đang chuyển…' : 'Xác nhận chuyển ›', disabled: !ok || payoutSending })}
          ${left != null ? `<p class="po-auto">Còn <b id="po-left">${left}</b> giây (hết giờ: tiền được giữ vào số dư)</p>` : ''}
        </div>
      </div>
    </section>`;
}

function typeKey(k) {
  if (S?.state === 'IDLE' && local.page === 'register') {
    login.error = '';
    if (k === 'back') login.nameRaw = login.nameRaw.slice(0, -1);
    else if (k === 'clear') login.nameRaw = '';
    else if (k === ' ') { if (login.nameRaw && !login.nameRaw.endsWith(' ')) login.nameRaw += ' '; }
    else if (/^[a-z]$/.test(k) && login.nameRaw.length < 120) login.nameRaw += k;
    return renderRegister();
  }
  const target = transfer && S?.state !== 'IDLE' ? transfer : (S?.state === 'IDLE' && local.page === 'phone' ? login : null);
  if (!target) return;
  const field = target === transfer ? 'account' : 'phone';
  const max = field === 'account' ? 19 : 10;
  target.error = '';
  if (k === 'back') target[field] = target[field].slice(0, -1);
  else if (k === 'clear') target[field] = '';
  else if (/^\d$/.test(k) && target[field].length < max) target[field] += k;
  render();
}

// Bàn phím thật (bản mô phỏng / máy có bàn phím)
document.addEventListener('keydown', (e) => {
  if (!S || e.ctrlKey || e.metaKey || e.altKey) return;
  const typing = (S.state === 'IDLE' && ['phone', 'register'].includes(local.page)) || (transfer && S.state !== 'IDLE');
  if (!typing) return;
  let k = null;
  if (e.key === 'Backspace') k = 'back';
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (local.page === 'phone' && S.state === 'IDLE') phoneNext();
    else if (local.page === 'register' && S.state === 'IDLE') register();
    else if (transfer) sendTransfer();
    return;
  } else if (e.key.length === 1) k = e.key === ' ' ? ' ' : e.key.toLowerCase();
  if (k) { e.preventDefault(); typeKey(k); }
});

async function phoneNext() {
  if (!/^0\d{9}$/.test(login.phone) || login.busy) return;
  login.busy = true; renderPhone();
  const r = await ui('phone_lookup', { phone: login.phone });
  login.busy = false;
  if (!r?.ok) { login.error = r?.error || 'Không kiểm tra được số điện thoại'; return renderPhone(); }
  if (r.found) { login.name = r.name; login.balance = r.balance; local.page = 'confirm'; }
  else { login.nameRaw = ''; local.page = 'register'; }
  render();
}
async function phoneLogin() {
  login.busy = true; renderConfirm();
  const r = await ui('phone_login', { phone: login.phone });
  login.busy = false;
  if (!r?.ok) { if (r?.error) notice(r.error, 'error'); local.page = 'phone'; render(); }
}
async function register() {
  const name = telex(login.nameRaw).trim();
  if (!name || login.busy) return;
  login.busy = true; renderRegister();
  const r = await ui('register', { phone: login.phone, name });
  login.busy = false;
  if (!r?.ok) { login.error = r?.error || 'Không đăng ký được'; renderRegister(); }
}
async function sendTransfer() {
  if (!transfer?.bank || transfer.account.length < 6 || payoutSending) return;
  payoutSending = true; render();
  const r = await ui('payout', { method: 'transfer', bank: transfer.bank, account: transfer.account });
  if (!r?.ok) { payoutSending = false; transfer.error = r?.error || 'Không chuyển được'; render(); return; }
  transfer = null;
}

// ---- Phiên làm việc
function check(ok, text) { return `<li class="${ok ? 'ok' : ''}"><span class="tick">${ok ? '✓' : ''}</span><span>${text}</span></li>`; }
let sessionUserId = null;
let doorOpened = false; // trong phiên này người dùng đã mở cửa chưa
function renderSession() {
  const sen = S.sensors;
  if (sessionUserId !== S.user.id) { sessionUserId = S.user.id; doorOpened = false; }
  if (!sen.door_closed) doorOpened = true;
  const lp = S.last_payout;
  const bal = S.pending?.amount > 0 ? payoutBox(true, 'Số dư tài khoản (tích lũy) – rút khi cần') : (lp?.method === 'voucher' ? voucherCard(lp, true) : '');
  view.innerHTML = `
    <section class="session ${bal ? 'with-balance' : ''}">
      <div class="greet">
        <h2>Xin chào, ${esc(S.user.display_name)}</h2>
        <p>Đã nhận: <b>${vnd(S.user.total_received)}</b> · Voucher: <b>${vnd(S.user.total_voucher)}</b> · Từ thiện: <b>${vnd(S.user.total_donated)}</b></p>
      </div>
      <div class="session-body">
        <ol class="checklist">
          ${check(doorOpened, 'Mở cửa, rút khay ra')}
          ${check(doorOpened, 'Bỏ <b>chai nhựa / lon</b> lên khay (rác khác bỏ vào thùng rác mini 2 bên trạm)')}
          ${check(false, 'Đẩy khay vào, đóng cửa – máy tự quét và <b>tính tiền ngay</b>')}
        </ol>
        ${bal}
      </div>
      ${S.intake_busy ? '<div class="banner info">Máy đang phân loại rác trên khay – cửa sẽ mở khóa khi khay trống</div>' : ''}
      ${S.station.is_full ? '<div class="banner error">Trạm đã đầy, không thể nhận thêm rác</div>' : ''}
      ${S.maintenance ? '<div class="banner warning">Trạm đang thu gom / bảo trì, tạm ngưng nhận rác</div>' : ''}
      <div class="session-foot">
        <div class="pill ${S.door_locked ? '' : 'ok'}">${S.door_locked ? '○ Cửa đang khóa' : '● Cửa đã mở khóa – mời bỏ rác'}</div>
        <button class="btn btn-ghost btn-lg" data-act="logout">Kết thúc</button>
      </div>
    </section>`;
}

/** Có rác không phải chai/lon: cửa đã bung hé, chờ người dùng lấy ra rồi đóng cửa */
function renderAlarm() {
  const r = S.last_result || {};
  const failed = r.status === 'scan_failed';
  view.innerHTML = `
    <section class="alarm">
      <div class="alarm-head"><span class="alarm-ic">⚠</span>
        <div><h2>${failed ? 'Rác chồng lên nhau' : 'Có rác không phải chai / lon!'}</h2>
        <p>${failed ? 'Camera không nhìn rõ. Rút khay, dàn rác ra rồi đẩy khay vào, đóng cửa.' : 'Cửa đã bung hé. Rút khay, lấy <b>vật khoanh đỏ</b> ra (bỏ vào thùng rác mini 2 bên trạm), đẩy khay vào rồi <b>đóng cửa</b> để quét lại.'}</p></div>
      </div>
      <div class="alarm-body">
        ${lastScan ? scanFigure(lastScan) : ''}
        ${r.rejected?.length ? `<div class="crops">${r.rejected.map((x) => `
          <figure><img src="${esc(x.crop_url)}" alt="${esc(x.label_vi)}"><figcaption>${esc(x.label_vi)}</figcaption></figure>`).join('')}</div>` : ''}
      </div>
      <div class="result-actions"><button class="btn btn-ghost btn-lg" data-act="logout">Kết thúc</button></div>
    </section>`;
}

/** Ảnh nhận diện đầy đủ (khung đỏ = vật lạ) */
function scanFigure(d) {
  const boxes = d.boxes.map((b) => {
    const [x1, y1, x2, y2] = b.bbox;
    const cls = b.valid ? 'ok' : 'bad';
    return `<g class="bx ${cls}"><rect x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" rx="6"/>
      <text x="${x1 + 8}" y="${Math.max(30, y1 - 10)}">${esc(b.label_vi)}</text></g>`;
  }).join('');
  return `<figure class="scanview big"><div class="scan-img"><img src="${d.image}" alt="Ảnh camera khay">
      <svg viewBox="0 0 ${d.width} ${d.height}" preserveAspectRatio="none">${boxes}</svg></div></figure>`;
}

const STEPS = [
  ['PROCESSING_SCAN', 'Camera khay quét'],
  ['PROCESSING_SETTLE', 'Nhiều vật: rung khay tản ra'],
  ['DECIDE', 'Tính tiền'],
];
function renderProcessing() {
  const idx = STEPS.findIndex(([k]) => k === S.state);
  view.innerHTML = `
    <section class="processing ${lastFrame ? 'with-frame' : ''}">
      <div class="proc-main">
        <div class="spinner"></div>
        <h2>Đang quét rác, vui lòng chờ…</h2>
        <p class="muted">Cửa đã khóa trong lúc máy quét</p>
        <ol class="progress">
          ${STEPS.map(([, t], i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}">${t}</li>`).join('')}
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
      <figcaption>Camera khay · ${f.boxes.length ? `nhận diện ${f.boxes.length} vật` : 'không thấy vật nào'}</figcaption>
    </figure>`;
}

const countText = (p) => [p.bottles ? `${p.bottles} nhựa` : '', p.cans ? `${p.cans} kim loại` : ''].filter(Boolean).join(', ') || '';

/** Nút nhận tiền: Từ thiện | Chuyển vào STK | Lấy voucher | Lưu vào tài khoản (chỉ khi có tiền mẻ mới) */
function payoutBox(compact, title = 'Số tiền bạn nhận được') {
  const p = S.pending;
  if (!p || p.amount <= 0) return '';
  const left = payoutDeadline ? Math.max(0, Math.ceil((payoutDeadline - Date.now()) / 1000)) : null;
  const extra = [countText(p), p.balance && p.new_amount ? `gồm ${vnd(p.balance)} số dư lần trước` : ''].filter(Boolean);
  return `
    <div class="payout ${compact ? 'compact' : ''}">
      <div class="po-head"><small>${title}</small><div class="amount">${vnd(p.amount)}</div>
        ${extra.length ? `<div class="counts">${extra.map((x) => `<span>${esc(x)}</span>`).join('')}</div>` : ''}</div>
      <div class="po-btns ${p.new_amount > 0 ? 'four' : 'three'}">
        <button class="po-btn charity" data-act="payout" data-m="charity" ${payoutSending ? 'disabled' : ''}>
          <span class="po-ic">❤</span><span><b>Từ thiện</b><small>góp vào quỹ từ thiện</small></span></button>
        <button class="po-btn transfer" data-act="transfer_open" ${payoutSending ? 'disabled' : ''}>
          <span class="po-ic">🏦</span><span><b>Chuyển vào STK</b><small>nhập ngân hàng + số TK</small></span></button>
        <button class="po-btn voucher" data-act="payout" data-m="voucher" ${payoutSending ? 'disabled' : ''}>
          <span class="po-ic">🎟</span><span><b>Lấy voucher</b><small>mã QR: vé xe, mua hàng quanh đây</small></span></button>
        ${p.new_amount > 0 ? `<button class="po-btn save" data-act="payout" data-m="save" ${payoutSending ? 'disabled' : ''}>
          <span class="po-ic">💰</span><span><b>Lưu vào tài khoản</b><small>tích lũy theo SĐT, rút lần sau</small></span></button>` : ''}
      </div>
      ${left != null ? `<p class="po-auto">Không chọn sau <b id="po-left">${left}</b> giây: tiền được giữ vào số dư, nhận lại ở bất kỳ trạm nào</p>` : ''}
    </div>`;
}

/** Voucher QR vừa tạo */
function voucherCard(lp, compact) {
  const v = lp.voucher;
  if (!v) return '';
  return `
    <div class="voucher ${compact ? 'compact' : ''}">
      <div class="qr">${v.qr_svg}</div>
      <div class="v-info">
        <small>Voucher PEACE</small>
        <div class="amount">${vnd(v.amount)}</div>
        <div class="v-code">${esc(v.code)}</div>
        <p>Dùng 1 lần để trả <b>vé xe</b> hoặc <b>mua hàng</b> ở cửa hàng liên kết quanh trạm.<br>
          Hạn dùng tới <b>${esc(new Date(v.expires_at.replace(' ', 'T')).toLocaleDateString('vi-VN'))}</b></p>
        <p class="muted">📷 Chụp lại mã QR bằng điện thoại, hoặc in phiếu ra để đưa người bán quét khi thanh toán.</p>
        <button class="btn btn-primary btn-print" data-act="print_voucher" ${(lp.printed || 0) >= 3 ? 'disabled' : ''}>🖨 ${lp.printed ? `In lại (${lp.printed}/3)` : 'In voucher'}</button>
        ${lp.printed ? '<p class="print-note">⬇ Mời lấy phiếu ở khe in ngay dưới màn hình</p>' : ''}
      </div>
    </div>`;
}

function payoutDone(compact) {
  const lp = S.last_payout;
  if (!lp) return '';
  if (lp.method === 'voucher') return voucherCard(lp, compact);
  if (lp.method === 'save') {
    return `<div class="po-done save ${compact ? 'compact' : ''}"><div class="res-icon">💰</div>
      <h2>Đã lưu vào tài khoản</h2>
      <div class="amount">+${vnd(lp.amount)}</div>
      <p>Số dư tài khoản <b>${esc(S.user?.phone || '')}</b>: <b>${vnd(lp.balance)}</b></p>
      <p class="muted">Bỏ thêm rác để tích lũy tiếp. Muốn rút: lần sau nhập số điện thoại ở bất kỳ trạm nào rồi chọn chuyển khoản, voucher hoặc từ thiện.</p></div>`;
  }
  if (lp.method === 'transfer') {
    return `<div class="po-done transfer ${compact ? 'compact' : ''}"><div class="res-icon">✓</div>
      <h2>Chuyển khoản thành công</h2>
      <div class="amount">+${vnd(lp.amount)}</div>
      <p>Đã chuyển vào <b>${esc(lp.bank)} ${esc(lp.account)}</b></p>
      <p class="muted">Tổng tiền bạn đã nhận: <b>${vnd(lp.total_received)}</b></p></div>`;
  }
  return `<div class="po-done charity ${compact ? 'compact' : ''}"><div class="res-icon">❤</div>
    <h2>Cảm ơn tấm lòng của bạn!</h2>
    <div class="amount">${vnd(lp.amount)}</div>
    <p>đã được góp vào <b>quỹ từ thiện</b></p>
    <p class="muted">Tổng bạn đã góp: <b>${vnd(lp.total_donated)}</b></p></div>`;
}

function renderResult() {
  const r = S.last_result || {};
  // vừa lưu vào tài khoản: chỉ còn số dư cũ -> không hỏi lại, hiện thẻ "đã lưu"
  const choosing = S.pending?.amount > 0 && !(S.last_payout?.method === 'save' && !S.pending.new_amount);
  const compact = ['rejected', 'scan_failed', 'error'].includes(r.status);
  const po = choosing ? payoutBox(compact) : payoutDone(compact);
  let body;
  if (r.status === 'accepted' || (r.status === 'empty' && po)) {
    const sorting = S.sorter?.running ? '<p class="sorting-note">♻ Rác của bạn đang được phân loại ngay trên khay (chai → thùng chai, lon → thùng lon)</p>' : '';
    body = `<div class="res ok">${po}${sorting}</div>`;
  } else if (r.status === 'rejected') {
    body = `
      <div class="res bad ${po ? 'with-po' : ''}">
        <h2>Phát hiện ${r.rejected.length} vật không hợp lệ</h2>
        <div class="crops">${r.rejected.map((x) => `
          <figure><img src="${esc(x.crop_url)}" alt="${esc(x.label_vi)}"><figcaption>${esc(x.label_vi)}</figcaption></figure>`).join('')}</div>
        <p>Vui lòng mở cửa, rút khay lấy vật trên ra rồi đẩy khay vào, đóng cửa để quét lại.</p>
        ${po}
      </div>`;
  } else {
    body = `
      <div class="res ${r.status === 'empty' ? 'info' : 'bad'}">
        <div class="res-icon">${r.status === 'empty' ? 'i' : '!'}</div>
        <h2>${esc(r.message || 'Đã xảy ra lỗi')}</h2>
        ${r.status === 'error' ? '<p>Vui lòng mở cửa lấy rác ra và thử lại.</p>' : ''}
        ${po}
      </div>`;
  }
  view.innerHTML = `
    <section class="result">${body}
      ${choosing ? '' : `<div class="result-actions">
        <button class="btn btn-primary btn-lg" data-act="continue">Bỏ tiếp</button>
        <button class="btn btn-ghost btn-lg" data-act="logout">Kết thúc</button>
      </div>`}
    </section>`;
}

// Đếm ngược hết giờ chọn
setInterval(() => {
  const el = $('#po-left');
  if (el && payoutDeadline) el.textContent = Math.max(0, Math.ceil((payoutDeadline - Date.now()) / 1000));
}, 250);

// ------------------------------------------------------------------ thẻ kết quả lỗ từ thiện
let slotTimer;
function showSlotCard(r) {
  const el = $('#slotcard');
  const ok = r.status === 'accepted';
  const crop = r.rejected?.[0];
  el.className = `slotcard show ${ok ? 'ok' : 'bad'}`;
  el.innerHTML = `
    ${crop ? `<img src="${esc(crop.crop_url)}" alt="${esc(crop.label_vi)}">` : `<div class="sc-icon">${ok ? '♥' : '!'}</div>`}
    <div class="sc-text">
      <b>${ok ? 'Cảm ơn bạn đã ủng hộ!' : esc(r.label_vi || 'Vật không rõ')}</b>
      <small>${esc(r.message)}</small>
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
  if (act === 'start' || act === 'phone_again') { resetLogin(); local.page = 'phone'; render(); }
  else if (act === 'home') { local.page = 'idle'; resetLogin(); render(); }
  else if (act === 'phone_next') phoneNext();
  else if (act === 'phone_login') phoneLogin();
  else if (act === 'register') register();
  else if (act === 'logout') { transfer = null; await ui('logout'); local.page = 'idle'; }
  else if (act === 'continue') { await ui('continue'); }
  else if (act === 'transfer_open') { transfer = { bank: '', account: '', error: '' }; ui('payout_form'); render(); }
  else if (act === 'transfer_cancel') { transfer = null; render(); }
  else if (act === 'bank') { transfer.bank = el.dataset.b; transfer.error = ''; render(); }
  else if (act === 'transfer_send') sendTransfer();
  else if (act === 'print_voucher') { const r = await ui('print_voucher'); if (!r?.ok && r?.error) notice(r.error, 'error'); }
  else if (act === 'payout') {
    payoutSending = true; render();
    const r = await ui('payout', { method: el.dataset.m });
    if (!r?.ok) { payoutSending = false; if (r?.error) notice(r.error, 'error'); render(); }
  }
});
$('#countdown').addEventListener('click', (e) => {
  if (e.target.closest('[data-act="stay"]')) { ui('activity'); hideCountdown(); }
});

render();
