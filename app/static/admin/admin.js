// Trang quản trị: tổng quan, kho, cấu hình, người dùng, giao dịch
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vnd = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const num = (n) => Number(n || 0).toLocaleString('vi-VN');
const PAYOUT = { transfer: ['Chuyển khoản', 'ok'], charity: ['Từ thiện', 'love'] };
const SOURCE = { tray: 'Khay', slot: 'Lỗ bỏ' };
const STATUS = {
  accepted: ['Đã nhận', 'ok'], rejected: ['Trả rác', 'bad'], scan_failed: ['Quét lỗi', 'warn'], empty: ['Khay trống', 'muted'],
};

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts });
  if (r.status === 401) { location.href = '/admin/login'; throw new Error('401'); }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || r.statusText);
  return data;
}

async function loadStats() {
  const s = await api('/api/admin/stats');
  const st = s.station;
  const pct = Math.min(100, Math.round((st.storage_count / st.storage_capacity) * 100));
  $('#cards').innerHTML = [
    ['Nhựa đã thu', num(s.bottles)],
    ['Kim loại đã thu', num(s.cans)],
    ['Đã chuyển khoản', vnd(s.paid)],
    ['Quỹ từ thiện', vnd(s.charity)],
    ['Dung lượng kho', `${pct}%`],
    ['Khách bỏ qua lỗ', `${num(s.guest_items)} vật`],
    ['Lượt bị trả rác', num(s.rejected_count)],
    ['Người dùng', num(s.users)],
  ].map(([k, v]) => `<div class="card"><small>${k}</small><b>${v}</b></div>`).join('');
  $('#storage').innerHTML = `
    <div class="meter ${st.is_full ? 'full' : pct > 80 ? 'high' : ''}"><i style="width:${pct}%"></i></div>
    <p><b>${num(st.storage_count)}</b> / ${num(st.storage_capacity)} vật ${st.is_full ? '<span class="pill bad">ĐẦY</span>' : ''}</p>`;
  $('#emptied').textContent = st.last_emptied_at ? `Làm trống lần cuối: ${st.last_emptied_at}` : '';
  const f = $('#settings');
  if (!f.contains(document.activeElement)) {
    f.price_bottle.value = s.prices.bottle;
    f.price_can.value = s.prices.can;
    f.storage_capacity.value = st.storage_capacity;
  }
}

async function loadUsers() {
  const users = await api('/api/admin/users');
  $('#user-count').textContent = `${users.length} người`;
  $('#users').innerHTML = users.length ? users.map((u) => `
    <tr>
      <td><b>${esc(u.display_name)}</b></td><td class="mono">${esc(u.masked_account)}</td>
      <td class="num">${vnd(u.total_received)}</td><td class="num">${vnd(u.total_donated)}</td><td class="num">${u.transactions}</td>
      <td>${esc(u.created_at)}</td><td>${esc(u.last_used_at || '—')}</td>
      <td class="num"><button class="btn danger sm" data-del="${u.id}">Xóa</button></td>
    </tr>`).join('') : '<tr><td colspan="8" class="empty">Chưa có người dùng</td></tr>';
  const sel = $('#filter').user_id;
  const cur = sel.value;
  sel.innerHTML = '<option value="">Mọi người dùng</option><option value="guest">Khách (chưa chọn tên)</option>' + users.map((u) => `<option value="${u.id}">${esc(u.display_name)}</option>`).join('');
  sel.value = cur;
}

