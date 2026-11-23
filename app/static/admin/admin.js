// Trang quản trị hệ thống: nhiều trạm (mã trạm, địa chỉ, bản đồ), sự cố an ninh (camera giám sát), người dùng (SĐT)
// dùng chung, voucher, cửa hàng, giao dịch, cấu hình.
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const num = (n) => Number(n || 0).toLocaleString('vi-VN');
const STATUS = { accepted: ['Đã nhận', 'ok'], rejected: ['Trả rác', 'bad'], scan_failed: ['Quét lỗi', 'warn'], empty: ['Khay trống', ''] };
const METHOD = { transfer: ['Chuyển vào STK', 'info'], charity: ['Từ thiện', 'pink'], voucher: ['Voucher', 'warn'], held: ['Lưu vào tài khoản', ''] };
const VSTATUS = { active: ['Còn hiệu lực', 'ok'], used: ['Đã dùng', ''], expired: ['Hết hạn', 'warn'], void: ['Đã hủy', 'bad'] };
const SKIND = { reject_repeat: 'Bỏ rác lạ nhiều lần', impact: 'Va đập / đá máy', tamper: 'Cạy khay / cửa', camera_blocked: 'Che camera' };
const SSTATUS = { new: ['Mới', 'bad'], seen: ['Đã xem', 'warn'], resolved: ['Đã xử lý', 'ok'] };
const pill = ([t, c] = ['—', '']) => `<span class="pill ${c}">${esc(t)}</span>`;

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 401) { location.href = '/admin/login'; throw new Error('401'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}
const post = (p, body, method = 'POST') => api(p, { method, body: JSON.stringify(body || {}) });
let stations = [];
const stName = (id) => { const s = stations.find((x) => x.id === id); return s ? `${s.code || s.id} · ${s.name}` : (id ? `Trạm ${id}` : '—'); };
let provinces = [];
const scope = () => $('#scope').value;

// ------------------------------------------------------------------ tab
let tab = 'overview';
try { tab = localStorage.getItem('admin-tab') || 'overview'; } catch { /* bỏ qua */ }
function showTab(t) {
  tab = t;
  try { localStorage.setItem('admin-tab', t); } catch { /* bỏ qua */ }
  document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== t; });
  load();
}
document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
$('#scope').addEventListener('change', () => load());

const loaders = {
  overview: () => Promise.all([loadOverview(), loadPayouts(), loadCharity()]),
  stations: loadStations, security: loadSecurity, users: loadUsers, vouchers: loadVouchers, merchants: loadMerchants, txs: loadTxs,
  settings: loadSettings,
};
function load() { return loaders[tab]?.().catch((e) => console.warn(e)); }

// ------------------------------------------------------------------ tổng quan
async function loadOverview() {
  const s = await api(`/api/admin/overview?station=${scope()}`);
  $('#cards').innerHTML = [
    ['Nhựa đã thu', num(s.bottles)], ['Kim loại đã thu', num(s.cans)],
    ['Đã chuyển vào STK', vnd(s.transfer)], ['Voucher đã phát', vnd(s.voucher)],
    ['Voucher đã dùng', vnd(s.voucher_used)], ['Quỹ từ thiện', vnd(s.charity)],
    ['Tiền người dùng đang tích lũy', vnd(s.held)], ['Vật qua lỗ từ thiện', num(s.guest_items)],
    ['Lượt báo rác lạ', num(s.rejected_count)], ['Sự cố an ninh mới', num(s.security_new)],
    [scope() === 'all' ? 'Người dùng' : 'Người dùng đăng ký tại trạm', num(scope() === 'all' ? s.users : s.new_users)],
  ].map(([k, v]) => `<div class="card"><small>${k}</small><b>${v}</b></div>`).join('');
}
async function loadPayouts() {
  const rows = await api(`/api/admin/payouts?station=${scope()}&method=${$('#po-method').value}&limit=40`);
  $('#payouts').innerHTML = rows.length ? rows.map((p) => `<tr><td class="mono small">${esc(p.created_at)}</td><td>${esc(stName(p.station_id))}</td>
    <td>${esc(p.user)}<br><small class="muted">${esc(p.phone)}</small></td>
    <td>${pill(METHOD[p.method])} <small class="muted">${esc(p.bank ? `${p.bank} ${p.account}` : p.voucher || '')}</small></td>
    <td class="num"><b>${vnd(p.amount)}</b></td></tr>`).join('') : '<tr><td colspan="5" class="empty">Chưa có lượt nhận tiền</td></tr>';
}
$('#po-method').addEventListener('change', loadPayouts);
async function loadCharity() {
  const c = await api(`/api/admin/charity?station=${scope()}`);
  $('#charity-total').innerHTML = `<b>${vnd(c.total)}</b> <span class="muted small">· ${num(c.donors)} người góp · ${num(c.slot_items)} vật qua lỗ từ thiện</span>`;
  $('#charity').innerHTML = c.items.length ? c.items.map((x) => `<tr><td class="mono small">${esc(x.created_at)}</td><td>${esc(stName(x.station_id))}</td>
    <td>${esc(x.user)}</td><td class="num"><b>${vnd(x.amount)}</b></td></tr>`).join('') : '<tr><td colspan="4" class="empty">Chưa có lượt góp</td></tr>';
}

