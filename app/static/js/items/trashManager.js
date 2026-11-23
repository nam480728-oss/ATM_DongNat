// Quản lý rác trong mô phỏng (vật lý Rapier) + thực thi lệnh cơ cấu của back-end:
//   tay người dùng -> khay ngăn kéo kín (rung, camera khay quét tính tiền + vẽ khung) -> cửa lật vách trái
//   -> tay gắp lùa vào phễu nón -> rơi xuống băng chuyền (camera băng chuyền canh vật mới; kẹt -> server mở dần phễu)
//   -> thanh gạt đẩy thẳng vào thùng chai / lon sát mép băng, tấm gạt chéo cuối băng -> thùng khác.
//   Thêm: 2 thùng rác mini 2 bên hông trạm.
import * as THREE from 'three';
import { createItem, ITEM_TYPES } from './itemFactory.js';
import { D } from '../station/dims.js';
import { CAMS, SCAN_LAYER, setBinLevels } from '../station/interior.js';
import { setPublicLevel } from '../station/publicBins.js';
import { toast } from '../ui/toast.js';

const gsap = () => window.gsap;
const ts = () => window.gsap?.globalTimeline.timeScale() || 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms / ts()));
const rand = (a, b) => a + Math.random() * (b - a);
const tw = (target, vars) => gsap().to(target, vars).then();
const TR = D.TRAY, F = D.FUNNEL, B = D.BELT, BN = D.BINS, G = D.GANTRY;
const SLIDE_END_X = -0.42;                          // cuối máng trượt dưới cổ phễu (interior.js)
const _v = new THREE.Vector3();

function disposeItem(item) {
  item.parent?.remove(item);
  item.traverse((o) => {
    if (o.isMesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => { if (!mm.map?.userData?.shared) mm.map?.dispose(); mm.dispose(); });
    }
  });
}

/** Chuyển vật sang cha mới, giữ nguyên vị trí/hướng trong không gian */
function reparent(item, parent) {
  const wp = item.getWorldPosition(new THREE.Vector3());
  const wq = item.getWorldQuaternion(new THREE.Quaternion());
  parent.add(item);
  parent.updateMatrixWorld(true);
  item.position.copy(parent.worldToLocal(wp));
  item.quaternion.copy(parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(wq));
}

const iou = (a, b) => {
  const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = ix * iy, ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
};
async function until(fn, timeout) {
  const t0 = performance.now();
  while (!fn()) {
    if ((performance.now() - t0) * ts() > timeout) return false;
    await new Promise((r) => setTimeout(r, 16));
  }
  return true;
}

