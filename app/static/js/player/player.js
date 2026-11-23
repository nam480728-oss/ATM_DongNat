// Nhân vật điều khiển kiểu thế giới mở: WASD đi (Shift chạy), camera sau lưng; V đổi sang camera trên cao bám
// theo nhân vật; F "Xem tự do" (camera xoay quanh trạm như cũ); E tương tác (dùng trạm, nhặt rác, lấy hàng, thanh toán).
//
// Nhân vật lưu tọa độ "phố" (street) – khung phố dời theo trạm đang dùng, vị trí trong scene = toWorld(x).
// Va chạm: hình tròn bán kính R với các hộp chữ nhật (trạm, cửa hàng, nhà phố, ghế, bồn cây, lan can kè có khe bậc thang).
import * as THREE from 'three';
import { makePerson } from '../city/people.js';
import { L, STAIRS_X } from '../city/street.js';
import { D } from '../station/dims.js';
import { VIEWS, flyTo } from '../ui/viewButtons.js';
import { toast } from '../ui/toast.js';

const R = 0.28;                       // bán kính thân
const SPEED = { walk: 1.7, run: 4.4 };
const FOLLOW = { min: 1.6, max: 7, minPolar: 0.25, maxPolar: 1.52 };
const HIGH = { min: 10, max: 38, minPolar: 0.12, maxPolar: 1.05 };
const FREE = { min: 0.12, max: 16, minPolar: 0, maxPolar: Math.PI / 2 - 0.02 };

/** Độ cao mặt đất tại (x, z) phố */
export function groundY(x, z) {
  const S = L.SHOP;
  if (z >= S.z && z <= S.z + S.d && Math.abs(x - S.x) < S.w / 2) return 0.06;    // sàn cửa hàng
  if (z > L.ROAD.z1 && z < L.ROAD.z2) return -0.15;
  if (z >= L.WALK.z1) return 0;
  const A = L.SAND;
  const t = THREE.MathUtils.clamp((A.z1 - z) / (A.z1 - A.shoreZ), 0, 1.3);
  const sand = A.y1 + (A.y2 - A.y1) * Math.min(t, 1) - Math.max(0, t - 1) * 0.6;
  const bottom = L.WALK.z1 - 1.5;                      // chân bậc thang
  if (STAIRS_X.some((s) => Math.abs(x - s) < 0.75) && z > bottom) {
    const k = (L.WALK.z1 - z) / 1.5;
    return THREE.MathUtils.lerp(0, sand, k);
  }
  return sand;
}

function buildColliders(slots) {
  const B = [];
  const box = (x1, z1, x2, z2) => B.push([x1, z1, x2, z2]);
  for (const s of slots) box(s.x - 0.88, -0.78, s.x + 0.88, 0.78);              // 3 trạm (kể cả thùng mini 2 bên)
  const S = L.SHOP, hw = S.w / 2, z0 = S.z, z1 = S.z + S.d;
  box(S.x - hw - 0.1, z0 - 0.12, S.x - 1.05, z0 + 0.14);                        // mặt tiền (chừa cửa kính giữa)
  box(S.x + 1.05, z0 - 0.12, S.x + hw + 0.1, z0 + 0.14);
  box(S.x - hw - 0.12, z0, S.x - hw + 0.1, z1 + 0.1);
  box(S.x + hw - 0.1, z0, S.x + hw + 0.12, z1 + 0.1);
  box(S.x - hw, z1 - 0.1, S.x + hw, z1 + 0.12);
  for (const x of [-2.6, 0, 2.6]) box(S.x + x - 1.1, z0 + S.d - 1.65, S.x + x + 1.1, z0 + S.d - 1.15);   // kệ
  box(S.x + hw - 0.95, z0 + 1.25, S.x + hw - 0.25, z0 + 3.95);                 // tủ lạnh
  box(S.x - 3.6, z0 + 1.25, S.x - 1.2, z0 + 1.95);                              // quầy thu ngân
  box(-80, z0 - 0.1, S.x - hw - 0.1, z0 + 12);                                  // dãy nhà phố
  box(S.x + hw + 0.1, z0 - 0.1, 80, z0 + 12);
  for (const x of [-14, -4.2, 4.2, 14]) box(x - 0.78, -2.45, x + 0.78, -1.85);  // ghế
  for (const x of [-10.5, 10.5]) box(x - 0.72, -2.55, x + 0.72, -2.05);         // bồn cây
  for (const x of [-17.5, -10.5, -3.5, 3.5, 10.5, 17.5]) box(x - 0.12, L.WALK.z2 - 0.37, x + 0.12, L.WALK.z2 - 0.13);
  for (const x of [-17.5, -3.5, 10.5, 24.5]) box(x - 0.12, L.OPP.z1 + 0.13, x + 0.12, L.OPP.z1 + 0.37);
  for (const x of [-24, -10.5, -3.5, 3.5, 10.5, 24]) box(x + 0.7, -2.5, x + 1.1, -2.1);   // gốc cọ ven kè
  // kè + lan can, chừa khe bậc thang
  const gaps = STAIRS_X.map((s) => [s - 0.68, s + 0.68]).sort((a, b) => a[0] - b[0]);
  let x = -80;
  for (const [a, b] of gaps) { box(x, L.WALK.z1 - 0.23, a, L.WALK.z1 + 0.17); x = b; }
  box(x, L.WALK.z1 - 0.23, 80, L.WALK.z1 + 0.17);
  // thành 2 bên bậc thang (không bước hụt xuống kè)
  for (const s of STAIRS_X) { box(s - 0.8, L.WALK.z1 - 1.5, s - 0.7, L.WALK.z1); box(s + 0.7, L.WALK.z1 - 1.5, s + 0.8, L.WALK.z1); }
  box(-6.75, -15.75, -5.25, -14.25);                                            // chòi cứu hộ
  return B;
}