// ------------------------------------------------------------------ trạm
const meter = (n, cap) => {
  const p = Math.min(100, Math.round((n / Math.max(1, cap)) * 100));
  return `<div class="meter ${p >= 100 ? 'full' : p > 80 ? 'high' : ''}"><i style="width:${p}%"></i></div>`;
};
async function loadStationList() {
  stations = await api('/api/admin/stations');
  const sel = $('#scope'), cur = sel.value;
  sel.innerHTML = '<option value="all">Toàn hệ thống</option>' + stations.map((s) => `<option value="${s.id}">${esc(s.code || s.id)} · ${esc(s.name)}</option>`).join('');
  const newSec = stations.reduce((n, s) => n + (s.security_new || 0), 0);
  setBadge(newSec);
  sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'all';
}
async function loadStations() {
  await loadStationList();
  if (!provinces.length) {
    provinces = await api('/api/admin/provinces');
    $('#new-station').province.insertAdjacentHTML('beforeend', provinces.map((p) => `<option value="${p.code}">${esc(p.name)} (${p.code})</option>`).join(''));
  }
  drawMap();
  $('#stations').innerHTML = stations.map((s) => {
    const st = !s.is_active ? pill(['Đã tắt', 'bad']) : !s.online ? pill(['Chưa mở', '']) : s.funnel_jam ? pill(['KẸT PHỄU', 'bad'])
      : s.maintenance ? pill(['Bảo trì', 'warn']) : s.user ? pill(['Đang có người dùng', 'info']) : s.sorting ? pill(['Đang phân loại', 'info']) : pill(['Sẵn sàng', 'ok']);
    const pct = Math.round((s.storage_count / Math.max(1, s.storage_capacity)) * 100);
    return `<article class="st-card">
      <header><b><span class="code">${esc(s.code || '—')}</span> ${esc(s.name)}</b>${st}</header>
      <p class="muted small">📍 ${esc(s.full_address || 'Chưa có địa chỉ')}${s.lat != null ? ` · <a href="https://www.openstreetmap.org/?mlat=${s.lat}&mlon=${s.lng}#map=18/${s.lat}/${s.lng}" target="_blank" rel="noopener">bản đồ ↗</a>` : ''}${s.user ? ` · đang dùng: <b>${esc(s.user)}</b>` : ''}</p>
      ${s.security_new ? `<p class="alert">${s.security_new} sự cố an ninh mới <button class="btn sm danger" data-sec="${s.id}">Xem</button></p>` : ''}
      ${s.camera_blocked ? '<p class="alert">Camera giám sát đang bị che</p>' : ''}
      ${s.funnel_jam ? `<p class="alert">Phễu bị kẹt – máy đã mở dần + rung nhưng vật chưa rơi. Gỡ vật kẹt rồi bấm <button class="btn sm primary" data-jam="${s.id}">Đã gỡ kẹt</button></p>` : ''}
      <div class="st-row"><span>Kho chứa ${num(s.storage_count)}/${num(s.storage_capacity)} (${pct}%) ${s.is_full ? pill(['ĐẦY', 'bad']) : ''}</span>
        <button class="btn ghost sm" data-empty="${s.id}">Đã đổ xe thùng</button></div>
      ${meter(s.storage_count, s.storage_capacity)}
      <div class="bins"><span>Chai <b>${num(s.bins.bottle)}</b></span><span>Lon <b>${num(s.bins.can)}</b></span><span>Khác <b>${num(s.bins.other)}</b></span><span>Hôm nay <b>${num(s.today_items)}</b> vật</span></div>
      <div class="pub">${['left', 'right'].map((side) => `<div><small>Thùng mini ${side === 'left' ? 'trái' : 'phải'} · ${num(s.public[side])}/${num(s.public.capacity)}</small>${meter(s.public[side], s.public.capacity)}
        <button class="btn ghost sm" data-pub="${s.id}" data-side="${side}">Đã đổ</button></div>`).join('')}</div>
      <details><summary>Sửa thông tin trạm</summary>
        <form class="st-edit" data-id="${s.id}">
          <label>Mã trạm<input value="${esc(s.code || '')}" disabled title="Mã trạm cấp theo tỉnh, không đổi"></label>
          <label>Tên<input name="name" value="${esc(s.name)}" required></label>
          <label>Số nhà, đường<input name="address" value="${esc(s.address || '')}"></label>
          <label>Phường / xã<input name="ward" value="${esc(s.ward || '')}"></label>
          <label>Tỉnh / thành<select name="province">${provinces.map((p) => `<option value="${p.code}" ${p.code === s.province ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
          <label>Vĩ độ<input name="lat" inputmode="decimal" value="${s.lat ?? ''}"></label>
          <label>Kinh độ<input name="lng" inputmode="decimal" value="${s.lng ?? ''}"></label>
          <label>Sức chứa xe thùng<input name="storage_capacity" type="number" min="10" max="100000" value="${s.storage_capacity}"></label>
          <label class="chk"><input name="is_active" type="checkbox" ${s.is_active ? 'checked' : ''}> Đang hoạt động</label>
          <div><button class="btn primary sm">Lưu</button> <a href="/?station=${s.id}" target="_blank" rel="noopener">Mở mô phỏng trạm ↗</a></div>
        </form></details>
    </article>`;
  }).join('');
}
$('#stations').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.sec) { $('#scope').value = b.dataset.sec; $('#sec-filter').status.value = 'new'; showTab('security'); return; }
    if (b.dataset.jam) await post(`/api/admin/stations/${b.dataset.jam}/clear-jam`);
    else if (b.dataset.empty) {
      if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Bấm lần nữa để xác nhận'; setTimeout(() => { delete b.dataset.confirm; b.textContent = 'Đã đổ xe thùng'; }, 3000); return; }
      await post(`/api/admin/stations/${b.dataset.empty}/empty-storage`);
    } else if (b.dataset.pub) await post(`/api/admin/stations/${b.dataset.pub}/empty-public`, { side: b.dataset.side });
    else return;
    loadStations();
  } catch (err) { alertMsg(err.message); }
});
$('#stations').addEventListener('submit', async (e) => {
  const f = e.target.closest('.st-edit');
  if (!f) return;
  e.preventDefault();
  try {
    await post(`/api/admin/stations/${f.dataset.id}`, {
      name: f.name.value, address: f.address.value, ward: f.ward.value, province: f.province.value,
      lat: f.lat.value.trim() || null, lng: f.lng.value.trim() || null,
      storage_capacity: Number(f.storage_capacity.value), is_active: f.is_active.checked,
    }, 'PATCH');
    loadStations();
  } catch (err) { alertMsg(err.message); }
});
$('#new-station').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    const st = await post('/api/admin/stations', {
      name: f.name.value, address: f.address.value, ward: f.ward.value, province: f.province.value,
      lat: f.lat.value.trim() || null, lng: f.lng.value.trim() || null,
    });
    f.reset(); newPin?.remove(); newPin = null; loadStations(); alertMsg(`Đã thêm trạm ${st.code}`, 'ok');
  } catch (err) { alertMsg(err.message); }
});

// ---- bản đồ (Leaflet + OpenStreetMap)
let map = null, layer = null, newPin = null;
function drawMap() {
  const L = window.L;
  if (!L) { $('#map').hidden = true; $('#map-note').textContent = 'Không tải được bản đồ (cần Internet) – vẫn nhập tọa độ bằng tay được.'; return; }
  if (!map) {
    map = L.map('map', { scrollWheelZoom: false }).setView([16.06, 108.247], 15);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.on('click', (e) => {
      const f = $('#new-station');
      f.lat.value = e.latlng.lat.toFixed(6); f.lng.value = e.latlng.lng.toFixed(6);
      if (newPin) newPin.setLatLng(e.latlng); else newPin = L.marker(e.latlng, { opacity: 0.7 }).addTo(map).bindTooltip('Trạm mới');
    });
  }
  layer.clearLayers();
  const pts = [];
  for (const s of stations) {
    if (s.lat == null) continue;
    const color = !s.is_active ? '#94a3b8' : s.security_new || s.funnel_jam || s.is_full ? '#dc2626' : '#16a34a';
    const m = L.marker([s.lat, s.lng], { draggable: true, icon: L.divIcon({ className: 'st-pin', html: `<span style="background:${color}">${esc(s.code || s.id)}</span>`, iconSize: [70, 24], iconAnchor: [35, 24] }) });
    m.bindPopup(`<b>${esc(s.code)} · ${esc(s.name)}</b><br>${esc(s.full_address)}<br>Kho ${num(s.storage_count)}/${num(s.storage_capacity)}${s.security_new ? `<br><b style="color:#dc2626">${s.security_new} sự cố an ninh mới</b>` : ''}`);
    m.on('dragend', () => {
      const f = $(`.st-edit[data-id="${s.id}"]`);
      if (!f) return;
      const p = m.getLatLng();
      f.lat.value = p.lat.toFixed(6); f.lng.value = p.lng.toFixed(6);
      f.closest('details').open = true;
      alertMsg(`Đã dời ghim ${s.code} – bấm Lưu ở thẻ trạm để ghi tọa độ`, 'ok');
    });
    layer.addLayer(m);
    pts.push([s.lat, s.lng]);
  }
  if (pts.length && !map._fitted) { map.fitBounds(pts, { padding: [40, 40], maxZoom: 17 }); map._fitted = true; }
  setTimeout(() => map.invalidateSize(), 50);
}

// ------------------------------------------------------------------ an ninh (camera giám sát)
function setBadge(n) {
  const b = $('#sec-badge');
  b.hidden = !n; b.textContent = n;
}
async function loadSecurity() {
  const f = $('#sec-filter');
  const d = await api(`/api/admin/security?station=${scope()}&kind=${f.kind.value}&status=${f.status.value}`);
  setBadge(d.new);
  $('#security').innerHTML = d.items.length ? d.items.map((e) => `<article class="sec-card ${e.status}">
      ${e.image_url ? `<button class="thumb big" data-img="${esc(e.image_url)}"><img src="${esc(e.image_url)}" alt="Ảnh camera giám sát" loading="lazy"></button>` : '<div class="noimg">Không có ảnh</div>'}
      <div class="sec-body">
        <header><b>${esc(SKIND[e.kind] || e.kind)}</b>${pill(SSTATUS[e.status])}</header>
        <p class="small">${esc(e.detail || '')}</p>
        <p class="muted small mono">${esc(e.created_at)} · ${esc(stName(e.station_id))}</p>
        <p class="small">${e.user ? `Người đang đăng nhập: <b>${esc(e.user.name)}</b> <span class="mono">${esc(e.user.phone)}</span>
          <button class="btn ghost sm" data-user="${e.user.id}">Hồ sơ</button>` : '<span class="muted">Không có ai đăng nhập</span>'}</p>
        ${e.before_url ? `<p class="small">Ảnh trước khi bị che: <button class="thumb" data-img="${esc(e.before_url)}"><img src="${esc(e.before_url)}" alt="Ảnh trước khi bị che" loading="lazy"></button></p>` : ''}
        <form class="sec-act inline-form" data-id="${e.id}">
          <input name="note" value="${esc(e.note || '')}" placeholder="Ghi chú xử lý" aria-label="Ghi chú xử lý">
          ${e.status === 'new' ? '<button class="btn ghost sm" data-st="seen">Đã xem</button>' : ''}
          ${e.status !== 'resolved' ? '<button class="btn primary sm" data-st="resolved">Đã xử lý</button>' : '<button class="btn ghost sm" data-st="seen">Mở lại</button>'}
        </form>
      </div></article>`).join('') : '<p class="empty">Không có sự cố</p>';
}
$('#sec-filter').addEventListener('change', loadSecurity);
$('#security').addEventListener('click', async (e) => {
  const img = e.target.closest('[data-img]');
  if (img) { $('#viewer img').src = img.dataset.img; $('#viewer').showModal(); return; }
  const u = e.target.closest('[data-user]');
  if (u) { openUser(Number(u.dataset.user)); return; }
  const b = e.target.closest('[data-st]');
  if (!b) return;
  e.preventDefault();
  const f = b.closest('form');
  try { await post(`/api/admin/security/${f.dataset.id}`, { status: b.dataset.st, note: f.note.value }, 'PATCH'); loadSecurity(); } catch (err) { alertMsg(err.message); }
});
$('#security').addEventListener('submit', (e) => e.preventDefault());

// ------------------------------------------------------------------ người dùng
async function loadUsers() {
  const rows = await api('/api/admin/users?q=' + encodeURIComponent($('#user-search').q.value));
  $('#user-count').textContent = `(${rows.length})`;
  $('#users').innerHTML = rows.length ? rows.map((u) => `<tr class="click" data-user="${u.id}">
    <td class="mono"><b>${esc(u.phone)}</b></td><td>${esc(u.name)}</td>
    <td class="num">${u.balance ? `<b class="warn-t">${vnd(u.balance)}</b>` : '—'}</td><td class="num">${vnd(u.total_received)}</td>
    <td class="num">${vnd(u.total_voucher)}</td><td class="num">${vnd(u.total_donated)}</td><td class="num">${num(u.transactions)}</td>
    <td>${esc(stName(u.last_station_id))}</td><td class="mono small">${esc(u.last_used_at || '—')}</td>
    <td>${u.is_active ? pill(['Hoạt động', 'ok']) : pill(['Đã khóa', 'bad'])}</td></tr>`).join('') : '<tr><td colspan="10" class="empty">Không có người dùng</td></tr>';
}
let searchT;
$('#user-search').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(loadUsers, 250); });
$('#user-search').addEventListener('submit', (e) => { e.preventDefault(); loadUsers(); });
$('#new-user').addEventListener('submit', async (e) => {
  e.preventDefault();
  try { await post('/api/admin/users', { phone: e.target.phone.value, name: e.target.name.value }); e.target.reset(); loadUsers(); } catch (err) { alertMsg(err.message); }
});
$('#users').addEventListener('click', (e) => { const tr = e.target.closest('[data-user]'); if (tr) openUser(Number(tr.dataset.user)); });

async function openUser(id) {
  const u = await api(`/api/admin/users/${id}`);
  const dlg = $('#user-dlg');
  $('#user-detail').innerHTML = `
    <h2>${esc(u.name)} <span class="muted">${esc(u.phone)}</span> ${u.is_active ? pill(['Hoạt động', 'ok']) : pill(['Đã khóa', 'bad'])}</h2>
    ${u.in_use_at ? `<p class="alert">Đang sử dụng ${esc(stName(u.in_use_at))}</p>` : ''}
    <div class="cards mini">
      <div class="card"><small>Số dư chờ nhận</small><b>${vnd(u.balance)}</b></div>
      <div class="card"><small>Đã chuyển vào STK</small><b>${vnd(u.total_received)}</b></div>
      <div class="card"><small>Voucher</small><b>${vnd(u.total_voucher)}</b></div>
      <div class="card"><small>Từ thiện</small><b>${vnd(u.total_donated)}</b></div>
    </div>
    <p class="muted small">Đăng ký tại ${esc(stName(u.created_station_id))} lúc ${esc(u.created_at)} · dùng gần nhất ${esc(u.last_used_at || '—')} tại ${esc(stName(u.last_station_id))}</p>
    <form id="user-edit" class="inline-form">
      <input name="phone" value="${esc(u.phone)}" aria-label="Số điện thoại" required>
      <input name="name" value="${esc(u.name)}" aria-label="Họ tên" required>
      <button class="btn primary sm">Lưu</button>
      <button type="button" class="btn ghost sm" data-lock="${u.is_active ? 0 : 1}">${u.is_active ? 'Khóa tài khoản' : 'Mở khóa'}</button>
      <button type="button" class="btn danger sm" data-del>Xóa</button>
    </form>
    <h3>Theo trạm</h3>
    <div class="table-wrap"><table><thead><tr><th>Trạm</th><th class="num">Lượt bỏ rác</th><th class="num">Nhựa</th><th class="num">Kim loại</th></tr></thead><tbody>
      ${u.by_station.map((b) => `<tr><td>${esc(stName(b.station_id))}</td><td class="num">${b.visits}</td><td class="num">${b.bottles}</td><td class="num">${b.cans}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Chưa bỏ rác</td></tr>'}
    </tbody></table></div>
    <h3>Lượt nhận tiền</h3>
    <div class="table-wrap short"><table><thead><tr><th>Thời gian</th><th>Trạm</th><th>Hình thức</th><th>Chi tiết</th><th class="num">Số tiền</th></tr></thead><tbody>
      ${u.payouts.map((p) => `<tr><td class="mono small">${esc(p.created_at)}</td><td>${esc(stName(p.station_id))}</td><td>${pill(METHOD[p.method])}</td><td class="small">${esc(p.bank ? `${p.bank} ${p.account}` : p.voucher || '')}</td><td class="num">${vnd(p.amount)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">Chưa có</td></tr>'}
    </tbody></table></div>
    <p class="err small" id="user-err"></p>`;
  const f = $('#user-edit');
  const err = (m) => { $('#user-err').textContent = m; };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post(`/api/admin/users/${id}`, { phone: f.phone.value, name: f.name.value }, 'PATCH'); loadUsers(); openUser(id); } catch (x) { err(x.message); }
  });
  f.querySelector('[data-lock]').addEventListener('click', async (e) => {
    try { await post(`/api/admin/users/${id}`, { is_active: e.target.dataset.lock === '1' }, 'PATCH'); loadUsers(); openUser(id); } catch (x) { err(x.message); }
  });
  f.querySelector('[data-del]').addEventListener('click', async (e) => {
    const b = e.target;
    if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Bấm lần nữa: xóa hẳn (không hoàn tác)'; return; }
    try { await api(`/api/admin/users/${id}`, { method: 'DELETE' }); dlg.close(); loadUsers(); } catch (x) { err(x.message); }
  });
  if (!dlg.open) dlg.showModal();
}

// ------------------------------------------------------------------ voucher
async function loadVouchers() {
  const f = $('#v-filter');
  const rows = await api(`/api/admin/vouchers?station=${scope()}&status=${f.status.value}&q=${encodeURIComponent(f.q.value)}`);
  $('#vouchers').innerHTML = rows.length ? rows.map((v) => `<tr>
    <td class="mono"><b>${esc(v.code)}</b></td><td class="num"><b>${vnd(v.amount)}</b></td>
    <td>${esc(v.user || '—')}<br><small class="muted">${esc(v.phone)}</small></td><td>${esc(stName(v.station_id))}</td>
    <td class="mono small">${esc(v.created_at)}</td><td class="mono small">${esc(v.expires_at)}</td><td>${pill(VSTATUS[v.status])}</td>
    <td>${esc(v.merchant || '')}<br><small class="muted mono">${esc(v.used_at || '')}</small></td>
    <td>${v.status === 'active' ? `<button class="btn danger sm" data-void="${v.id}">Hủy</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">Không có voucher</td></tr>';
}
$('#v-filter').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(loadVouchers, 250); });
$('#v-filter').addEventListener('submit', (e) => { e.preventDefault(); loadVouchers(); });
$('#vouchers').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-void]');
  if (!b) return;
  if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Xác nhận hủy'; return; }
  try { await post(`/api/admin/vouchers/${b.dataset.void}/void`); loadVouchers(); } catch (err) { alertMsg(err.message); }
});

// ------------------------------------------------------------------ cửa hàng
async function loadOrders() {
  const rows = await api('/api/admin/orders');
  $('#orders').innerHTML = rows.length ? rows.map((o) => `<tr><td class="mono">${o.id}</td><td class="mono small">${esc(o.created_at)}</td><td>${esc(o.merchant)}</td>
    <td class="small">${o.items.map((i) => `${esc(i.name)} × ${i.qty}`).join(', ')}</td><td class="num"><b>${vnd(o.total)}</b></td>
    <td class="mono small">${esc(o.voucher || '—')}${o.voucher_lost ? `<br><small class="muted">dư bỏ ${vnd(o.voucher_lost)}</small>` : ''}</td>
    <td class="num">${vnd(o.voucher_amount)}</td><td class="num">${vnd(o.cash_amount)}</td></tr>`).join('') : '<tr><td colspan="8" class="empty">Chưa có đơn</td></tr>';
}
const PCAT = { do_uong: 'Đồ uống', do_an: 'Đồ ăn', ve_xe: 'Vé xe', khac: 'Khác' };
async function openProducts(mid, name) {
  const rows = await api(`/api/admin/merchants/${mid}/products`);
  const catSel = (v) => `<select name="category">${Object.entries(PCAT).map(([k, t]) => `<option value="${k}" ${k === v ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  $('#prod-detail').innerHTML = `<h2>Sản phẩm · ${esc(name)}</h2>
    <form class="inline-form wrap-form" id="prod-new"><input name="icon" placeholder="🙂" size="3" aria-label="Biểu tượng">
      <input name="name" placeholder="Tên sản phẩm" required aria-label="Tên"><input name="price" type="number" min="1" placeholder="Giá (đ)" required aria-label="Giá">
      ${catSel('khac')}<button class="btn primary sm">+ Thêm</button></form>
    <div class="table-wrap"><table><thead><tr><th></th><th>Tên</th><th>Nhóm</th><th class="num">Giá (đ)</th><th>Đang bán</th><th></th></tr></thead><tbody>
    ${rows.map((p) => `<tr data-pid="${p.id}"><td><input name="icon" value="${esc(p.icon || '')}" size="3" aria-label="Biểu tượng"></td>
      <td><input name="name" value="${esc(p.name)}" aria-label="Tên"></td><td>${catSel(p.category)}</td>
      <td class="num"><input name="price" type="number" min="1" value="${p.price}" style="width:90px" aria-label="Giá"></td>
      <td><input type="checkbox" name="is_active" ${p.is_active ? 'checked' : ''} aria-label="Đang bán"></td>
      <td><button class="btn ghost sm" data-psave="${p.id}">Lưu</button></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Chưa có sản phẩm</td></tr>'}
    </tbody></table></div><p class="err small" id="prod-err"></p>`;
  const err = (m) => { $('#prod-err').textContent = m; };
  $('#prod-new').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await post(`/api/admin/merchants/${mid}/products`, { icon: f.icon.value, name: f.name.value, price: Number(f.price.value), category: f.category.value }); openProducts(mid, name); }
    catch (x) { err(x.message); }
  });
  $('#prod-detail').querySelectorAll('[data-psave]').forEach((b) => b.addEventListener('click', async () => {
    const tr = b.closest('tr'), q = (n) => tr.querySelector(`[name=${n}]`);
    try {
      await post(`/api/admin/products/${b.dataset.psave}`, { icon: q('icon').value, name: q('name').value, category: q('category').value,
        price: Number(q('price').value), is_active: q('is_active').checked }, 'PATCH');
      alertMsg('Đã lưu sản phẩm', 'ok');
    } catch (x) { err(x.message); }
  }));
  if (!$('#prod-dlg').open) $('#prod-dlg').showModal();
}
async function loadMerchants() {
  loadOrders();
  const rows = await api('/api/admin/merchants');
  $('#merchants').innerHTML = rows.length ? rows.map((m) => `<tr>
    <td class="mono"><b>${esc(m.code)}</b></td><td>${esc(m.name)}</td><td>${esc(m.kind_vi)}</td><td>${esc(m.address || '')}</td>
    <td class="num">${num(m.redeemed)}</td><td class="num">${vnd(m.redeemed_amount)}</td>
    <td>${m.is_active ? pill(['Hoạt động', 'ok']) : pill(['Đã khóa', 'bad'])}</td>
    <td><label class="chk" title="Quầy thu ngân trong mô phỏng 3D vào thẳng cửa hàng này, không cần PIN"><input type="checkbox" data-demo="${m.id}" ${m.is_demo ? 'checked' : ''}> Demo</label></td>
    <td class="actions"><span class="pin-edit"><input data-pinv="${m.id}" placeholder="PIN mới" inputmode="numeric" size="7" aria-label="PIN mới">
      <button class="btn ghost sm" data-pin="${m.id}">Đổi PIN</button></span>
      <button class="btn ghost sm" data-mlock="${m.id}" data-on="${m.is_active ? 0 : 1}">${m.is_active ? 'Khóa' : 'Mở khóa'}</button>
      <button class="btn ghost sm" data-prods="${m.id}" data-name="${esc(m.name)}">Sản phẩm</button></td></tr>`).join('')
    : '<tr><td colspan="9" class="empty">Chưa có cửa hàng – thêm ở trên</td></tr>';
}
$('#merchants').addEventListener('change', async (e) => {
  const c = e.target.closest('[data-demo]');
  if (!c) return;
  try { await post(`/api/admin/merchants/${c.dataset.demo}`, { is_demo: c.checked }, 'PATCH'); alertMsg(c.checked ? 'Đã bật cửa hàng demo cho mô phỏng 3D' : 'Đã tắt chế độ demo', 'ok'); }
  catch (err) { alertMsg(err.message); c.checked = !c.checked; }
});
$('#new-merchant').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await post('/api/admin/merchants', { code: f.code.value, name: f.name.value, kind: f.kind.value, address: f.address.value, pin: f.pin.value });
    f.reset(); loadMerchants(); alertMsg('Đã thêm cửa hàng', 'ok');
  } catch (err) { alertMsg(err.message); }
});
$('#merchants').addEventListener('click', async (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.pin) {
      const pin = $(`[data-pinv="${b.dataset.pin}"]`).value.trim();
      if (!pin) { alertMsg('Nhập PIN mới vào ô bên cạnh'); return; }
      await post(`/api/admin/merchants/${b.dataset.pin}`, { pin }, 'PATCH');
      alertMsg('Đã đổi PIN', 'ok');
    } else if (b.dataset.prods) { openProducts(Number(b.dataset.prods), b.dataset.name); return; }
    else if (b.dataset.mlock) await post(`/api/admin/merchants/${b.dataset.mlock}`, { is_active: b.dataset.on === '1' }, 'PATCH');
    else return;
    loadMerchants();
  } catch (err) { alertMsg(err.message); }
});

// ------------------------------------------------------------------ giao dịch
async function loadTxs() {
  const params = new URLSearchParams(new FormData($('#filter')));
  params.set('station', scope());
  for (const [k, v] of [...params]) if (!v) params.delete(k);
  const rows = await api('/api/admin/transactions?' + params);
  $('#txs').innerHTML = rows.length ? rows.map((t) => `<tr>
    <td class="mono">${t.id}</td><td class="mono small">${esc(t.created_at)}</td><td>${esc(stName(t.station_id))}</td>
    <td>${esc(t.user)}<br><small class="muted">${esc(t.phone)}</small></td>
    <td>${t.source === 'slot' ? 'Lỗ từ thiện' : 'Khay nạp'}</td><td>${pill(STATUS[t.status])}</td>
    <td class="num">${t.bottles}</td><td class="num">${t.cans}</td><td class="num"><b>${vnd(t.amount)}</b></td>
    <td>${t.payout ? pill(METHOD[t.payout]) : '<span class="muted">—</span>'}</td>
    <td>${t.image_url ? `<button class="thumb" data-img="${esc(t.image_url)}"><img src="${esc(t.image_url)}" alt="Ảnh quét" loading="lazy"></button>` : ''}</td>
    <td>${t.rejected.map((r) => `<button class="thumb bad" data-img="${esc(r.crop_url)}" title="${esc(r.label_vi)}"><img src="${esc(r.crop_url)}" alt="${esc(r.label_vi)}" loading="lazy"></button>`).join('')}</td>
  </tr>`).join('') : '<tr><td colspan="12" class="empty">Không có giao dịch</td></tr>';
}
$('#filter').addEventListener('submit', (e) => { e.preventDefault(); loadTxs(); });
$('#txs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-img]');
  if (!b) return;
  $('#viewer img').src = b.dataset.img;
  $('#viewer').showModal();
});

// ------------------------------------------------------------------ cài đặt
async function loadSettings() {
  const s = await api('/api/admin/overview');
  const f = $('#settings');
  if (f.contains(document.activeElement)) return;
  f.price_bottle.value = s.prices.bottle;
  f.price_can.value = s.prices.can;
  for (const k of Object.keys(s.settings)) if (f[k]) f[k].value = s.settings[k];
}
$('#settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, Number(v)]));
  try { await post('/api/admin/settings', data); $('#settings-msg').textContent = 'Đã lưu'; } catch (err) { $('#settings-msg').textContent = err.message; }
  setTimeout(() => { $('#settings-msg').textContent = ''; }, 3000);
});

