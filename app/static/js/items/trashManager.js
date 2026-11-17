// Quản lý rác trong mô phỏng: trên tay người dùng, trong khay nạp, trên mặt phẳng rung,
// trong ngăn trả rác, vào kho. Đồng thời thực thi các lệnh cơ cấu (đổ, rung, chụp, nghiêng).
import * as THREE from 'three';
import { createItem, ITEM_TYPES } from './itemFactory.js';
import { PLATE, SCAN_CAM, SCAN_LAYER, setStorageLevel } from '../station/interior.js';
import { toast } from '../ui/toast.js';

const gsap = () => window.gsap;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

/** Kích thước chiếm chỗ trên mặt phẳng XZ của vật đã xoay quanh Y */
function footprint(item) {
  const s = item.userData.size;
  const c = Math.abs(Math.cos(item.rotation.y)), n = Math.abs(Math.sin(item.rotation.y));
  return { fx: c * s.x + n * s.z, fz: n * s.x + c * s.z, h: s.y };
}
const overlapXZ = (a, b) => Math.abs(a.position.x - b.position.x) * 2 < (a.userData.fp.fx + b.userData.fp.fx) * 0.98
  && Math.abs(a.position.z - b.position.z) * 2 < (a.userData.fp.fz + b.userData.fp.fz) * 0.98;

/** Đặt vật lên chồng trong 1 vùng chứa (tọa độ local), trả về đỉnh vật */
function stackPlace(list, item, x, z, floor) {
  item.userData.fp = footprint(item);
  item.position.x = x; item.position.z = z;
  let base = floor;
  for (const o of list) if (o !== item && overlapXZ(o, item)) base = Math.max(base, o.userData.top);
  item.position.y = base + item.userData.fp.h / 2;
  item.userData.top = base + item.userData.fp.h;
  item.userData.stacked = base > floor + 0.001;
  return item.userData.top;
}

function randomIn(inner, fp) {
  return [
    rand(inner.x1 + fp.fx / 2, Math.max(inner.x1 + fp.fx / 2, inner.x2 - fp.fx / 2)),
    rand(inner.z1 + fp.fz / 2, Math.max(inner.z1 + fp.fz / 2, inner.z2 - fp.fz / 2)),
  ];
}

