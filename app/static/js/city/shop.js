// Cửa hàng demo đối diện trạm (bên kia đường) + quầy thu ngân + ví voucher của người chơi.
// Lấy voucher ở trạm -> voucher tự vào "ví điện thoại" (lưu trên trình duyệt này). Bấm cửa hàng -> camera bay tới,
// mở màn hình thu ngân (trang /shop thật, vào thẳng tài khoản cửa hàng demo) -> bấm "Đưa mã cho thu ngân quét"
// -> thu ngân thấy mệnh giá, bấm Xác nhận dùng -> voucher hết hiệu lực trên server.
// Điều khiển nhân vật: đi vào trong cửa hàng, E ở kệ -> chọn hàng vào giỏ, E ở quầy -> giỏ chuyển sang hóa đơn của
// thu ngân, đưa voucher, thu ngân bấm Thanh toán (voucher trừ trước, thiếu thì tiền mặt).
import * as THREE from 'three';
import { L } from './street.js';
import { mesh } from '../world.js';
import { flyTo } from '../ui/viewButtons.js';
import { toast } from '../ui/toast.js';

const WALLET_KEY = 'peace.wallet.v1';
const vnd = (n) => Number(n || 0).toLocaleString('vi-VN') + 'đ';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ST = { active: 'Còn hiệu lực', used: 'Đã dùng', expired: 'Hết hạn', void: 'Đã hủy', missing: 'Không tồn tại' };

