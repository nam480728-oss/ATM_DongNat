// Cơ khí tương tác mặt trước: cửa khoang nạp (khóa điện từ + lò xo bung hé), khay ngăn kéo, đèn khóa, đèn trạng thái.
// Mở cửa -> rút khay -> bỏ rác -> đẩy khay -> đóng cửa = cảm biến door_closed -> back-end tự quét.
// Ràng buộc cơ khí: khay chỉ rút được khi cửa mở; cửa chỉ đóng được khi khay đã đẩy vào.
import * as THREE from 'three';
import { DOOR_OPEN_ANGLE } from './door.js';
import { COLORS } from './materials.js';
import { D } from './dims.js';
import { toast } from '../ui/toast.js';

const gsap = () => window.gsap;
const POP_ANGLE = THREE.MathUtils.degToRad(-24);   // cửa bung hé khi có rác lạ

const LED = {
  red: new THREE.Color(COLORS.red),
  green: new THREE.Color(0x22c55e),
  amber: new THREE.Color(COLORS.amber),
};

export function setupMechanics(ctx, bridge) {
  const p = ctx.parts;
  const mech = { doorOpen: false, drawerOut: false, moving: { door: false, drawer: false } };
  const drawer = ctx.interior.drawer;
  ctx.mech = mech;

  const tag = (obj, action, hint) => { obj.userData.action = action; obj.userData.hint = hint; };
  tag(p.door, 'door', () => (mech.doorOpen ? (mech.drawerOut ? 'Đẩy khay vào trước khi đóng cửa' : 'Đóng cửa (máy sẽ tự quét)') : 'Mở cửa khoang nạp'));
  tag(drawer, 'drawer', () => (mech.drawerOut ? 'Đẩy khay vào' : 'Rút khay ra để bỏ rác'));
  const interactive = [p.door, drawer];

  const S = () => ctx.serverState || {};
  const locked = () => S().door_locked !== false;

  bridge.syncSensors = () => { bridge.sensor('door_closed', !mech.doorOpen && !mech.moving.door); };

  // ---------------------------------------------------------------- cửa
  function shakeDoor() {
    gsap().fromTo(p.door.rotation, { y: 0 }, { y: -0.02, duration: 0.06, yoyo: true, repeat: 3, ease: 'sine.inOut' });
  }
  function swing(angle, duration, ease, done) {
    mech.moving.door = true;
    gsap().to(p.door.rotation, { y: angle, duration, ease, overwrite: true, onComplete: () => { mech.moving.door = false; done?.(); } });
  }

  mech.toggleDoor = function toggleDoor() {
    if (mech.moving.door) return false;
    const ajar = mech.doorOpen && p.door.rotation.y > DOOR_OPEN_ANGLE / 2;
    if (!mech.doorOpen || ajar) {
      if (!mech.doorOpen && locked()) {
        shakeDoor();
        const s = S();
        if (s.processing || s.intake_busy) ctx.security?.tamperAttempt();   // cố mở cửa khi máy đang chạy = cạy
        toast(s.processing ? 'Máy đang quét, cửa đang khóa'
          : s.intake_busy ? 'Máy đang phân loại rác trên khay, chờ chút'
            : 'Cửa đang khóa – hãy nhập số điện thoại trên màn hình', 'warning');
        return false;
      }
      if (!mech.doorOpen) bridge.sensor('door_closed', false);
      mech.doorOpen = true;
      swing(DOOR_OPEN_ANGLE, ajar ? 0.6 : 0.9, 'power2.out');
      return true;
    }
    if (mech.drawerOut || mech.moving.drawer) {
      toast('Hãy đẩy khay vào trước khi đóng cửa', 'warning');
      return false;
    }
    swing(0, 0.8, 'power2.inOut', () => { mech.doorOpen = false; bridge.sensor('door_closed', true); });
    return true;
  };

  // ---------------------------------------------------------------- khay ngăn kéo
  mech.toggleDrawer = function toggleDrawer() {
    if (mech.moving.drawer) return false;
    if (!mech.doorOpen || mech.moving.door || p.door.rotation.y > -0.9) {
      toast(mech.doorOpen ? 'Mở cửa rộng ra rồi mới rút khay được' : 'Hãy mở cửa trước khi rút khay', 'warning');
      return false;
    }
    if (mech.gateOpen) { ctx.security?.tamperAttempt(); toast('Máy đang phân loại trên khay, chờ chút', 'warning'); return false; }   // khay luôn kín 4 phía khi ra ngoài
    mech.moving.drawer = true;
    ctx.trash?.freezeTray();
    const out = !mech.drawerOut;
    window.gsap.to(drawer.position, {
      z: out ? D.TRAY.travel : 0, duration: 0.8, ease: out ? 'power2.out' : 'power2.inOut',
      onComplete: () => { mech.moving.drawer = false; mech.drawerOut = out; ctx.trash?.releaseTray(); ctx.trash?.notify(); },
    });
    return true;
  };

  // Lò xo bung hé cửa (back-end gọi khi có rác lạ – khóa đã nhả)
  bridge.on('pop_door', async () => {
    setLock(false);
    if (mech.doorOpen) return {};
    mech.doorOpen = true;
    bridge.sensor('door_closed', false);
    await new Promise((res) => swing(POP_ANGLE, 0.35, 'back.out(2.5)', res));
    return {};
  });

  // ---------------------------------------------------------------- đèn
  const lockMat = p.doorLockLed.material;
  const statusMat = p.statusBar.material;
  let statusMode = 'ready';

  function setLock(isLocked) {
    lockMat.color.copy(isLocked ? LED.red : LED.green);
    lockMat.emissive.copy(lockMat.color);
  }

  bridge.onState((s) => {
    setLock(s.door_locked !== false);
    statusMode = s.alarm ? 'alarm' : (s.processing || s.sorter?.running) ? 'busy' : (s.station?.is_full ? 'full' : 'ready');
  });
  bridge.on('lock_door', ({ locked: l }) => { setLock(l); });
  bridge.on('set_led', ({ name, mode }) => {
    if (name === 'door_lock') setLock(mode === 'locked');
    else if (name === 'status' && statusMode !== 'alarm') statusMode = mode;
  });

  ctx.onFrame.push((dt, t) => {
    // xanh = sẵn sàng, vàng nhấp nháy = đang xử lý / phân loại, đỏ = trạm đầy, đỏ chớp nhanh = cảnh báo rác lạ
    const c = statusMode === 'busy' ? LED.amber : (statusMode === 'full' || statusMode === 'alarm') ? LED.red : LED.green;
    statusMat.color.copy(c); statusMat.emissive.copy(c);
    statusMat.emissiveIntensity = statusMode === 'busy' ? 0.6 + 0.6 * (0.5 + 0.5 * Math.sin(t * 8))
      : statusMode === 'alarm' ? (Math.sin(t * 14) > 0 ? 2.4 : 0.2) : 1.1;
  });

  // ---------------------------------------------------------------- chuột: hover + click (phân biệt với kéo xoay)
  const dom = ctx.renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tip = document.createElement('div');
  tip.className = 'hover-tip';
  document.body.appendChild(tip);

  function pick(ev) {
    const r = dom.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, ctx.camera);
    const hits = ray.intersectObjects([...interactive, ...(ctx.extraPickables || [])], true);
    for (const h of hits) {
      // three.js vẫn bắn trúng vật đang ẩn (vd bản sao tĩnh của chính trạm đang dùng) -> bỏ qua
      let shown = true;
      for (let q = h.object; q; q = q.parent) if (!q.visible) { shown = false; break; }
      if (!shown) continue;
      let o = h.object;
      while (o && !o.userData.action) o = o.parent;
      if (o) return { obj: o, point: h.point };
    }
    return null;
  }
  ctx.pick = pick;

  let down = null;
  dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  dom.addEventListener('pointermove', (e) => {
    const hit = pick(e);
    dom.style.cursor = hit ? 'pointer' : '';
    if (hit) {
      const hint = hit.obj.userData.hint;
      tip.textContent = typeof hint === 'function' ? hint() : hint;
      tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 14}px)`;
      tip.classList.toggle('show', !!tip.textContent);
    } else tip.classList.remove('show');
  });
  dom.addEventListener('pointerleave', () => tip.classList.remove('show'));
  dom.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const hit = pick(e);
    if (!hit) return;
    tip.classList.remove('show');            // vật vừa bấm có thể biến mất (phiếu voucher...) -> ẩn gợi ý
    if (hit.obj.userData.action === 'door') mech.toggleDoor();
    else if (hit.obj.userData.action === 'drawer') mech.toggleDrawer();
    else if (typeof hit.obj.userData.onClick === 'function') hit.obj.userData.onClick(hit);
    bridge.ui('activity');
  });

  return mech;
}