export function setupTrash(ctx, bridge, interior) {
  const { parts } = ctx;
  const P = ctx.physics;
  const ig = interior.group, drawer = interior.drawer, tray = interior.tray;
  // falling = vật đã vào phễu, camera băng chuyền chưa thấy; belt = vật đã tới camera, chờ thanh gạt
  const T = { hand: [], tray: [], falling: [], belt: [], forceOverlap: false, jamMode: 'auto', listeners: [],
    binned: { bottle: [], can: [], other: [] } };       // vật đã vào thùng bên trong (nằm lại tới khi đổ thùng)
  ctx.trash = T;
  const changed = () => T.listeners.forEach((fn) => fn(T));
  T.notify = changed;
  T.target = 'intake';               // bảng "Rác trong tay": khay | lỗ từ thiện | thùng rác mini
  T.setTarget = (t) => { T.target = t; changed(); };
  const pickables = (ctx.extraPickables ||= []);
  const setPickable = (item, on) => {
    const i = pickables.indexOf(item);
    if (on && i < 0) pickables.push(item);
    if (!on && i >= 0) pickables.splice(i, 1);
  };
  const removeFrom = (arr, item) => { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); };
  const S_ = () => ctx.serverState || {};
  const worldBox = (it) => new THREE.Box3().setFromObject(it);

  // ============================================================ tay <-> khay ngăn kéo
  T.drop = (itemOrType) => {
    if (T.target === 'slot') return T.insertSlot(itemOrType);
    if (T.target === 'public') return T.toPublic(itemOrType);
    return T.addToTray(itemOrType);
  };

  T.addToTray = function addToTray(itemOrType) {
    const m = ctx.mech;
    if (!m.drawerOut || m.moving.drawer) {
      toast(!S_().user ? 'Hãy nhập số điện thoại trên màn hình, mở cửa rồi rút khay ra' : !m.doorOpen ? 'Hãy mở cửa rồi rút khay ra' : 'Hãy rút khay ra trước khi bỏ rác', 'warning');
      return false;
    }
    if (T.tray.length >= 15) { toast('Khay đã đầy (tối đa 15 vật mỗi mẻ)', 'warning'); return false; }
    const item = typeof itemOrType === 'string' ? createItem(itemOrType) : itemOrType;
    removeFrom(T.hand, item);
    const inner = interior.inner, s = item.userData.size;
    ig.add(item);
    item.rotation.set(rand(-0.12, 0.12), rand(0, Math.PI * 2), rand(-0.12, 0.12));
    const r = Math.max(s.x, s.z) / 2;
    // người dùng thả vào chỗ trống; khay chật thì thả lên trên đống rác (không bao giờ sinh vật lồng vào vật khác)
    const boxes = T.tray.map((it) => worldBox(it));
    let best = null;
    for (let k = 0; k < 24; k++) {
      const local = new THREE.Vector3(rand(inner.x1 + r * 0.6, inner.x2 - r * 0.6), 0, rand(inner.z1 + r * 0.6, inner.z2 - r * 0.6));
      const w = drawer.localToWorld(local.clone());
      const foot = new THREE.Box3(new THREE.Vector3(w.x - r, -9, w.z - r), new THREE.Vector3(w.x + r, 9, w.z + r));
      const top = boxes.filter((b) => b.intersectsBox(foot)).reduce((m, b) => Math.max(m, b.max.y), drawer.localToWorld(new THREE.Vector3()).y);
      if (!best || top < best.top - 1e-4) best = { w, top };
      if (top <= TR.y + 1e-3) break;
    }
    item.position.copy(ig.worldToLocal(new THREE.Vector3(best.w.x, best.top + r + 0.05, best.w.z)));
    P.addItem(item, { linvel: { x: 0, y: -0.2, z: 0 }, angvel: { x: rand(-1.5, 1.5), y: rand(-1, 1), z: rand(-1.5, 1.5) } });
    T.tray.push(item);
    item.userData.onClick = () => T.takeFromTray(item);
    item.userData.hint = () => `Lấy ra: ${ITEM_TYPES[item.userData.type].name}`;
    setPickable(item, true);
    ctx.laser?.attach(item);
    changed();
    return true;
  };

  T.takeFromTray = function takeFromTray(item) {
    const m = ctx.mech;
    if (!m.drawerOut || m.moving.drawer) { toast('Hãy rút khay ra để lấy rác', 'warning'); return; }
    removeFrom(T.tray, item);
    P.remove(item);
    ig.remove(item);
    item.rotation.set(0, 0, 0);
    setPickable(item, false);
    T.hand.push(item);
    changed();
  };

  /** Lấy hết vật không phải chai/lon ra khỏi khay */
  T.takeInvalidFromTray = function takeInvalid() {
    const bad = T.tray.filter((it) => !ITEM_TYPES[it.userData.type].valid);
    if (!bad.length) { toast('Không còn vật lạ trên khay', 'info'); return 0; }
    if (!ctx.mech.drawerOut) { toast('Hãy rút khay ra để lấy vật lạ', 'warning'); return 0; }
    bad.forEach((it) => T.takeFromTray(it));
    return bad.length;
  };

  // Ngăn kéo trượt: vật trên khay đi cùng khay (tạm "đóng băng" để không trượt khỏi khay)
  T.freezeTray = () => T.tray.forEach((it) => { P.setKinematic(it, true); reparent(it, drawer); });
  T.releaseTray = () => {
    const items = [...T.tray];
    items.forEach((it) => reparent(it, ig));
    P.afterCatchUp(() => items.forEach((it) => P.setKinematic(it, false)));   // đợi mặt khay (vật lý) tới chỗ mới
  };

  // ============================================================ thùng rác mini 2 bên
  const pubBins = parts.publicBins;
  T.toPublic = function toPublic(itemOrType, side) {
    const s = S_().public_bins;
    if (!side) side = s && s.left >= s.capacity ? 'right' : 'left';
    const item = typeof itemOrType === 'string' ? createItem(itemOrType) : itemOrType;
    removeFrom(T.hand, item);
    changed();
    const bin = pubBins[side];
    const mouth = bin.mouth.getWorldPosition(new THREE.Vector3());
    ig.add(item);
    // tay người đưa vật từ bên hông vào miệng thùng (đẩy nắp lật vào trong), vật rơi xuống đáy hộc
    item.position.copy(ig.worldToLocal(mouth.clone().add(new THREE.Vector3(bin.out * 0.35, 0.12, 0.12))));
    item.rotation.set(0, Math.PI / 2, 0.2);
    item.userData.onClick = null;
    const door = ig.worldToLocal(mouth.clone().add(new THREE.Vector3(-bin.out * 0.06, 0, 0)));
    const bottom = ig.worldToLocal(mouth.clone().add(new THREE.Vector3(-bin.out * 0.14, -0.3, 0)));
    gsap().timeline()
      .to(item.position, { x: door.x, y: door.y, z: door.z, duration: 0.45, ease: 'power1.out' }, 0)
      .to(bin.flap.rotation, { z: bin.flap.userData.open, duration: 0.18 }, 0.25)
      .to(item.position, { x: bottom.x, z: bottom.z, duration: 0.4, ease: 'power1.out' }, 0.45)
      .to(item.position, { y: bottom.y, duration: 0.4, ease: 'power2.in' }, 0.45)
      .to(item.rotation, { z: 1.4, duration: 0.4 }, 0.45)
      .to(bin.flap.rotation, { z: 0, duration: 0.35, ease: 'bounce.out' }, 0.75)
      .then(() => {
        disposeItem(item);
        bridge.socket.emit('public_bin', { side }, (res) => { if (!res?.ok) toast('Thùng rác này đã đầy', 'warning'); });
      });
    return true;
  };
  for (const side of ['left', 'right']) {
    const b = pubBins[side].group;
    b.userData.hint = () => {
      const p = S_().public_bins;
      const pct = p ? Math.round((p[side] / p.capacity) * 100) : 0;
      return T.hand.length ? `Bỏ vào thùng rác mini (${pct}% đầy): ${ITEM_TYPES[T.hand[0].userData.type].name}`
        : `Thùng rác mini – ${pct}% đầy (chọn rác ở bảng bên trái)`;
    };
    b.userData.onClick = () => {
      if (T.hand.length) T.toPublic(T.hand[0], side);
      else { T.setTarget('public'); toast('Chọn rác ở bảng bên trái để bỏ vào thùng rác mini', 'info'); }
    };
    pickables.push(b);
  }
  T.discardHand = function discardHand() { [...T.hand].forEach((it, i) => setTimeout(() => T.toPublic(it), i * 160)); };

  // Kéo rác từ bảng bên trái thả vào canvas
  const dom = ctx.renderer.domElement;
  dom.addEventListener('dragover', (e) => e.preventDefault());
  dom.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/atm-item');
    const handId = e.dataTransfer.getData('text/atm-hand');
    const hit = ctx.pick?.(e);
    const a = hit?.obj.userData.action;
    const put = a === 'slot' ? T.insertSlot : a === 'public' ? (x) => T.toPublic(x, hit.obj.userData.side) : T.addToTray;
    if (type) put(type);
    else if (handId) { const it = T.hand.find((h) => String(h.userData.id) === handId); if (it) put(it); }
  });

  // ============================================================ chồng nhau? (từ vị trí vật lý thật)
  const deckY = TR.y;
  function markOverlaps(list = T.tray) {
    // "chồng nhau" = vật nằm đè lên vật khác (đáy cao hơn mặt khay) – camera nhìn từ trên không tách được 2 vật.
    // Hai vật nằm sát cạnh nhau vẫn quét được nên không tính.
    let any = false;
    for (const it of list) {
      const b = worldBox(it);
      const s = it.userData.size;
      const restH = Math.min(s.y, s.z);                 // nằm ngang: đáy ~ mặt khay
      it.userData.overlapped = b.min.y > deckY + 0.015 && (b.max.y - b.min.y) < restH + Math.max(s.x, s.y, s.z) * 0.6;
      any ||= it.userData.overlapped;
    }
    return any;
  }

  // ============================================================ rung khay: lắc khay + hất các vật chồng nhau tách ra
  bridge.on('tray_vibrate', async ({ seconds = 2 }) => {
    const dur = Math.max(1.2, seconds);
    const P0 = tray.position.clone(), R0 = tray.rotation.clone();
    const TAU = Math.PI * 2, prog = { t: 0 };
    let lastKick = 0;
    await tw(prog, {
      t: dur, duration: dur, ease: 'none',
      onUpdate: () => {
        const t = prog.t, env = Math.min(1, t / 0.2) * Math.min(1, (dur - t) / 0.3);
        tray.position.set(P0.x + 0.006 * env * Math.sin(TAU * 18 * t), P0.y + 0.003 * env * Math.sin(TAU * 25 * t + 1.3),
          P0.z + 0.004 * env * Math.sin(TAU * 13 * t + 0.7));
        tray.rotation.z = R0.z + 0.01 * env * Math.sin(TAU * 11 * t);
        if (t - lastKick < 0.1) return;
        lastKick = t;
        // mỗi nhịp rung: chỉ vật đang chồng / chạm nhau bị hất nhẹ ra xa nhau (đổi vận tốc vài cm/s)
        const boxes = T.tray.map((it) => worldBox(it));
        T.tray.forEach((it, i) => {
          const body = P.body(it);
          if (!body) return;
          const a = boxes[i], ca = a.getCenter(new THREE.Vector3());
          const dir = new THREE.Vector3();
          boxes.forEach((b, j) => {
            if (j === i || !a.intersectsBox(b.clone().expandByScalar(0.01))) return;
            const d = ca.clone().sub(b.getCenter(new THREE.Vector3())).setY(0);
            if (d.lengthSq() < 1e-6) d.set(rand(-1, 1), 0, rand(-1, 1));
            dir.add(d.normalize());
          });
          const stacked = a.min.y > deckY + 0.02;
          if (!dir.lengthSq() && !stacked) return;
          // hướng về giữa khay nhiều hơn nếu đang sát mép
          const toC = new THREE.Vector3(TR.x - ca.x, 0, (TR.z1 + TR.z2) / 2 - ca.z);
          if (toC.length() > 0.18) dir.addScaledVector(toC.normalize(), 0.6);
          if (dir.lengthSq()) dir.normalize();
          const mass = body.mass();
          const dv = { x: dir.x * 0.07 * env, y: (stacked ? 0.22 : 0.05) * env, z: dir.z * 0.07 * env };
          body.applyImpulse({ x: dv.x * mass, y: dv.y * mass, z: dv.z * mass }, true);
          const v = body.linvel(), hs = Math.hypot(v.x, v.z);
          if (hs > 0.2) body.setLinvel({ x: v.x * 0.2 / hs, y: v.y, z: v.z * 0.2 / hs }, true);
        });
      },
    });
    tray.position.copy(P0); tray.rotation.copy(R0);
    await until(() => T.tray.every((it) => P.speed(it) < 0.03), 1500);
    markOverlaps();
    if (T.forceOverlap && T.tray.length >= 2) T.tray[0].userData.overlapped = T.tray[1].userData.overlapped = true;   // Dev
  });

  // ============================================================ camera chụp ảnh
  const renderer = ctx.renderer;
  function makeRig(cfg) {
    const cam = new THREE.PerspectiveCamera(cfg.fov, cfg.w / cfg.h, 0.06, 3);
    cam.position.set(...cfg.pos);
    cam.up.set(...cfg.up);
    cam.lookAt(...cfg.target);
    cam.layers.enable(SCAN_LAYER);
    const rt = new THREE.WebGLRenderTarget(cfg.w, cfg.h, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    const pixels = new Uint8Array(cfg.w * cfg.h * 4);
    const canvas = document.createElement('canvas');
    canvas.width = cfg.w; canvas.height = cfg.h;
    const c2d = canvas.getContext('2d');
    function projectBox(item) {
      const box = worldBox(item);
      const xs = [], ys = [];
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const v = new THREE.Vector3(x, y, z).project(cam);
        xs.push((v.x + 1) / 2 * cfg.w); ys.push((1 - v.y) / 2 * cfg.h);
      }
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
    function shoot(items) {
      const render = () => {
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(rt);
        renderer.render(ctx.scene, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, cfg.w, cfg.h, pixels);
        renderer.setRenderTarget(prev);
      };
      ctx.station.root.updateMatrixWorld(true);
      if (ctx.cutaway?.withOpaque) ctx.cutaway.withOpaque(render); else render();
      const img = c2d.createImageData(cfg.w, cfg.h);
      const row = cfg.w * 4;
      for (let y = 0; y < cfg.h; y++) img.data.set(pixels.subarray((cfg.h - 1 - y) * row, (cfg.h - y) * row), y * row);
      c2d.putImageData(img, 0, 0);
      const hints = items.map((it) => ({ label: it.userData.type, bbox: projectBox(it), overlapped: !!it.userData.overlapped }));
      return { image: canvas.toDataURL('image/jpeg', 0.9), hints, width: cfg.w, height: cfg.h };
    }
    return { cam, cfg, projectBox, shoot };
  }
  const rigs = { tray: makeRig(CAMS.tray), belt: makeRig(CAMS.belt) };
  ctx.scanRigs = rigs;
  ctx.lastCapture = {};
  const beltHead = () => (T.belt.length ? [T.belt[T.belt.length - 1]] : []);       // vật vừa tới dưới camera
  const FLASH = { ring: 2.6, light: 2.2 };

  // ============================================================ tay gắp: lùa vật vào phễu nón
  const grip = interior.grip;
  const RAISED = G.y - 0.2, HOVER = TR.y + 0.16;          // RAISED: đáy ngón cao hơn vách khay -> ra/vào khay an toàn
  const inTray = (x) => Math.abs(x - TR.x) < TR.w / 2 - 0.02;
  /** Tới (x, z) trong khay: đang ở ngoài khay (chỗ đỗ) thì nâng cao qua vách trước */
  async function enterTray(x, z) {
    if (!inTray(grip.bridge.position.x) && grip.bottom < RAISED - 0.005) await gripTo('bottom', RAISED, 0.25);
    await moveGantry(x, z);
  }
  async function moveGantry(x, z, speed = 1.0) {
    const d = Math.hypot(grip.bridge.position.x - x, grip.head.position.z - z);
    const duration = Math.max(0.2, d / speed);
    await Promise.all([
      tw(grip.bridge.position, { x, duration, ease: 'power2.inOut' }),
      tw(grip.head.position, { z, duration, ease: 'power2.inOut' }),
    ]);
  }
  async function gripTo(prop, value, duration = 0.3) {
    const s = { v: prop === 'bottom' ? grip.bottom : grip.spread };
    await tw(s, { v: value, duration, ease: 'power2.inOut', onUpdate: () => (prop === 'bottom' ? grip.setBottom(s.v) : grip.setSpread(s.v)) });
  }

  bridge.on('capture', async ({ camera = 'tray', quick = false } = {}) => {
    const rig = rigs[camera], hw = interior.rigs[camera];
    const ring = hw.ring.material, light = hw.light, rec = hw.rec.material;
    const lit = { ring: 0, light: 0 };
    const apply = () => { ring.emissiveIntensity = lit.ring; light.intensity = lit.light; };
    if (camera === 'tray') {
      if (Math.abs(grip.bridge.position.x - G.park) > 0.01) await park();      // tay gắp tránh khỏi khung hình
      markOverlaps();
    }
    if (quick) {
      lit.ring = FLASH.ring; lit.light = FLASH.light; apply();
      const data = rig.shoot([]);
      lit.ring = 0; lit.light = 0; apply();
      return { image: data.image };
    }
    rec.emissiveIntensity = 2.5;
    if (camera === 'tray' && ctx.laser && T.tray.length) {
      T.tray.forEach((it) => ctx.laser.attach(it));
      await tw(lit, { ring: 0.25, light: 0.3, duration: 0.15, onUpdate: apply });
      await ctx.laser.sweep();
    }
    await tw(lit, { ring: 1.6, light: 2.6, duration: 0.2, ease: 'power1.out', onUpdate: apply });
    lit.ring = FLASH.ring; lit.light = FLASH.light; apply();
    const data = rig.shoot(camera === 'tray' ? T.tray : beltHead());
    await sleep(80);
    await tw(lit, { ring: 0, light: 0, duration: 0.25, ease: 'power1.in', onUpdate: apply });
    rec.emissiveIntensity = 0;
    ctx.lastCapture[camera] = data;
    return { image: data.image, hints: data.hints };
  });

  async function park() {
    await gripTo('bottom', RAISED, 0.25);
    await moveGantry(G.park, (TR.z1 + TR.z2) / 2, 1.2);
  }

  async function pushItem(item) {
    removeFrom(T.tray, item);
    setPickable(item, false);
    const box = worldBox(item), c = box.getCenter(new THREE.Vector3());
    const span = box.max.z - box.min.z;
    // 1. tới trên vật, mở 2 ngón rộng hơn vật
    await enterTray(c.x, c.z);
    await Promise.all([gripTo('bottom', HOVER, 0.2), gripTo('spread', span + 0.07, 0.2)]);
    // 2. hạ xuống ăn khớp khung vật, kẹp lại -> vật theo tay gắp
    await gripTo('bottom', TR.y + 0.006, 0.25);
    await gripTo('spread', span + 0.008, 0.15);
    P.setKinematic(item, true);
    const hubW = () => grip.hub.getWorldPosition(new THREE.Vector3());
    const off = item.getWorldPosition(new THREE.Vector3()).sub(hubW());
    const follow = () => { item.position.copy(ig.worldToLocal(hubW().add(off))); };
    // 3. nhấc nhẹ, lùa qua cửa lật (đã thõng xuống) tới giữa miệng phễu – phễu giữ nguyên cổ hẹp
    const long = item.userData.size.x > 0.11;
    const s = { y: grip.bottom };
    await tw(s, { y: TR.y + 0.1, duration: 0.2, onUpdate: () => { grip.setBottom(s.y); follow(); } });
    const dur = Math.max(0.35, Math.hypot(grip.bridge.position.x - F.x, grip.head.position.z - F.z) / 0.7);
    await Promise.all([
      tw(grip.bridge.position, { x: F.x + 0.01, duration: dur, ease: 'power1.inOut', onUpdate: follow }),
      tw(grip.head.position, { z: F.z, duration: dur, ease: 'power1.inOut', onUpdate: follow }),
    ]);
    // 4. mở ngón -> vật rơi tự do vào phễu nón, lăn/lật theo thân nón xuống băng chuyền
    await gripTo('spread', span + 0.08, 0.1);
    P.setKinematic(item, false);
    // ngón nhả một đầu trước -> vật chúc đầu xuống (chai dài dễ lật đứng mà lọt cổ phễu)
    const ax = new THREE.Vector3(1, 0, 0).applyQuaternion(item.getWorldQuaternion(new THREE.Quaternion()));
    const spin = new THREE.Vector3(0, 1, 0).cross(ax).normalize().multiplyScalar(long ? 5 : 2);
    P.body(item)?.setLinvel({ x: rand(-0.03, 0.03), y: -0.4, z: rand(-0.03, 0.03) }, true);
    P.body(item)?.setAngvel({ x: spin.x, y: 0, z: spin.z }, true);
    intoFunnel(item, { fromTray: true });
    await gripTo('bottom', HOVER, 0.25);
    changed();
  }

  // ============================================================ phễu (server điều khiển: mở dần khi kẹt, rung, gỡ kẹt)
  const bodyY = (it) => P.body(it)?.translation().y ?? it.getWorldPosition(_v).y;
  const inFunnel = (it) => P.has(it) && bodyY(it) > F.neck - 0.05;
  // Mô phỏng: rác thả vào phễu LUÔN lọt xuống băng; riêng mỗi mẻ trên khay cố ý cho 1–2 vật "kẹt" để thấy
  // cơ chế thật: camera băng chuyền 10 s không thấy vật -> server mở dần phễu -> vật lọt ở một nấc mở.
  // T.jamMode: 'auto' (1–2 vật kẹt nhẹ mỗi mẻ) | 'off' (không kẹt) | 'hard' (1–2 vật kẹt cứng, phải bấm Gỡ kẹt)
  const plan = { picks: new Set(), count: 0, active: false };
  function planJams() {
    const n = T.tray.length;
    plan.count = 0;
    plan.picks = new Set();
    if (T.jamMode === 'off' || !n) return;
    const k = Math.min(n, n <= 2 ? 1 : 1 + (Math.random() < 0.5));
    while (plan.picks.size < k) plan.picks.add(1 + Math.floor(Math.random() * n));
  }
  /** Vật vừa vào phễu (từ tay gắp hoặc ống lỗ từ thiện) -> chờ camera băng chuyền thấy */
  function intoFunnel(item, { fromTray = false } = {}) {
    T.falling.push(item);
    if (fromTray && plan.picks.has(++plan.count)) {
      item.userData.jam = T.jamMode === 'hard' ? 'hard' : 'soft';
      item.userData.jamAt = [0.25, 0.5, 0.75][Math.floor(Math.random() * 3)];   // nấc mở phễu thì lọt
      holdInFunnel(item);
    } else ensurePass(item);
  }
  async function holdInFunnel(item) {
    // vật nằm ngang mắc trong lòng nón (cổ hẹp) -> giữ nguyên chỗ tới khi phễu mở tới nấc của nó
    P.setKinematic(item, true);
    const target = item.parent.worldToLocal(new THREE.Vector3(F.x + 0.01, F.mouth - 0.1, F.z));
    await Promise.all([
      tw(item.position, { x: target.x, y: target.y, z: target.z, duration: 0.35, ease: 'power2.in' }),
      tw(item.rotation, { x: 0, z: 0, duration: 0.35 }),
    ]);
  }
  /** Bảo đảm vật lọt cổ phễu và nằm trên băng (vật lý chưa kịp / lật sai thì đặt lại cho đúng) */
  async function ensurePass(item) {
    if (!(await until(() => !P.has(item) || !inFunnel(item), 1200)) && P.has(item) && !item.userData.jam) {
      const b = P.body(item);                      // qua cổ phễu, nằm dọc theo băng
      b.setTranslation({ x: F.x + 0.03, y: F.neck - 0.22, z: F.z }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setLinvel({ x: 0.1, y: -0.5, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    const onBelt = () => !P.has(item) || (P.body(item).translation().y < B.y + 0.12 && P.body(item).translation().x > SLIDE_END_X);
    if (!(await until(onBelt, 2200)) && P.has(item) && !item.userData.jam && T.falling.includes(item)) {
      const b = P.body(item);                      // mắc trên máng -> đặt xuống đầu băng
      b.setTranslation({ x: SLIDE_END_X + 0.04, y: B.y + 0.06, z: B.z }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
  }
  function releaseJam(item) {
    if (!item.userData.jam) return;
    item.userData.jam = null;
    if (P.has(item) && !P.body(item).isDynamic()) P.setKinematic(item, false);
  }
  async function setFunnel(r, duration = 0.35) {
    const st = { r: interior.funnel.state.r };
    await tw(st, { r, duration, ease: 'power2.inOut', onUpdate: () => interior.funnel.set(st.r) });
  }
  bridge.on('funnel_open', async ({ level = 0 }) => {
    const r = F.rNeck + THREE.MathUtils.clamp(level, 0, 1) * (F.rNeckOpen - F.rNeck);
    await setFunnel(r, level > 0 ? 0.9 : 0.5);                         // cánh nón loe ra từ từ
    // vật kẹt nhẹ lọt khi phễu mở tới nấc của nó
    T.falling.filter((it) => it.userData.jam === 'soft' && level >= it.userData.jamAt - 1e-6)
      .forEach((it) => { releaseJam(it); ensurePass(it); });
    return {};
  });
  bridge.on('funnel_shake', async () => {
    const g = interior.funnel.group, x0 = g.position.x, z0 = g.position.z;
    T.falling.filter(inFunnel).forEach((it) => P.torque(it, { x: rand(-0.003, 0.003), y: 0, z: rand(0.002, 0.004) }));
    await tw({ t: 0 }, {
      t: 1, duration: 0.8, ease: 'none',
      onUpdate() { const t = this.targets()[0].t; g.position.x = x0 + 0.003 * Math.sin(t * 90); g.position.z = z0 + 0.003 * Math.cos(t * 70); },
    });
    g.position.x = x0; g.position.z = z0;
    return {};
  });
  /** Nhân viên gỡ kẹt (nút trong bảng Khu phân loại): đẩy vật kẹt lọt qua cổ phễu rồi báo server */
  T.clearJam = () => {
    // vật kẹt ở cổ phễu / dưới cổ phễu -> nhân viên lấy ra đặt nằm dọc trên băng (trước camera)
    T.falling.filter((it) => P.has(it) && !atCam(it)).forEach((it, i) => {
      releaseJam(it);
      const b = P.body(it);
      b.setTranslation({ x: B.camX - 0.06 - i * 0.1, y: B.y + 0.07, z: B.z }, true);
      b.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      b.setLinvel({ x: 0, y: 0, z: 0 }, true);
      b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    bridge.socket.emit('funnel_clear', {});
  };
  bridge.on('gripper_push', async ({ bbox }) => {
    let best = null, bestIou = 0;
    for (const it of T.tray) {
      const v = iou(rigs.tray.projectBox(it), bbox);
      if (v > bestIou) { bestIou = v; best = it; }
    }
    if (!best || bestIou < 0.15) {
      // khung không trùng vật nào (model báo nhầm): tay gắp hạ xuống chỗ trống rồi lên
      const cx = TR.x + ((bbox[0] + bbox[2]) / 2 / CAMS.tray.w - 0.5) * 0.8;
      await enterTray(THREE.MathUtils.clamp(cx, -0.3, 0.3), (TR.z1 + TR.z2) / 2);
      await gripTo('bottom', TR.y + 0.01, 0.25);
      await gripTo('bottom', HOVER, 0.25);
      return { pushed: false };
    }
    await pushItem(best);
    return { pushed: true };
  });

  // gạt MỘT vật còn sót (server gọi lặp lại tới khi khay trống)
  bridge.on('tray_sweep', async () => {
    const it = T.tray[0];
    if (!it) { if (Math.abs(grip.bridge.position.x - G.park) > 0.01) await park(); return { pushed: false }; }
    await pushItem(it);
    return { pushed: true };
  });

  // cửa lật vách trái khay: lật xuống 180° (thõng sát ngoài miệng phễu) / dựng lên
  bridge.on('tray_gate', async ({ open }) => {
    // mẻ mới bắt đầu phân loại -> chọn vật sẽ kẹt (cửa còn đóng/mở lại giữa mẻ khi rung khay thì giữ nguyên)
    if (open && !plan.active) { planJams(); plan.active = true; }
    if (!open && !T.tray.length) plan.active = false;
    await tw(interior.gate.rotation, { z: open ? Math.PI : 0, duration: 0.6, ease: 'power2.inOut' });
    ctx.mech.gateOpen = !!open;
    return {};
  });

  // ============================================================ vật văng ra ngoài (lỗi hiếm) -> đặt lại
  const respawnOnBelt = (it, x = F.x) => {
    const b = P.body(it);
    b?.setTranslation({ x, y: B.y + 0.08, z: B.z }, true);
    b?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    b?.setAngvel({ x: 0, y: 0, z: 0 }, true);
  };
  P.onLost = (it) => {
    if (T.tray.includes(it)) {
      const c = drawer.localToWorld(new THREE.Vector3(0, 0.25, (TR.z1 + TR.z2) / 2));      // thả lại từ trên giữa khay
      const b = P.body(it);
      b?.setTranslation({ x: c.x, y: c.y, z: c.z }, true);
      b?.setLinvel({ x: 0, y: 0, z: 0 }, true);
    }
    else if (T.belt.includes(it) || T.falling.includes(it)) respawnOnBelt(it);
    else { P.remove(it); disposeItem(it); }
  };
  const onBeltZone = (it) => { const p = it.getWorldPosition(_v); return p.y > B.y - 0.03 && p.y < B.y + 0.2 && Math.abs(p.z - B.z) < B.w / 2 + 0.03; };

  // ============================================================ băng chuyền + thanh gạt
  const rollers = interior.belt.rollers, tex = interior.belt.tex;
  ctx.onFrame.push((dt) => {
    if (!P.beltRunning) return;
    const d = dt * ts() * B.speed;
    tex.offset.x -= (d / (B.x2 - B.x1)) * tex.repeat.x;
    rollers.forEach((r) => { r.rotation.y -= d / 0.022; });
  });

  // Camera băng chuyền canh vật MỚI: băng chạy, vật từ phễu rơi xuống được chở tới dưới camera thì dừng băng.
  // Hết `seconds` (giây mô phỏng) chưa thấy -> báo server (server mở dần phễu / rung / báo kẹt).
  const atCam = (it) => {
    if (!P.has(it)) return false;
    const t = P.body(it).translation();
    return t.y < B.y + 0.12 && t.y > B.y - 0.03 && Math.abs(t.z - B.z) < B.w / 2 + 0.02 && t.x >= B.camX - 0.005;
  };
  bridge.on('belt_wait', async ({ seconds = 10 }) => {
    T.falling = T.falling.filter((it) => P.has(it));
    const ready = () => T.falling.find(atCam);
    if (!ready()) await P.runBelt({ until: () => !!ready(), max: seconds });
    const it = ready();
    if (!it) return { arrived: false };
    removeFrom(T.falling, it);
    T.belt.push(it);
    await sleep(150);
    return { arrived: true };
  });

  const binOf = (kind) => BN[kind] || BN.other;
  const inBin = (it) => { const t = P.body(it)?.translation(); return !!t && t.y < BN.y2 - 0.02 && t.z < BN.z2; };
  bridge.on('belt_sort', async ({ kind, delay = 0 }) => {
    const it = T.belt.shift();
    if (!it) return {};
    await P.runBelt({ seconds: delay });            // hẹn giờ của server: đúng bấy nhiêu giây băng chạy
    const p = interior.pushers[kind];
    if (p) {
      // xy-lanh bật: thanh gạt quét ngang băng -> vật trượt qua mép băng rơi thẳng vào thùng
      await tw(p.push.position, { z: -(B.w + 0.05), duration: 0.22, ease: 'power3.out' });
      gsap().to(p.push.position, { z: 0, duration: 0.3, delay: 0.15, ease: 'power2.inOut' });
    } else {
      // không có thanh gạt -> chạy tới tấm gạt chéo cuối băng, trượt vào thùng 'khác'
      await P.runBelt({ until: () => inBin(it) || !P.has(it), max: 6 });
    }
    if (!(await until(() => inBin(it) || !P.has(it), 2000)) && P.has(it)) {
      const [x1, x2] = binOf(kind);                 // dự phòng mô phỏng: vật mắc mép -> thả vào đúng thùng
      P.body(it).setTranslation({ x: (x1 + x2) / 2, y: BN.y2 - 0.05, z: BN.z2 - 0.15 }, true);
    }
    keepInBin(it);
    changed();
    return {};
  });

  // ============================================================ vật nằm lại trong thùng
  // Mỗi thùng giữ tối đa BIN_KEEP vật thật (vật lý, chồng lên nhau); vượt quá thì vật cũ nhất gộp vào lớp rác nén
  // (khối mức đầy) dưới đáy. Kéo xe thùng ra: vật đi theo xe; nhân viên đổ thùng thì xóa hết.
  const BIN_KEEP = 30;
  const binKindAt = (it) => {
    const t = P.body(it)?.translation();
    if (!t) return 'other';
    return ['bottle', 'can', 'other'].find((k) => t.x >= BN[k][0] - 0.01 && t.x <= BN[k][1] + 0.01) || 'other';
  };
  function keepInBin(it) {
    if (!P.has(it)) return;
    const k = binKindAt(it);
    T.binned[k].push(it);
    setPickable(it, false);
    it.userData.binned = k;
    while (T.binned[k].length > BIN_KEEP) { const old = T.binned[k].shift(); P.remove(old); disposeItem(old); }
    updateLevels();
  }
  let lastState = null;
  function updateLevels() {
    const s = lastState;
    if (!s?.station || ctx.rear?.emptiedLocal) return;
    // khối mức đầy chỉ tính phần rác đã nén (không gồm vật còn hiện trong thùng)
    const rest = {};
    for (const k of ['bottle', 'can', 'other']) rest[k] = Math.max(0, (s.bins?.[k] || 0) - T.binned[k].length);
    setBinLevels(interior.fills, rest, s.station.storage_capacity, interior.floors);
  }
  /** Kéo xe thùng ra: vật trong thùng đi theo xe */
  T.freezeBins = () => {
    for (const k of Object.keys(T.binned)) for (const it of T.binned[k]) { if (P.has(it)) P.setKinematic(it, true); reparent(it, interior.cart); }
  };
  T.binnedCount = () => Object.values(T.binned).reduce((n, a) => n + a.length, 0);
  /** Nhân viên đổ thùng: bỏ hết vật đang nằm trong thùng */
  T.clearBins = () => {
    for (const k of Object.keys(T.binned)) { for (const it of T.binned[k]) { P.remove(it); disposeItem(it); } T.binned[k] = []; }
  };
  /** Đẩy xe thùng vào mà chưa đổ: vật lại chịu vật lý bình thường */
  T.releaseBins = () => {
    const items = Object.values(T.binned).flat();
    items.forEach((it) => reparent(it, ig));
    P.afterCatchUp(() => items.forEach((it) => P.setKinematic(it, false)));
  };

  // ============================================================ mức đầy thùng
  bridge.onState((s) => {
    if (!s?.station) return;
    lastState = s;
    // admin bấm "Đã đổ xe thùng" (kho về 0) mà xe vẫn trong máy: bỏ vật đang hiện trong thùng
    if (s.station.storage_count === 0 && T.binnedCount() && !ctx.rear?.binOut) T.clearBins();
    if (!ctx.rear?.emptiedLocal) updateLevels();
    else if (s.station.storage_count === 0) ctx.rear.emptiedLocal = false;
    if (s.public_bins) for (const side of ['left', 'right']) setPublicLevel(pubBins[side], s.public_bins[side] / s.public_bins.capacity);
  });

  T.intoFunnel = intoFunnel;
  return T;
}