function signTex(name) {
  const c = document.createElement('canvas'); c.width = 1536; c.height = 256;
  const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#0ea5e9'); gr.addColorStop(1, '#0369a1');
  g.fillStyle = gr; g.fillRect(0, 0, 1536, 256);
  g.fillStyle = '#fff'; g.font = '800 120px "Be Vietnam Pro", Arial'; g.textBaseline = 'middle';
  g.fillText('PEACE MART', 60, 112);
  g.font = '600 54px "Be Vietnam Pro", Arial'; g.fillStyle = '#e0f2fe';
  g.fillText('Nhận voucher tái chế PEACE · Mở cửa 24/7', 64, 205);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function shelfTex() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f1f5f9'; g.fillRect(0, 0, 512, 256);
  const cols = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#eab308'];
  for (let r = 0; r < 4; r++) {
    g.fillStyle = '#94a3b8'; g.fillRect(0, r * 64 + 58, 512, 6);
    for (let x = 4; x < 508; x += 18 + (x % 7)) {
      g.fillStyle = cols[(x * 13 + r * 5) % cols.length];
      const h = 26 + ((x * 7 + r) % 24);
      g.fillRect(x, r * 64 + 58 - h, 14, h);
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shelfSign(text) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#0369a1'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#fff'; g.font = '800 52px "Be Vietnam Pro", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Dựng cửa hàng (hệ tọa độ phố): mặt tiền ở z = SHOP.z, quay về phía đường (-Z). */
export function buildShop(city) {
  const S = L.SHOP;
  const g = new THREE.Group();
  g.position.set(S.x, 0, S.z);
  g.name = 'shop';
  const wall = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: 0x0369a1, roughness: 0.5 });
  const floor = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xbfe3f5, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.28, depthWrite: false });
  const hw = S.w / 2;
  // vỏ: sàn, trần, 2 vách, vách sau (kệ hàng)
  g.add(mesh(new THREE.BoxGeometry(S.w, 0.06, S.d), floor, 0, 0.03, S.d / 2));
  g.add(mesh(new THREE.BoxGeometry(S.w, 0.2, S.d), wall, 0, S.h, S.d / 2));
  g.add(mesh(new THREE.BoxGeometry(0.2, S.h, S.d), wall, -hw, S.h / 2, S.d / 2));
  g.add(mesh(new THREE.BoxGeometry(0.2, S.h, S.d), wall, hw, S.h / 2, S.d / 2));
  g.add(mesh(new THREE.BoxGeometry(S.w, S.h, 0.2), wall, 0, S.h / 2, S.d));
  // mặt tiền: chân tường + khung + kính lớn, cửa kính giữa
  g.add(mesh(new THREE.BoxGeometry(S.w, 0.45, 0.2), trim, 0, 0.225, 0));
  g.add(mesh(new THREE.BoxGeometry(S.w, 0.75, 0.22), trim, 0, S.h - 0.3, 0));
  for (const x of [-hw + 0.1, -1.1, 1.1, hw - 0.1]) g.add(mesh(new THREE.BoxGeometry(0.12, S.h - 0.6, 0.18), trim, x, (S.h - 0.6) / 2 + 0.3, 0));
  for (const [x1, x2] of [[-hw + 0.16, -1.16], [1.16, hw - 0.16]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(x2 - x1, S.h - 1.2), glass);
    p.position.set((x1 + x2) / 2, 0.45 + (S.h - 1.2) / 2, 0); p.rotation.y = Math.PI; g.add(p);
  }
  const door = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 2.5), glass);
  door.position.set(0, 1.25, 0.02); door.rotation.y = Math.PI; g.add(door);
  // bảng hiệu phát sáng + mái hiên
  const signMat = new THREE.MeshStandardMaterial({ map: signTex(), emissive: 0xffffff, roughness: 0.4, emissiveIntensity: 0.45 });
  signMat.emissiveMap = signMat.map;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(S.w - 0.6, 1.0), signMat);
  sign.position.set(0, S.h + 0.5, -0.12); sign.rotation.y = Math.PI; g.add(sign);
  g.add(mesh(new THREE.BoxGeometry(S.w, 1.0, 0.1), trim, 0, S.h + 0.5, -0.05));
  const awn = mesh(new THREE.BoxGeometry(S.w + 0.4, 0.06, 1.3), new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.6 }), 0, S.h - 0.05, -0.62);
  awn.rotation.x = -0.18; g.add(awn);
  // bên trong: kệ hàng, quầy thu ngân + máy POS + tủ lạnh
  const shelves = new THREE.MeshStandardMaterial({ map: shelfTex(), roughness: 0.7 });
  for (const x of [-2.6, 0, 2.6]) {
    const sh = mesh(new THREE.BoxGeometry(2.2, 1.9, 0.5), [wall, wall, wall, wall, shelves, shelves], x, 0.95, S.d - 1.4);
    g.add(sh);
  }
  const fridge = mesh(new THREE.BoxGeometry(2.6, 2.1, 0.7), [wall, wall, wall, wall, wall, shelves], hw - 0.6, 1.05, 2.6);
  fridge.rotation.y = -Math.PI / 2;
  g.add(fridge);
  const counter = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
  g.add(mesh(new THREE.BoxGeometry(2.4, 1.0, 0.7), counter, -2.4, 0.5, 1.6));
  g.add(mesh(new THREE.BoxGeometry(2.5, 0.05, 0.8), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.3 }), -2.4, 1.02, 1.6));
  const pos = new THREE.Group();
  pos.position.set(-2.3, 1.05, 1.5);
  pos.add(mesh(new THREE.BoxGeometry(0.08, 0.25, 0.08), counter, 0, 0.12, 0.05));
  const scr = mesh(new THREE.BoxGeometry(0.42, 0.3, 0.03), new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0ea5e9, emissiveIntensity: 0.6 }), 0, 0.33, 0);
  scr.rotation.x = 0.3; pos.add(scr);
  pos.add(mesh(new THREE.BoxGeometry(0.14, 0.1, 0.06), counter, 0.3, 0.06, -0.1));   // đầu quét QR
  g.add(pos);
  // biển nhóm hàng trên từng kệ
  ['ĐỒ UỐNG', 'ĐỒ ĂN', 'VÉ XE · KHÁC'].forEach((t, i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.3), new THREE.MeshStandardMaterial({ map: shelfSign(t), roughness: 0.6 }));
    m.position.set(-2.6 + i * 2.6, 2.1, S.d - 1.66); m.rotation.y = Math.PI;
    g.add(m);
  });
  city.add(g);
  city.updateMatrixWorld(true);     // khung phố đóng băng ma trận -> tính 1 lần cho cửa hàng vừa thêm
  g.userData.action = 'shop';
  g.userData.hint = 'PEACE Mart – bấm để vào quầy thu ngân dùng voucher';
  return { group: g, counterLocal: new THREE.Vector3(-2.3, 1.3, 1.5) };
}

// ============================================================ ví voucher
function loadWallet() {
  try { return JSON.parse(localStorage.getItem(WALLET_KEY) || '[]'); } catch (_) { return []; }
}
function saveWallet(list) {
  try { localStorage.setItem(WALLET_KEY, JSON.stringify(list.slice(0, 40))); } catch (_) { /* chế độ riêng tư: chỉ giữ trong phiên */ }
}