export function setupPlayer(ctx) {
  const { camera, controls, scene } = ctx;
  const st = ctx.stations;
  const colliders = buildColliders(st.slots);
  const body = makePerson({ shirt: 0x16a34a, shorts: 0x1e293b, skin: 0xe0ac69, hair: 0x1c1917 });
  // mũ lưỡi trai xanh (dễ nhận ra nhân vật của mình giữa đám đông)
  const capMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 });
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
  cap.position.y = 1.57;
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.015, 0.13), capMat);
  brim.position.set(0, 1.58, 0.13);
  body.add(cap, brim);
  body.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  body.name = 'player';
  scene.add(body);
  const J = body.userData.joints;
  // phiếu voucher giấy cầm trên tay phải (hiện khi trong ví có phiếu giấy chưa dùng)
  const held = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.13), new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.9, side: THREE.DoubleSide }));
  held.position.set(0.02, -0.62, 0.06);
  held.rotation.set(-1.2, 0, 0.2);
  held.visible = false;
  J.armR.add(held);

  const slot0 = st.slots[st.active];
  const P = { x: slot0.x + 0.4, z: 2.2, y: 0, yaw: Math.PI, speed: 0, phase: 0 };
  let mode = 'free';
  let transition = 0;
  const keys = new Set();

  // ---------------------------------------------------------------- giao diện: thanh chế độ, gợi ý E
  const bar = document.createElement('nav');
  bar.className = 'modes';
  bar.setAttribute('aria-label', 'Góc nhìn nhân vật');
  bar.innerHTML = `<button type="button" data-m="follow">🚶 Sau lưng</button><button type="button" data-m="high">🛰️ Trên cao</button>
    <button type="button" data-m="free">🎥 Xem tự do</button><span class="keys">WASD đi · Shift chạy · E tương tác · V đổi góc · F tự do · Esc thoát</span>`;
  document.body.appendChild(bar);
  const prompt = document.createElement('div');
  prompt.className = 'prompt hidden';
  prompt.setAttribute('role', 'status');
  document.body.appendChild(prompt);
  const views = document.getElementById('views');
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); });
  const hint = document.querySelector('.topbar .hint');

  // ---------------------------------------------------------------- tọa độ
  const toWorld = (x) => st.toWorld(x);
  const head = new THREE.Vector3();
  const headWorld = (out = head) => out.set(toWorld(P.x), P.y + 1.45, P.z);

  function applyLimits(lim, follow) {
    controls.minDistance = lim.min; controls.maxDistance = lim.max;
    controls.minPolarAngle = lim.minPolar; controls.maxPolarAngle = lim.maxPolar;
    controls.enablePan = !follow;
    ctx.zoomLimits = { min: lim.min, max: lim.max };
    ctx.zoomToTarget = follow;
  }

  function setMode(m, { quiet = false } = {}) {
    if (m === mode && m !== 'follow') return;
    const prev = mode;
    if (prev === 'shop') ctx.shop?.close(false);
    mode = m;
    const walking = m === 'follow' || m === 'high';
    bar.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
    views.classList.toggle('hidden-by-player', walking || m === 'shop');
    document.body.classList.toggle('walking', walking);
    body.traverse((o) => o.layers.set(m === 'use' ? 2 : 0));   // đứng dùng trạm: camera gần thì ẩn (không che khay)
    hint.textContent = walking ? 'WASD đi · Shift chạy · Kéo chuột xoay · Cuộn để xa / gần · E tương tác'
      : 'Kéo chuột để xoay · Cuộn để zoom · Chuột phải để dịch · F hoặc Esc: về nhân vật';
    if (walking) {
      if (prev === 'use') ctx.cutaway?.set(false);
      const lim = m === 'high' ? HIGH : FOLLOW;
      headWorld();
      // giữ hướng nhìn hiện tại, đổi khoảng cách / độ cao
      const off = new THREE.Vector3().subVectors(camera.position, controls.target);
      const sph = new THREE.Spherical().setFromVector3(off.lengthSq() > 1e-6 ? off : new THREE.Vector3(0, 1, 3));
      if (prev !== 'follow' && prev !== 'high') sph.theta = P.yaw + Math.PI;   // từ chế độ khác: đứng sau lưng
      sph.radius = m === 'high' ? 22 : 3.6;
      sph.phi = m === 'high' ? 0.7 : 1.22;
      const pos = new THREE.Vector3().setFromSpherical(sph).add(head);
      applyLimits(FREE, false);
      transition = performance.now() + 900;
      flyTo(camera, controls, { pos: pos.toArray(), target: head.toArray() }, 0.85);
      setTimeout(() => { if (mode === m) applyLimits(lim, true); }, 880);
    } else {
      applyLimits(FREE, false);
      transition = 0;
    }
    if (!quiet && m === 'free' && prev !== 'free') toast('Xem tự do: dùng các nút góc nhìn bên dưới. Bấm F để về nhân vật', 'info');
  }

  // ---------------------------------------------------------------- tương tác (E)
  function stationNear() {
    for (const [i, s] of st.slots.entries()) {
      if (Math.abs(P.x - s.x) < 1.35 && P.z > D.FRONT - 0.05 && P.z < D.FRONT + 1.9) return i;
    }
    return -1;
  }
  function interaction() {
    const si = stationNear();
    if (si >= 0) {
      const s = st.slots[si];
      return { label: si === st.active ? `Dùng trạm ${s.info.code}` : `Sang dùng trạm ${s.info.code}`, run: () => useStation(si) };
    }
    const lit = ctx.litter?.nearest(P.x, P.z, 1.1);
    if (lit) return { label: `Nhặt ${lit.name}`, run: () => ctx.litter.pick(lit) };
    const shop = ctx.shop?.interactionAt?.(P.x, P.z);
    if (shop) return shop;
    return null;
  }
  async function useStation(i) {
    if (i !== st.active) {
      const ok = await st.select(i, { fly: false });
      if (!ok) return;
    }
    const s = st.slots[st.active];
    P.x = s.x - 0.42; P.z = D.FRONT + 0.62; P.yaw = Math.PI - 0.5;     // đứng trước lỗ từ thiện, mặt hướng màn hình
    setMode('use');
    flyTo(camera, controls, 'panel', 0.9);
    toast('Đang dùng trạm – bấm màn hình, cửa, khay như bình thường. Esc hoặc WASD để đi tiếp', 'info');
  }
  /** Đứng trước trạm đang dùng (panel Dev giả lập phá phách) */
  function standAtStation() {
    const s = st.slots[st.active];
    P.x = s.x - 0.42; P.z = D.FRONT + 0.62; P.yaw = Math.PI - 0.5;
  }

  // ---------------------------------------------------------------- bàn phím
  const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"]');
  window.addEventListener('keydown', (e) => {
    if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
      keys.add(k);
      if (mode === 'use' || mode === 'shop' || mode === 'free') setMode('follow');
      if (k.startsWith('arrow')) e.preventDefault();
    } else if (k === 'shift') keys.add('shift');
    else if (k === 'e' && !e.repeat) {
      if (mode === 'follow' || mode === 'high') interaction()?.run();
    } else if (k === 'v' && !e.repeat) setMode(mode === 'follow' ? 'high' : 'follow');
    else if (k === 'f' && !e.repeat) setMode(mode === 'free' ? 'follow' : 'free');
    else if (k === 'escape' && (mode === 'use' || mode === 'shop' || mode === 'free')) setMode('follow');
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  // ---------------------------------------------------------------- di chuyển + va chạm
  function blocked(x, z) {
    if (x < -58 || x > 58 || z < L.SAND.shoreZ - 4 || z > L.SHOP.z + L.SHOP.d) return true;
    for (const [x1, z1, x2, z2] of colliders) {
      const cx = Math.max(x1, Math.min(x, x2)), cz = Math.max(z1, Math.min(z, z2));
      if ((x - cx) ** 2 + (z - cz) ** 2 < R * R) return true;
    }
    for (const v of ctx.traffic?.vehicles || []) {          // không đi xuyên xe đang đỗ / chạy
      if (Math.abs(x - v.x) < v.half + R && Math.abs(z - v.z) < (v.kind === 'car' ? 0.9 : 0.3) + R) return true;
    }
    return false;
  }
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3();
  const delta = new THREE.Vector3();

  ctx.onFrame.push((dt) => {
    const walking = mode === 'follow' || mode === 'high';
    let moving = false;
    if (walking) {
      fwd.subVectors(controls.target, camera.position).setY(0);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      right.crossVectors(fwd, THREE.Object3D.DEFAULT_UP);
      mv.set(0, 0, 0);
      if (keys.has('w') || keys.has('arrowup')) mv.add(fwd);
      if (keys.has('s') || keys.has('arrowdown')) mv.sub(fwd);
      if (keys.has('d') || keys.has('arrowright')) mv.add(right);
      if (keys.has('a') || keys.has('arrowleft')) mv.sub(right);
      if (mv.lengthSq() > 0) {
        moving = true;
        mv.normalize();
        const sp = keys.has('shift') ? SPEED.run : SPEED.walk;
        P.speed = THREE.MathUtils.lerp(P.speed, sp, 1 - Math.exp(-8 * dt));
        const step = P.speed * dt;
        const nx = P.x + mv.x * step, nz = P.z + mv.z * step;
        if (!blocked(nx, P.z)) P.x = nx;
        if (!blocked(P.x, nz)) P.z = nz;
        // quay mặt theo hướng đi (mượt)
        const want = Math.atan2(mv.x, mv.z);
        let d = want - P.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        P.yaw += d * (1 - Math.exp(-12 * dt));
      }
    }
    if (!moving) P.speed = THREE.MathUtils.lerp(P.speed, 0, 1 - Math.exp(-10 * dt));
    // độ cao: lên / xuống bó vỉa, bậc thang, dốc cát (mượt)
    const gy = groundY(P.x, P.z);
    P.y += (gy - P.y) * (1 - Math.exp(-14 * dt));
    // dáng đi
    const amp = Math.min(1, P.speed / SPEED.walk) * (P.speed > SPEED.walk + 0.5 ? 0.85 : 0.55);
    P.phase += P.speed * dt * (P.speed > SPEED.walk + 0.5 ? 2.6 : 3.4);
    const sw = Math.sin(P.phase) * amp;
    if (!ctx.security?.acting) {
      J.legL.rotation.x = sw; J.legR.rotation.x = -sw;
      J.armL.rotation.x = -sw * 0.8; J.armR.rotation.x = sw * 0.8;
    }
    body.position.set(toWorld(P.x), P.y + Math.abs(Math.cos(P.phase)) * 0.03 * amp, P.z);
    body.rotation.y = P.yaw;

    // camera bám theo (sau lưng / trên cao)
    if (walking && performance.now() > transition) {
      headWorld();
      delta.subVectors(head, controls.target);
      camera.position.add(delta);
      controls.target.copy(head);
      // không cho camera chui xuống đất / vào trong trạm
      const minY = groundY(P.x, P.z) + 0.4;
      if (camera.position.y < minY) camera.position.y = minY;
    }

    // gợi ý E
    const it = walking ? interaction() : null;
    const text = it ? `<kbd>E</kbd> ${it.label}` : '';
    if (prompt.dataset.t !== text) {
      prompt.dataset.t = text;
      prompt.innerHTML = text;
      prompt.classList.toggle('hidden', !text);
    }
    // đi ra xa trạm đang dùng thì thôi "đứng dùng"
  });

  ctx.player = {
    body, P,
    get mode() { return mode; },
    get walking() { return mode === 'follow' || mode === 'high'; },
    get atStation() { return mode === 'use' || mode === 'free'; },
    setMode, standAtStation, toWorld, groundY,
    setHolding(on) { held.visible = !!on; },
    onCityShift() { /* camera + đích quay đã dời cùng khung phố trong stations.select */ },
    /** mở quầy thu ngân: camera nhìn vào quầy, bảng thu ngân hiện ra */
    enterShopMode(cam) {
      setMode('shop');
      flyTo(camera, controls, cam, 0.8);
    },
  };
  // vào trang: điều khiển nhân vật, đứng trên vỉa hè trước trạm
  setMode('follow', { quiet: true });
  return ctx.player;
}