// ------------------------------------------------------------------ thông báo nhỏ + cập nhật trực tiếp
function alertMsg(text, tone = 'bad') {
  const el = document.createElement('div');
  el.className = `toast ${tone}`;
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
const socket = window.io({ transports: ['websocket', 'polling'], query: { role: 'admin' } });
let timer;
socket.on('admin:update', () => {
  if (tab === 'settings' || document.querySelector('dialog[open]') || document.activeElement?.closest('form')) return;
  clearTimeout(timer); timer = setTimeout(load, 600);
});
// sự cố an ninh: báo ngay (âm báo ngắn + thông báo nổi), cập nhật huy hiệu tab An ninh
socket.on('admin:security', (ev) => {
  alertMsg(`⚠ ${ev.station_code || 'Trạm ' + ev.station_id}: ${SKIND[ev.kind] || ev.kind} – ${ev.detail}`, 'bad');
  try {
    const a = new AudioContext(), o = a.createOscillator(), g = a.createGain();
    o.frequency.value = 880; g.gain.value = 0.08; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + 0.25);
  } catch { /* trình duyệt chặn âm thanh */ }
  if (tab === 'security' || tab === 'overview' || tab === 'stations') load();
  else loadStationList();
});
socket.on('connect', () => $('#live').classList.add('on'));
socket.on('disconnect', () => $('#live').classList.remove('on'));

loadStationList().then(() => showTab(tab));