export function setupShop(ctx, stations) {
  const shopObj = buildShop(ctx.street.city);
  (ctx.extraPickables ||= []).push(shopObj.group);
  let wallet = loadWallet();
  let open = false;

  // ---- giao diện: nút ví ở thanh trên + bảng ví + màn hình thu ngân
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'wallet-btn';
  document.querySelector('.topbar')?.insertBefore(btn, document.querySelector('.topbar .hint'));
  const panel = document.createElement('aside');
  panel.className = 'wallet hidden';
  panel.setAttribute('aria-label', 'Ví voucher');
  document.body.appendChild(panel);
  const pos = document.createElement('section');
  pos.className = 'cashier hidden';
  pos.setAttribute('aria-label', 'Quầy thu ngân');
  pos.innerHTML = `<header><b>Quầy thu ngân · ${esc(window.DEMO_SHOP?.name || 'PEACE Mart')}</b>
    <button type="button" class="mini ghost" data-close>Rời cửa hàng</button></header>
    <div class="scan-strip" aria-label="Máy quét voucher ở quầy"></div>
    <iframe title="Màn hình thu ngân (trang cửa hàng)" src="about:blank"></iframe>`;
  document.body.appendChild(pos);
  const iframe = pos.querySelector('iframe');

  const strip = pos.querySelector('.scan-strip');
  function render() {
    const active = wallet.filter((v) => v.status === 'active');
    // máy quét ở quầy: voucher đang cầm (phiếu giấy trước) -> bấm Quét là trừ luôn
    const scanList = [...active].sort((a, b) => (b.paper ? 1 : 0) - (a.paper ? 1 : 0));
    strip.innerHTML = scanList.length
      ? `<span>📷 Máy quét:</span>${scanList.map((v) => `<button type="button" class="mini scan" data-scan="${esc(v.code)}">${v.paper ? '📄' : '📱'} Quét ${esc(v.code)} · ${vnd(v.amount)}</button>`).join('')}`
      : '<span class="muted">Chưa cầm voucher nào – in phiếu ở trạm (nút In voucher) rồi bấm vào phiếu để cầm</span>';
    ctx.player?.setHolding?.(active.some((v) => v.paper));
    btn.innerHTML = `🎫 Ví voucher <b>${active.length}</b>`;
    btn.classList.toggle('has', active.length > 0);
    panel.innerHTML = `<div class="wallet-head"><b>Ví voucher của bạn</b><button type="button" class="mini ghost" data-x aria-label="Đóng ví">✕</button></div>
      <p class="muted small">Voucher lấy ở trạm tự lưu vào đây (trên trình duyệt này). Dùng ở cửa hàng đối diện.</p>
      ${wallet.length ? `<ul>${wallet.map((v) => `<li class="${v.status}">
          <div><b class="mono">${v.paper ? '📄 ' : ''}${esc(v.code)}</b><small>${v.paper ? 'Phiếu giấy đang cầm · ' : ''}${esc(ST[v.status] || v.status)}${v.status === 'active' && v.expires_at ? ` · hạn ${esc(v.expires_at.slice(0, 10))}` : ''}${v.merchant ? ` · ${esc(v.merchant)}` : ''}</small></div>
          <span class="amt">${vnd(v.amount)}</span>
          ${v.status === 'active' ? `<button type="button" class="mini" data-use="${esc(v.code)}">${open ? 'Đưa mã cho thu ngân quét' : 'Ra cửa hàng dùng'}</button>` : ''}
        </li>`).join('')}</ul>` : '<p class="empty">Chưa có voucher nào – bỏ chai / lon ở trạm rồi chọn <b>Lấy voucher</b>.</p>'}
      <form data-add class="wallet-add"><input name="code" placeholder="Thêm mã DN-XXXX-XXXX" aria-label="Thêm mã voucher" autocomplete="off"><button class="mini ghost">Thêm</button></form>`;
  }
  async function refresh() {
    if (!wallet.length) return render();
    try {
      const r = await fetch('/api/wallet/status', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codes: wallet.map((v) => v.code) }) });
      const rows = await r.json();
      const by = Object.fromEntries(rows.map((x) => [x.code, x]));
      wallet = wallet.map((v) => ({ ...v, ...(by[v.code] || {}) }));
      saveWallet(wallet);
    } catch (_) { /* mất mạng: giữ trạng thái cũ */ }
    render();
  }
  function add(v, { paper = false } = {}) {
    const old = v?.code && wallet.find((x) => x.code === v.code);
    if (old) { if (paper && !old.paper) { old.paper = true; saveWallet(wallet); render(); } return false; }
    if (!v?.code) return false;
    wallet.unshift({ code: v.code, amount: v.amount, status: v.status || 'active', expires_at: v.expires_at, station_id: v.station_id, paper });
    saveWallet(wallet);
    render();
    return true;
  }

  // voucher vừa tạo ở trạm (state.last_payout.voucher) -> vào ví
  ctx.bridge.onState((s) => {
    const v = s?.last_payout?.voucher;
    if (v && add(v)) {
      toast(`Đã lưu voucher ${vnd(v.amount)} vào ví – dùng ở PEACE Mart đối diện`, 'success');
      btn.classList.add('bump'); setTimeout(() => btn.classList.remove('bump'), 900);
    }
  });

  btn.addEventListener('click', () => { panel.classList.toggle('hidden'); if (!panel.classList.contains('hidden')) refresh(); });
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) panel.classList.add('hidden');
    const use = e.target.closest('[data-use]');
    if (!use) return;
    if (!open) { goCounter(); return; }
    iframe.contentWindow?.postMessage({ type: 'peace:scan', code: use.dataset.use }, location.origin);
    toast('Thu ngân đang quét mã…', 'info');
  });
  panel.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = e.target.code.value.trim().toUpperCase();
    if (code) { add({ code, status: 'active' }); refresh(); }
  });
  let posReady = false;
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin) return;
    const d = e.data || {};
    if (d.type === 'peace:ready') { posReady = true; sendCart(); }
    else if (d.type === 'peace:redeemed') { toast(`Thanh toán bằng voucher ${d.code} thành công`, 'success'); refresh(); }
    else if (d.type === 'peace:scan-failed') toast(`Quét không thành công: ${d.error || ''}`, 'error');
    else if (d.type === 'peace:paid') {
      const o = d.order;
      toast(`Đã mua ${o.items.reduce((n, i) => n + i.qty, 0)} món – ${o.voucher ? `voucher trừ ${vnd(o.voucher_amount)}, ` : ''}tiền mặt ${vnd(o.cash_amount)}`, 'success');
      bought.unshift(...o.items.map((i) => `${i.name} × ${i.qty}`));
      cart.length = 0; renderCart(); refresh();
    }
  });

  // ---- giỏ hàng + kệ hàng (nhân vật đi trong cửa hàng)
  const cart = [];          // [{id, name, price, icon, qty}]
  const bought = [];
  let catalog = [];
  const loadCatalog = async () => {
    if (catalog.length || !window.DEMO_SHOP) return catalog;
    try {
      const r = await fetch(`/api/store/${encodeURIComponent(window.DEMO_SHOP.code)}/products`);
      catalog = (await r.json()).products || [];
    } catch (_) { catalog = []; }
    return catalog;
  };
  const cartBtn = document.createElement('button');
  cartBtn.type = 'button'; cartBtn.className = 'wallet-btn cart-btn';
  document.querySelector('.topbar')?.insertBefore(cartBtn, document.querySelector('.topbar .hint'));
  const cartPanel = document.createElement('aside');
  cartPanel.className = 'wallet cart hidden';
  cartPanel.setAttribute('aria-label', 'Giỏ hàng');
  document.body.appendChild(cartPanel);
  const picker = document.createElement('section');
  picker.className = 'picker hidden';
  picker.setAttribute('aria-label', 'Chọn hàng');
  document.body.appendChild(picker);
  const cartTotal = () => cart.reduce((n, l) => n + l.price * l.qty, 0);
  function renderCart() {
    const n = cart.reduce((k, l) => k + l.qty, 0);
    cartBtn.innerHTML = `🛒 Giỏ hàng <b>${n}</b>`;
    cartBtn.classList.toggle('has', n > 0);
    cartPanel.innerHTML = `<div class="wallet-head"><b>Giỏ hàng</b><button type="button" class="mini ghost" data-x aria-label="Đóng giỏ">✕</button></div>
      ${cart.length ? `<ul>${cart.map((l, i) => `<li class="active"><div><b>${esc(l.icon || '')} ${esc(l.name)}</b><small>${vnd(l.price)} × ${l.qty}</small></div>
        <span class="amt">${vnd(l.price * l.qty)}</span>
        <div class="qty-row"><button type="button" class="mini ghost" data-dec="${i}">−</button><button type="button" class="mini ghost" data-inc="${i}">+</button></div></li>`).join('')}</ul>
        <p class="cart-total">Tổng: <b>${vnd(cartTotal())}</b></p>
        <p class="muted small">Ra <b>quầy thu ngân</b> (bên trái cửa vào) bấm <kbd>E</kbd> để thanh toán – voucher trừ trước, thiếu trả tiền mặt.</p>`
        : '<p class="empty">Giỏ trống – vào PEACE Mart, đứng trước kệ bấm <kbd>E</kbd> để chọn hàng.</p>'}
      ${bought.length ? `<p class="muted small">Đã mua: ${bought.slice(0, 6).map(esc).join(', ')}</p>` : ''}`;
    if (open) sendCart();
  }
  function sendCart() {
    if (!posReady || !open) return;
    iframe.contentWindow?.postMessage({ type: 'peace:cart', items: cart.map((l) => ({ product_id: l.id, qty: l.qty })) }, location.origin);
  }
  function addToCart(p) {
    const l = cart.find((x) => x.id === p.id);
    if (l) l.qty = Math.min(20, l.qty + 1); else cart.push({ ...p, qty: 1 });
    renderCart();
    cartBtn.classList.add('bump'); setTimeout(() => cartBtn.classList.remove('bump'), 900);
  }
  cartBtn.addEventListener('click', () => cartPanel.classList.toggle('hidden'));
  cartPanel.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) cartPanel.classList.add('hidden');
    const d = e.target.closest('[data-dec]'), u = e.target.closest('[data-inc]');
    if (d) { const l = cart[+d.dataset.dec]; if (--l.qty <= 0) cart.splice(+d.dataset.dec, 1); renderCart(); }
    if (u) { const l = cart[+u.dataset.inc]; l.qty = Math.min(20, l.qty + 1); renderCart(); }
  });
  async function openPicker(cats, title) {
    const list = (await loadCatalog()).filter((p) => !cats || cats.includes(p.category));
    picker.innerHTML = `<header><b>${esc(title)}</b><button type="button" class="mini ghost" data-x>Đóng (Esc)</button></header>
      <div class="pk-grid">${list.map((p) => `<button type="button" class="pk-item" data-p="${p.id}"><span class="ic">${esc(p.icon || '🛍️')}</span>
        <span>${esc(p.name)}</span><b>${vnd(p.price)}</b></button>`).join('') || '<p class="empty">Kệ trống</p>'}</div>
      <p class="muted small">Bấm món để bỏ vào giỏ. Giỏ hiện: <b data-sum>${vnd(cartTotal())}</b></p>`;
    picker.classList.remove('hidden');
  }
  picker.addEventListener('click', (e) => {
    if (e.target.closest('[data-x]')) { picker.classList.add('hidden'); return; }
    const b = e.target.closest('[data-p]');
    if (!b) return;
    const p = catalog.find((x) => x.id === Number(b.dataset.p));
    addToCart(p);
    picker.querySelector('[data-sum]').textContent = vnd(cartTotal());
    toast(`Đã thêm ${p.name} vào giỏ`, 'info');
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') picker.classList.add('hidden');
    if (['w', 'a', 's', 'd'].includes(e.key.toLowerCase()) && !e.target.closest?.('input, textarea')) picker.classList.add('hidden');
  });
  renderCart();

  /** Tương tác trong cửa hàng tại (x, z) phố – dùng cho phím E của nhân vật */
  const SH = L.SHOP;
  function interactionAt(x, z) {
    if (!window.DEMO_SHOP || z < SH.z || z > SH.z + SH.d || Math.abs(x - SH.x) > SH.w / 2) return null;
    const lx = x - SH.x, lz = z - SH.z;
    if (lx < -0.9 && lx > -3.9 && lz < 1.3) {
      return { label: cart.length ? `Thanh toán ${vnd(cartTotal())} ở quầy` : 'Quầy thu ngân (dùng voucher)', run: () => openCounter() };
    }
    if (lz > SH.d - 2.6) {
      const i = lx < -1.3 ? 0 : lx > 1.3 ? 2 : 1;
      const def = [[['do_uong'], 'Kệ đồ uống'], [['do_an'], 'Kệ đồ ăn'], [['ve_xe', 'khac'], 'Vé xe & hàng khác']][i];
      return { label: `Xem ${def[1].toLowerCase()}`, run: () => openPicker(def[0], def[1]) };
    }
    if (lx > SH.w / 2 - 1.7 && lz > 1.1 && lz < 4.1) return { label: 'Mở tủ lạnh đồ uống', run: () => openPicker(['do_uong'], 'Tủ lạnh đồ uống') };
    return null;
  }
  function openCounter() {
    if (!window.DEMO_SHOP) { toast('Chưa có cửa hàng demo – admin bật "Demo" ở tab Cửa hàng', 'warning'); return; }
    shopObj.group.updateWorldMatrix(true, false);
    world.copy(shopObj.counterLocal).applyMatrix4(shopObj.group.matrixWorld);
    ctx.player?.enterShopMode({ pos: [world.x + 1.9, 2.7, L.SHOP.z + 0.25], target: [world.x - 0.4, 1.0, world.z] });   // chéo từ trên: thấy cả quầy lẫn nhân vật
    open = true;
    document.body.classList.add('at-shop');
    if (iframe.src === 'about:blank') iframe.src = '/shop?demo=1&embed=1';
    else sendCart();
    pos.classList.remove('hidden'); panel.classList.remove('hidden'); refresh(); render();
  }

  // ---- vào / rời cửa hàng
  const world = new THREE.Vector3();
  function openShop() {
    if (!window.DEMO_SHOP) { toast('Chưa có cửa hàng demo – admin bật "Cửa hàng demo" ở tab Cửa hàng', 'warning'); return; }
    if (ctx.serverState?.user) { toast('Bạn đang đăng nhập ở trạm – bấm Kết thúc trên màn hình trạm trước khi qua đường', 'warning'); return; }
    shopObj.group.updateWorldMatrix(true, false);
    world.copy(shopObj.counterLocal).applyMatrix4(shopObj.group.matrixWorld);
    // đứng ngoài cửa kính, nhìn vào quầy thu ngân
    flyTo(ctx.camera, ctx.controls, { pos: [world.x + 2.4, 2.1, L.SHOP.z - 4.6], target: [world.x + 0.6, 1.3, world.z] }, 1.6);
    open = true;
    document.body.classList.add('at-shop');
    if (iframe.src === 'about:blank') iframe.src = '/shop?demo=1&embed=1';
    setTimeout(() => { if (open) { pos.classList.remove('hidden'); panel.classList.remove('hidden'); refresh(); } }, 1200);
  }
  function close(fly = true) {
    if (!open) return;
    open = false;
    document.body.classList.remove('at-shop');
    pos.classList.add('hidden');
    render();
    if (ctx.player && ctx.player.mode === 'shop') { ctx.player.setMode('follow'); return; }
    if (fly) flyTo(ctx.camera, ctx.controls, 'overview', 1.4);
  }
  pos.querySelector('[data-close]').addEventListener('click', () => close());
  // bấm vào cửa hàng (ở bất kỳ góc nhìn nào): đưa nhân vật vào đứng trước quầy thu ngân
  function goCounter() {
    if (!ctx.player) { openShop(); return; }
    if (ctx.serverState?.user) { toast('Bạn đang đăng nhập ở trạm – bấm Kết thúc trên màn hình trạm trước khi qua cửa hàng', 'warning'); return; }
    const P = ctx.player.P;
    P.x = SH.x - 2.4; P.z = SH.z + 0.8; P.yaw = 0;          // mặt hướng vào quầy
    openCounter();
  }
  shopObj.group.userData.onClick = goCounter;
  strip.addEventListener('click', (e) => {
    const b = e.target.closest('[data-scan]');
    if (!b) return;
    iframe.contentWindow?.postMessage({ type: 'peace:scan', code: b.dataset.scan, auto: true }, location.origin);
    toast('Đang quét voucher…', 'info');
  });

  render();
  refresh();
  ctx.shop = { open: openShop, close, add, refresh, interactionAt, openCounter, goCounter, cart, get isOpen() { return open; } };
  return ctx.shop;
}