export function setupTrash(ctx, bridge, interior) {
  const { parts, station } = ctx;
  const feed = parts.feedDrawer, ret = parts.returnDrawer;
  const plate = interior.plate;
  const T = {
    hand: [],      // vật trên tay (đã tách khỏi scene)
    tray: [],
    plate: [],
    ret: [],
    forceOverlap: false, // panel Dev: ép lỗi vật đè nhau
    listeners: [],
  };
  ctx.trash = T;
  const changed = () => T.listeners.forEach((fn) => fn(T));
  T.notify = changed;
  // Bảng "Rác trong tay": bỏ vào khay nạp hay lỗ bỏ từng chai/lon
  T.target = 'tray';
  T.setTarget = (t) => { T.target = t; changed(); };
  T.drop = (itemOrType) => (T.target === 'slot' ? T.insertSlot(itemOrType) : T.addToTray(itemOrType));
  const pickables = (ctx.extraPickables ||= []);
  const setPickable = (item, on) => {
    const i = pickables.indexOf(item);
    if (on && i < 0) pickables.push(item);
    if (!on && i >= 0) pickables.splice(i, 1);
  };
  const removeFrom = (arr, item) => { const i = arr.indexOf(item); if (i >= 0) arr.splice(i, 1); };

  // Chiều cao rác trong khay -> mechanics dùng để xét kẹt
  ctx.mech.trayContentHeight = () => T.tray.reduce((m, it) => Math.max(m, it.userData.top - feed.userData.inner.floor), 0);

  // ------------------------------------------------------------ tay <-> khay
  function restackTray() {
    const inner = feed.userData.inner;
    const list = [];
    for (const it of T.tray) { stackPlace(list, it, it.position.x, it.position.z, inner.floor); list.push(it); }
  }

  T.addToTray = function addToTray(itemOrType) {
    const m = ctx.mech;
    if (!m.feedOut || m.moving.feed) {
      toast('Hãy mở cửa và kéo khay nạp ra trước khi bỏ rác', 'warning');
      return false;
    }
    const item = typeof itemOrType === 'string' ? createItem(itemOrType) : itemOrType;
    removeFrom(T.hand, item);
    item.rotation.set(0, rand(-0.35, 0.35) + (Math.random() < 0.25 ? Math.PI / 2 : 0), 0);
    const inner = feed.userData.inner;
    feed.add(item);
    // Người đổ rác thường đặt vào chỗ trống: dò theo lưới (2 hướng xoay), chọn chỗ thấp nhất;
    // nhiều chỗ thấp như nhau thì chọn ngẫu nhiên. Chỉ khi khay hết chỗ mới phải chồng lên.
    const ry0 = item.rotation.y;
    const cands = [];
    for (const ry of [ry0, ry0 + Math.PI / 2]) {
      item.rotation.y = ry;
      const fp = footprint(item);
      for (let x = inner.x1 + fp.fx / 2; x <= inner.x2 - fp.fx / 2 + 1e-6; x += 0.02) {
        for (let z = inner.z1 + fp.fz / 2; z <= inner.z2 - fp.fz / 2 + 1e-6; z += 0.02) {
          cands.push({ x, z, ry, top: stackPlace(T.tray, item, x, z, inner.floor) });
        }
      }
    }
    const minTop = Math.min(...cands.map((c) => c.top));
    const low = cands.filter((c) => c.top < minTop + 1e-4);
    const best = low[Math.floor(Math.random() * low.length)];
    item.rotation.y = best.ry;
    stackPlace(T.tray, item, best.x, best.z, inner.floor);
    T.tray.push(item);
    // rơi nhẹ vào khay
    const yEnd = item.position.y;
    gsap().from(item.position, { y: yEnd + 0.25, duration: 0.35, ease: 'bounce.out' });
    item.userData.onClick = () => T.takeFromTray(item);
    item.userData.hint = () => `Lấy ra: ${ITEM_TYPES[item.userData.type].name}`;
    setPickable(item, true);
    changed();
    return true;
  };

  T.takeFromTray = function takeFromTray(item) {
    const m = ctx.mech;
    if (!m.feedOut || m.moving.feed) return;
    removeFrom(T.tray, item);
    feed.remove(item);
    setPickable(item, false);
    T.hand.push(item);
    restackTray();
    changed();
  };

  T.takeFromReturn = function takeFromReturn(item) {
    if (!ctx.mech.returnOut || ctx.mech.moving.ret) {
      toast('Hãy kéo ngăn trả rác ra để lấy rác', 'warning');
      return;
    }
    removeFrom(T.ret, item);
    ret.remove(item);
    setPickable(item, false);
    T.hand.push(item);
    changed();
  };

  T.takeAllFromReturn = function takeAllFromReturn() {
    if (!ctx.mech.returnOut) { toast('Hãy kéo ngăn trả rác ra trước', 'warning'); return; }
    [...T.ret].forEach((it) => T.takeFromReturn(it));
  };

  T.discardHand = function discardHand() {
    T.hand.forEach(disposeItem);
    T.hand.length = 0;
    changed();
  };

  function disposeItem(item) {
    item.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((mm) => { mm.map?.dispose(); mm.dispose(); });
      }
    });
  }

  // Thả rác kéo từ bảng bên trái vào canvas
  const dom = ctx.renderer.domElement;
  dom.addEventListener('dragover', (e) => e.preventDefault());
  dom.addEventListener('drop', (e) => {
    e.preventDefault();
    const type = e.dataTransfer.getData('text/atm-item');
    const handId = e.dataTransfer.getData('text/atm-hand');
    // thả trúng lỗ bỏ chai -> bỏ vào lỗ, còn lại -> khay nạp
    const hit = ctx.pick?.(e);
    const put = hit?.obj.userData.action === 'slot' ? T.insertSlot : T.addToTray;
    if (type) put(type);
    else if (handId) { const it = T.hand.find((h) => String(h.userData.id) === handId); if (it) put(it); }
  });

  // ------------------------------------------------------------ cơ cấu: đổ khay
  function toPlateLocal(worldPos) {
    return plate.worldToLocal(worldPos.clone());
  }

  bridge.on('dump_feed_tray', async () => {
    const flaps = feed.userData.flaps;
    const items = [...T.tray];
    // mở 2 cánh đáy khay
    await Promise.all(flaps.map((f, i) => gsap().to(f.rotation, { z: (i === 0 ? -1 : 1) * Math.PI / 2, duration: 0.45, ease: 'power2.in' }).then()));
    const inner = { x1: -PLATE.w / 2 + 0.02, x2: PLATE.w / 2 - 0.02, z1: -PLATE.d / 2 + 0.01, z2: PLATE.d / 2 - 0.01 };
    const placed = [];
    // giữ nguyên thứ tự xếp chồng (vật dưới rơi trước)
    items.sort((a, b) => a.userData.top - b.userData.top);
    const tweens = [];
    for (const it of items) {
      const wp = it.getWorldPosition(new THREE.Vector3());
      const wq = it.getWorldQuaternion(new THREE.Quaternion());
      plate.add(it);
      it.position.copy(toPlateLocal(wp));
      it.quaternion.copy(plate.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(wq));
      const rotY = new THREE.Euler().setFromQuaternion(it.quaternion, 'YXZ').y;
      const start = it.position.clone();
      it.rotation.set(0, rotY, 0);
      const fp = footprint(it);
      const x = THREE.MathUtils.clamp(start.x * 0.85, inner.x1 + fp.fx / 2, inner.x2 - fp.fx / 2);
      const z = THREE.MathUtils.clamp(start.z * 0.8, inner.z1 + fp.fz / 2, inner.z2 - fp.fz / 2);
      stackPlace(placed, it, x, z, 0);
      placed.push(it);
      const end = it.position.clone();
      it.position.copy(start);
      tweens.push(gsap().to(it.position, { x: end.x, y: end.y, z: end.z, duration: rand(0.45, 0.6), ease: 'bounce.out', delay: rand(0, 0.15) }).then());
      setPickable(it, false);
    }
    T.tray = [];
    T.plate = placed;
    markOverlaps();
    await Promise.all(tweens);
    await Promise.all(flaps.map((f) => gsap().to(f.rotation, { z: 0, duration: 0.4 }).then()));
    changed();
  });

  function markOverlaps() {
    for (const a of T.plate) {
      a.userData.overlapped = a.userData.stacked || T.plate.some((b) => b !== a && overlapXZ(a, b));
    }
  }

  // ------------------------------------------------------------ cơ cấu: rung
  bridge.on('vibrate', async ({ seconds = 3 }) => {
    const dur = Math.max(1.2, seconds);
    // Dàn đều theo hàng (shelf packing), có xáo trộn nhẹ
    const items = [...T.plate].sort((a, b) => b.userData.size.x - a.userData.size.x);
    const margin = 0.025, x1 = -PLATE.w / 2 + margin, x2 = PLATE.w / 2 - margin, z1 = -PLATE.d / 2 + margin, z2 = PLATE.d / 2 - margin;
    let cx = x1, cz = z1, rowH = 0;
    const targets = new Map();
    const starts = new Map(items.map((it) => [it, { p: it.position.clone(), ry: it.rotation.y }]));
    const placed = [];
    for (const it of items) {
      const s = it.userData.size;
      // xoay về dọc trục X (dài theo chiều ngang mặt phẳng)
      let rotY = rand(-0.08, 0.08);
      let fx = s.x, fz = s.z;
      if (fx > x2 - x1) { rotY += Math.PI / 2; [fx, fz] = [fz, fx]; }
      if (cx + fx > x2) { cx = x1; cz += rowH + margin; rowH = 0; }
      let x, z;
      if (cz + fz <= z2) {
        x = cx + fx / 2; z = cz + fz / 2;
        cx += fx + margin; rowH = Math.max(rowH, fz);
      } else {
        // không đủ chỗ -> nằm chồng lên vật khác (sẽ bị coi là đè nhau)
        x = rand(x1 + fx / 2, x2 - fx / 2); z = rand(z1 + fz / 2, z2 - fz / 2);
      }
      it.rotation.y = rotY;
      stackPlace(placed, it, x, z, 0);
      placed.push(it);
      targets.set(it, { x: it.position.x, y: it.position.y, z: it.position.z, ry: rotY });
    }
    // Căn khối rác đã xếp vào giữa mặt phẳng (theo chiều sâu) để camera chụp trọn
    const usedEnd = cz + rowH;
    const shift = Math.max(0, (z2 - usedEnd) / 2);
    if (shift > 0) {
      for (const it of items) {
        const t = targets.get(it);
        if (!it.userData.stacked) { t.z += shift; it.position.z += shift; }
      }
    }
    if (T.forceOverlap && items.length >= 2) {
      // Dev: ép 2 vật dính chồng lên nhau
      const [a, b] = items;
      stackPlace(placed.filter((p) => p !== b), b, a.position.x + 0.02, a.position.z, 0);
      targets.set(b, { x: b.position.x, y: b.position.y, z: b.position.z, ry: b.rotation.y });
    }
    markOverlaps();
    // về lại vị trí cũ để tween tới vị trí mới
    for (const it of items) { it.position.copy(starts.get(it).p); }
    items.forEach((it) => {
      const t = targets.get(it);
      gsap().fromTo(it.rotation, { y: starts.get(it).ry }, { y: t.ry, duration: dur * 0.6, delay: dur * 0.15, ease: 'power1.inOut' });
    });

    // Vị trí "nền" của từng vật đi dần tới chỗ mới; rung + nảy cộng thêm lên trên
    const base = new Map(items.map((it) => [it, it.position.clone()]));
    const phase = new Map(items.map((it) => [it, Math.random() * Math.PI * 2]));
    const tweens = items.map((it) => {
      const t = targets.get(it);
      return gsap().to(base.get(it), { x: t.x, z: t.z, y: t.y, duration: dur * 0.8, ease: 'power1.inOut', delay: dur * 0.1 }).then();
    });

    // Motor rung lệch tâm: mặt phẳng rung mạnh theo 3 hướng + lắc, rác nảy lên xuống, thân máy rung nhẹ theo
    const P0 = plate.position.clone(), R0 = plate.rotation.clone();
    const root = station.root, root0 = root.position.clone();
    const TAU = Math.PI * 2;
    const prog = { t: 0 };
    const shake = gsap().to(prog, {
      t: dur, duration: dur, ease: 'none',
      onUpdate: () => {
        const t = prog.t;
        const env = Math.min(1, t / 0.25) * Math.min(1, (dur - t) / 0.35);  // tăng tốc / hãm motor
        plate.position.set(
          P0.x + 0.009 * env * Math.sin(TAU * 17 * t),
          P0.y + 0.006 * env * Math.sin(TAU * 23 * t + 1.3),
          P0.z + 0.004 * env * Math.sin(TAU * 13 * t + 0.7),
        );
        plate.rotation.z = R0.z + 0.022 * env * Math.sin(TAU * 11 * t + 0.4);
        plate.rotation.x = R0.x + 0.014 * env * Math.sin(TAU * 9 * t + 2.1);
        root.position.x = root0.x + 0.0013 * env * Math.sin(TAU * 21 * t);
        root.position.z = root0.z + 0.0008 * env * Math.sin(TAU * 19 * t + 1);
        for (const it of items) {
          const b = base.get(it), ph = phase.get(it);
          const hop = 0.016 * env * Math.abs(Math.sin(TAU * 7 * t + ph));   // nảy khỏi mặt phẳng
          it.position.set(b.x + 0.003 * env * Math.sin(TAU * 15 * t + ph), b.y + hop, b.z);
          it.rotation.z = 0.12 * env * Math.sin(TAU * 6 * t + ph);         // lắc qua lại
          it.rotation.x = 0.06 * env * Math.sin(TAU * 8 * t + ph * 1.7);
        }
      },
    }).then();
    await Promise.all([shake, ...tweens]);
    plate.position.copy(P0);
    plate.rotation.copy(R0);
    root.position.copy(root0);
    for (const it of items) { it.position.copy(base.get(it)); it.rotation.x = 0; it.rotation.z = 0; }
  });

  // ------------------------------------------------------------ cơ cấu: chụp ảnh
  // near = 8 cm để không "thấy" chính vỏ camera / đèn LED vòng
  const scanCam = new THREE.PerspectiveCamera(SCAN_CAM.fov, SCAN_CAM.w / SCAN_CAM.h, 0.08, 2);
  scanCam.position.set(...SCAN_CAM.pos);
  scanCam.lookAt(0, PLATE.y, PLATE.z);
  scanCam.layers.enable(SCAN_LAYER);
  ctx.scanCam = scanCam;
  const rt = new THREE.WebGLRenderTarget(SCAN_CAM.w, SCAN_CAM.h, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const pixels = new Uint8Array(SCAN_CAM.w * SCAN_CAM.h * 4);
  const snapCanvas = document.createElement('canvas');
  snapCanvas.width = SCAN_CAM.w; snapCanvas.height = SCAN_CAM.h;
  const snapCtx = snapCanvas.getContext('2d');

  function projectBox(item) {
    const box = new THREE.Box3().setFromObject(item);
    const pts = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const v = new THREE.Vector3(x, y, z).project(scanCam);
      pts.push([(v.x + 1) / 2 * SCAN_CAM.w, (1 - v.y) / 2 * SCAN_CAM.h]);
    }
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }

  T.capture = function capture() {
    const { renderer, scene } = ctx;
    plate.updateMatrixWorld(true);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, scanCam);
    renderer.readRenderTargetPixels(rt, 0, 0, SCAN_CAM.w, SCAN_CAM.h, pixels);
    renderer.setRenderTarget(prev);
    const img = snapCtx.createImageData(SCAN_CAM.w, SCAN_CAM.h);
    const row = SCAN_CAM.w * 4;
    for (let y = 0; y < SCAN_CAM.h; y++) {
      img.data.set(pixels.subarray((SCAN_CAM.h - 1 - y) * row, (SCAN_CAM.h - y) * row), y * row);
    }
    snapCtx.putImageData(img, 0, 0);
    const hints = T.plate.map((it) => ({
      label: it.userData.type,
      bbox: projectBox(it),
      overlapped: !!it.userData.overlapped,
    }));
    return { image: snapCanvas.toDataURL('image/jpeg', 0.9), hints };
  };

  bridge.on('capture', async () => {
    // Như camera công nghiệp thật: đèn LED vòng sáng dần để lấy nét/đo sáng -> chớp flash ngắn lúc chụp
    // -> tắt dần. Đèn đỏ nhỏ trên thân camera sáng trong lúc chụp.
    const ring = interior.ring.material, light = interior.light, rec = interior.rec.material;
    const lit = { ring: 0, light: 0 };
    const apply = () => { ring.emissiveIntensity = lit.ring; light.intensity = lit.light; };
    rec.emissiveIntensity = 2.5;
    // Laser vạch quét qua toàn mặt phẳng (đo hình dạng / chiều cao vật) trong buồng tối
    if (ctx.laser) {
      T.plate.forEach((it) => ctx.laser.attach(it));
      await gsap().to(lit, { ring: 0.25, light: 0.3, duration: 0.2, onUpdate: apply }).then();
      await ctx.laser.sweep();
    }
    await gsap().to(lit, { ring: 1.6, light: 2.6, duration: 0.35, ease: 'power1.out', onUpdate: apply }).then();
    await sleep(120);
    lit.ring = 4.5; lit.light = 4.6; apply();   // flash
    const data = T.capture();
    await sleep(70);
    await gsap().to(lit, { ring: 1.6, light: 2.6, duration: 0.22, ease: 'power2.out', onUpdate: apply }).then();
    await sleep(150);
    await gsap().to(lit, { ring: 0, light: 0, duration: 0.35, ease: 'power1.in', onUpdate: apply }).then();
    rec.emissiveIntensity = 0;
    ctx.lastCapture = data;
    return data;
  });

  // ------------------------------------------------------------ cơ cấu: nghiêng mặt phẳng
  bridge.on('tilt_plate', async ({ target }) => {
    const toStorage = target === 'storage';
    const items = [...T.plate];
    const sign = toStorage ? -1 : 1; // rotation.x > 0: mép trước hạ xuống
    await gsap().to(plate.rotation, { x: sign * PLATE.tilt, duration: 0.6, ease: 'power2.inOut' }).then();
    // trượt ra mép
    await Promise.all(items.map((it, i) => gsap().to(it.position, {
      z: (toStorage ? -1 : 1) * (PLATE.d / 2 + 0.06), duration: 0.5, delay: i * 0.05, ease: 'power2.in',
    }).then()));
    T.plate = [];
    if (toStorage) {
      // rơi vào kho rồi biến mất
      await Promise.all(items.map((it) => gsap().to(it.position, { y: it.position.y - 0.25, duration: 0.3, ease: 'power2.in' }).then()));
      items.forEach((it) => { plate.remove(it); disposeItem(it); });
    } else {
      // rơi xuống máng -> ngăn trả rác
      const inner = ret.userData.inner;
      const placed = [...T.ret];
      for (const it of items) {
        const wp = it.getWorldPosition(new THREE.Vector3());
        ret.add(it);
        it.position.copy(ret.worldToLocal(wp));
        const start = it.position.clone();
        it.rotation.set(0, rand(-0.5, 0.5), 0);
        const fp = footprint(it);
        const [x, z] = randomIn(inner, fp);
        stackPlace(placed, it, x, z, inner.floor);
        placed.push(it);
        const end = it.position.clone();
        it.position.copy(start);
        gsap().to(it.position, { x: end.x, y: end.y, z: end.z, duration: 0.5, ease: 'bounce.out', delay: rand(0, 0.2) });
        it.userData.onClick = () => T.takeFromReturn(it);
        it.userData.hint = () => `Lấy lại: ${ITEM_TYPES[it.userData.type].name}`;
        setPickable(it, true);
      }
      T.ret = placed;
      await sleep(700);
    }
    await gsap().to(plate.rotation, { x: 0, duration: 0.5, ease: 'power2.inOut' }).then();
    changed();
  });

  // Mức đầy kho theo trạng thái server
  bridge.onState((s) => {
    if (ctx.storageLevel) ctx.storageLevel(s);
    else if (s?.station) setStorageLevel(interior.fill, s.station.storage_count / s.station.storage_capacity);
  });

  return T;
}
