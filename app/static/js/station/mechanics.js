// Cơ khí tương tác: cửa, khay nạp, ngăn trả rác, nút TÍNH TIỀN, đèn báo.
// Mọi ràng buộc vật lý được mô phỏng ở đây; logic nghiệp vụ nằm ở back-end.
import * as THREE from 'three';
import { D } from './dims.js';
import { DOOR_OPEN_ANGLE } from './door.js';
import { LIMIT_HEIGHT } from './feedDrawer.js';
import { COLORS } from './materials.js';
import { toast } from '../ui/toast.js';

const gsap = () => window.gsap;

const LED = {
  red: new THREE.Color(COLORS.red),
  green: new THREE.Color(0x22c55e),
  amber: new THREE.Color(COLORS.amber),
};

export function setupMechanics(ctx, bridge) {
  const p = ctx.parts;
  const mech = {
    doorOpen: false,
    feedOut: false,
    returnOut: false,
    jammed: false,
    moving: { door: false, feed: false, ret: false },
    /** Chiều cao vật cao nhất trong khay (m) – module rác (G5) sẽ ghi đè hàm này */
    trayContentHeight: () => 0,
    /** Có thể đóng cửa không (các module khác có thể thêm điều kiện) */
  };
  ctx.mech = mech;

  // ---------------------------------------------------------------- gắn nhãn đối tượng tương tác
  const tag = (obj, action, hint) => { obj.userData.action = action; obj.userData.hint = hint; };
  tag(p.door, 'door', () => (mech.doorOpen ? 'Đóng cửa' : 'Mở cửa'));
  tag(p.feedDrawer, 'feed', () => (mech.feedOut ? 'Đẩy khay vào' : 'Kéo khay ra'));
  tag(p.returnDrawer, 'ret', () => (mech.returnOut ? 'Đẩy ngăn trả rác vào' : 'Kéo ngăn trả rác ra'));
  tag(p.payButton, 'pay', () => 'Bấm TÍNH TIỀN');
  const interactive = [p.door, p.feedDrawer, p.returnDrawer, p.payButton];

  const S = () => ctx.serverState || {};
  const locked = () => S().door_locked !== false;

  // ---------------------------------------------------------------- cảm biến
  bridge.syncSensors = () => {
    bridge.sensor('door_closed', !mech.doorOpen && !mech.moving.door);
    bridge.sensor('feed_drawer_in', !mech.feedOut && !mech.moving.feed);
    bridge.sensor('feed_drawer_jammed', mech.jammed);
    bridge.sensor('return_drawer_in', !mech.returnOut && !mech.moving.ret);
  };

  // ---------------------------------------------------------------- cửa
  function shakeDoor() {
    gsap().fromTo(p.door.rotation, { y: 0 }, { y: -0.025, duration: 0.06, yoyo: true, repeat: 3, ease: 'sine.inOut' });
  }

  mech.toggleDoor = function toggleDoor() {
    if (mech.moving.door) return false;
    if (!mech.doorOpen) {
      if (locked()) {
        shakeDoor();
        toast(S().processing ? 'Máy đang xử lý, cửa đang khóa' : 'Cửa đang khóa – hãy chọn tên của bạn trên màn hình', 'warning');
        return false;
      }
      mech.moving.door = true;
      bridge.sensor('door_closed', false);
      gsap().to(p.door.rotation, {
        y: DOOR_OPEN_ANGLE, duration: 0.9, ease: 'power2.out',
        onComplete: () => { mech.moving.door = false; mech.doorOpen = true; },
      });
      mech.doorOpen = true;
      return true;
    }
    if (mech.feedOut || mech.moving.feed) {
      toast('Hãy đẩy khay nạp vào trước khi đóng cửa', 'warning');
      return false;
    }
    mech.moving.door = true;
    gsap().to(p.door.rotation, {
      y: 0, duration: 0.8, ease: 'power2.inOut',
      onComplete: () => { mech.moving.door = false; mech.doorOpen = false; bridge.sensor('door_closed', true); },
    });
    return true;
  };

  // ---------------------------------------------------------------- khay nạp
  const feedZ0 = p.feedDrawer.userData.closedZ;
  mech.toggleFeed = function toggleFeed() {
    if (mech.moving.feed) return false;
    if (!mech.doorOpen || mech.moving.door) {
      toast('Hãy mở cửa trước khi kéo khay', 'warning');
      return false;
    }
    mech.moving.feed = true;
    if (!mech.feedOut) {
      bridge.sensor('feed_drawer_in', false);
      mech.feedOut = true;
      gsap().to(p.feedDrawer.position, {
        z: feedZ0 + D.TRAY.travel, duration: 0.8, ease: 'power2.out',
        onComplete: () => { mech.moving.feed = false; },
      });
      return true;
    }
    // Đẩy vào: kiểm tra rác có vượt thanh gạt không
    const h = mech.trayContentHeight();
    if (h > LIMIT_HEIGHT) {
      const stopAt = feedZ0 + D.TRAY.travel - 0.07; // vật cao vướng thanh gạt sau ~7 cm
      gsap().timeline({ onComplete: () => { mech.moving.feed = false; } })
        .to(p.feedDrawer.position, { z: stopAt, duration: 0.35, ease: 'power2.in' })
        .to(p.feedDrawer.position, { z: stopAt + 0.012, duration: 0.08, ease: 'power1.out' })
        .to(p.feedDrawer.position, { z: stopAt + 0.004, duration: 0.1 })
        .to(p.feedDrawer.position, { z: feedZ0 + D.TRAY.travel, duration: 0.45, ease: 'power2.out', delay: 0.4 });
      mech.jammed = true;
      bridge.sensor('feed_drawer_jammed', true);
      return false;
    }
    if (mech.jammed) { mech.jammed = false; bridge.sensor('feed_drawer_jammed', false); }
    gsap().to(p.feedDrawer.position, {
      z: feedZ0, duration: 0.8, ease: 'power2.inOut',
      onComplete: () => {
        mech.moving.feed = false; mech.feedOut = false;
        bridge.sensor('feed_drawer_in', true);
      },
    });
    return true;
  };

  // ---------------------------------------------------------------- ngăn trả rác
  const retZ0 = p.returnDrawer.userData.closedZ;
  mech.toggleReturn = function toggleReturn() {
    if (mech.moving.ret) return false;
    if (S().processing && !mech.returnOut) {
      toast('Máy đang xử lý, vui lòng chờ', 'warning');
      return false;
    }
    mech.moving.ret = true;
    if (!mech.returnOut) {
      mech.returnOut = true;
      bridge.sensor('return_drawer_in', false);
      gsap().to(p.returnDrawer.position, {
        z: retZ0 + D.RETURN.travel, duration: 0.8, ease: 'power2.out',
        onComplete: () => { mech.moving.ret = false; },
      });
    } else {
      gsap().to(p.returnDrawer.position, {
        z: retZ0, duration: 0.8, ease: 'power2.inOut',
        onComplete: () => { mech.moving.ret = false; mech.returnOut = false; bridge.sensor('return_drawer_in', true); },
      });
    }
    return true;
  };

  // ---------------------------------------------------------------- nút TÍNH TIỀN
  mech.pressPay = function pressPay() {
    gsap().fromTo(p.payCap.position, { z: 0 }, { z: -0.009, duration: 0.09, yoyo: true, repeat: 1, ease: 'power1.inOut' });
    return bridge.pay();
  };

  // ---------------------------------------------------------------- đèn
  const lockMat = p.doorLockLed.material;
  const statusMat = p.statusBar.material;
  const ringMat = p.payRing.material;
  const retMat = p.returnLed.material;
  let statusMode = 'ready';
  let returnBlink = false;

  function setLock(isLocked) {
    lockMat.color.copy(isLocked ? LED.red : LED.green);
    lockMat.emissive.copy(lockMat.color);
  }

  function payReady(s) {
    const sen = s.sensors || {};
    return ['READY', 'RESULT'].includes(s.state) && !s.station?.is_full && !s.maintenance && !(s.pending?.amount > 0 && s.state === 'RESULT')
      && sen.door_closed && sen.feed_drawer_in && !sen.feed_drawer_jammed && sen.return_drawer_in
      && !mech.doorOpen && !mech.feedOut && !mech.returnOut;
  }

  bridge.onState((s) => {
    setLock(s.door_locked !== false);
    statusMode = s.processing ? 'busy' : (s.station?.is_full ? 'full' : 'ready');
  });

  bridge.on('lock_door', ({ locked: l }) => { setLock(l); });
  bridge.on('set_led', ({ name, mode }) => {
    if (name === 'door_lock') setLock(mode === 'locked');
    else if (name === 'status') statusMode = mode;
    else if (name === 'return_drawer') returnBlink = mode === 'blink';
  });

  ctx.onFrame.push((dt, t) => {
    // Thanh trạng thái: xanh = sẵn sàng, vàng nhấp nháy = đang xử lý, đỏ = trạm đầy / lỗi
    const c = statusMode === 'busy' ? LED.amber : statusMode === 'full' ? LED.red : LED.green;
    statusMat.color.copy(c); statusMat.emissive.copy(c);
    statusMat.emissiveIntensity = statusMode === 'busy' ? 0.6 + 0.6 * (0.5 + 0.5 * Math.sin(t * 8)) : 1.1;
    // Viền nút TÍNH TIỀN sáng nhịp thở khi đủ điều kiện
    ringMat.emissiveIntensity = payReady(S()) ? 1.2 + 0.9 * (0.5 + 0.5 * Math.sin(t * 3)) : 0.12;
    // Đèn ngăn trả rác
    retMat.emissiveIntensity = returnBlink ? (Math.sin(t * 9) > 0 ? 2.2 : 0.1) : 0;
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
    const extra = ctx.extraPickables || [];
    const hits = ray.intersectObjects([...interactive, ...extra], true);
    for (const h of hits) {
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
      tip.classList.add('show');
    } else tip.classList.remove('show');
  });
  dom.addEventListener('pointerleave', () => tip.classList.remove('show'));
  dom.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const hit = pick(e);
    if (!hit) return;
    const a = hit.obj.userData.action;
    if (a === 'door') mech.toggleDoor();
    else if (a === 'feed') mech.toggleFeed();
    else if (a === 'ret') mech.toggleReturn();
    else if (a === 'pay') mech.pressPay();
    else if (typeof hit.obj.userData.onClick === 'function') hit.obj.userData.onClick(hit);
    bridge.ui('activity');
  });

  return mech;
}