async function loadTxs() {
  const params = new URLSearchParams([...new FormData($('#filter'))].filter(([, v]) => v));
  let txs;
  try { txs = await api('/api/admin/transactions?' + params); } catch (e) { $('#txs').innerHTML = `<tr><td colspan="11" class="empty">${esc(e.message)}</td></tr>`; return; }
  $('#txs').innerHTML = txs.length ? txs.map((t) => {
    const [label, cls] = STATUS[t.status] || [t.status, ''];
    const [pl, pc] = PAYOUT[t.payout] || (t.status === 'accepted' && t.amount > 0 ? ['Chưa chọn', 'warn'] : ['—', 'muted']);
    return `<tr>
      <td class="mono">${t.id}</td><td>${esc(t.created_at)}</td>
      <td>${t.user_id ? esc(t.user) : '<i class="muted">Khách</i>'} <span class="muted mono">${esc(t.masked_account)}</span></td>
      <td>${SOURCE[t.source] || t.source}</td>
      <td><span class="pill ${cls}">${label}</span>${t.scan_attempts > 1 ? ` <span class="muted small">${t.scan_attempts} lần quét</span>` : ''}</td>
      <td class="num">${t.bottles}</td><td class="num">${t.cans}</td><td class="num"><b>${vnd(t.amount)}</b></td>
      <td>${pl === '—' ? '<span class="muted">—</span>' : `<span class="pill ${pc}">${pl}</span>`}</td>
      <td>${t.image_url ? `<button class="thumb" data-img="${esc(t.image_url)}"><img src="${esc(t.image_url)}" alt="Ảnh quét #${t.id}" loading="lazy"></button>` : '—'}</td>
      <td class="crops">${t.rejected.map((r) => `<button class="thumb bad" data-img="${esc(r.crop_url)}" title="${esc(r.label_vi)} (${Math.round(r.confidence * 100)}%)"><img src="${esc(r.crop_url)}" alt="${esc(r.label_vi)}" loading="lazy"></button>`).join('') || '—'}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="11" class="empty">Chưa có giao dịch</td></tr>';
}

async function loadCharity() {
  const c = await api('/api/admin/charity');
  $('#charity-total').innerHTML = `<b>${vnd(c.total)}</b> <span class="muted small">từ ${num(c.donors)} người</span>`;
  $('#charity').innerHTML = c.items.length ? c.items.map((x) => `
    <tr><td>${esc(x.paid_at)}</td><td><b>${esc(x.user)}</b></td>
      <td class="num">${x.bottles}</td><td class="num">${x.cans}</td><td class="num"><b>${vnd(x.amount)}</b></td></tr>`).join('')
    : '<tr><td colspan="5" class="empty">Chưa có lượt góp nào</td></tr>';
}

const refresh = () => Promise.all([loadStats(), loadUsers(), loadTxs(), loadCharity()]);

$('#empty').addEventListener('click', async (e) => {
  const b = e.currentTarget;
  if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Bấm lần nữa để xác nhận'; setTimeout(() => { delete b.dataset.confirm; b.textContent = 'Làm trống kho'; }, 3000); return; }
  delete b.dataset.confirm; b.textContent = 'Làm trống kho';
  await api('/api/admin/empty-storage', { method: 'POST' });
  loadStats();
});

$('#settings').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.currentTarget;
  try {
    await api('/api/admin/settings', { method: 'POST', body: JSON.stringify({
      price_bottle: f.price_bottle.value, price_can: f.price_can.value, storage_capacity: f.storage_capacity.value,
    }) });
    $('#settings-msg').textContent = 'Đã lưu ✓';
    document.activeElement.blur();
    loadStats();
  } catch (err) { $('#settings-msg').textContent = err.message; }
  setTimeout(() => { $('#settings-msg').textContent = ''; }, 3000);
});

$('#users').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  if (!b.dataset.confirm) { b.dataset.confirm = '1'; b.textContent = 'Xác nhận?'; setTimeout(() => { delete b.dataset.confirm; b.textContent = 'Xóa'; }, 3000); return; }
  try { await api(`/api/admin/users/${b.dataset.del}`, { method: 'DELETE' }); refresh(); } catch (err) { b.textContent = err.message; }
});

$('#filter').addEventListener('submit', (e) => { e.preventDefault(); loadTxs(); });

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-img]');
  if (!t) return;
  const d = $('#viewer');
  $('img', d).src = t.dataset.img;
  d.showModal();
});

// Cập nhật trực tiếp khi trạm có giao dịch mới
const socket = window.io({ transports: ['websocket', 'polling'] });
let timer;
const soon = () => { clearTimeout(timer); timer = setTimeout(refresh, 400); };
socket.on('result', soon);
socket.on('payout', soon);
socket.on('slot:result', soon);
socket.on('state', () => { clearTimeout(timer); timer = setTimeout(loadStats, 400); });
socket.on('connect', () => $('#live').classList.add('on'));
socket.on('disconnect', () => $('#live').classList.remove('on'));

refresh();
