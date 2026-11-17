// Khay nạp (thùng rác người dùng đổ rác vào): cạn, chạy trên ray, không rút rời ra được
import * as THREE from 'three';
import { D } from './dims.js';
import { M } from './materials.js';
import { box, cyl, openBox, plane, texMat } from './helpers.js';
import { labelTexture } from './textures.js';

// Cao độ đáy thanh gạt = miệng khay + 1,5 cm khe hở
export const LIMIT_Y = D.TRAY.y + D.TRAY.h + 0.015 + 0.006;
export const LIMIT_HEIGHT = LIMIT_Y - 0.006 - D.TRAY.y; // chiều cao rác tối đa tính từ đáy khay

export function buildFeedDrawer() {
  const { w, d, h, y } = D.TRAY;
  const t = 0.008;

  const group = new THREE.Group();
  group.name = 'feedDrawer';
  // gốc = tâm mép dưới mặt trước khay
  group.position.set(0, y, D.FRONT - D.T - 0.012);
  group.userData.closedZ = group.position.z;

  // Thành khay (trái, phải, sau) + đáy là 2 cánh lật (kiểu cửa khoang bom) để đổ rác xuống mặt rung
  const tray = new THREE.Group();
  tray.name = 'trayBody';
  tray.position.z = -0.01;
  tray.add(box(t, h, d, M.trayPlastic, { x: -w / 2 + t / 2, y: h / 2, z: -d / 2 }));
  tray.add(box(t, h, d, M.trayPlastic, { x: w / 2 - t / 2, y: h / 2, z: -d / 2 }));
  tray.add(box(w, h, t, M.trayPlastic, { y: h / 2, z: -d + t / 2 }));
  tray.add(box(w, h, t, M.trayPlastic, { y: h / 2, z: -t / 2 }));
  const flaps = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.name = sx < 0 ? 'flapL' : 'flapR';
    pivot.position.set(sx * (w / 2 - t), t / 2, -d / 2);
    pivot.add(box(w / 2 - t, t, d - 2 * t, M.trayPlastic, { x: -sx * (w / 2 - t) / 2 }));
    tray.add(pivot);
    flaps.push(pivot);
  }
  group.add(tray);
  group.userData.flaps = flaps;
  // Lòng khay (hệ tọa độ của group): nơi đặt rác
  group.userData.inner = { x1: -w / 2 + t, x2: w / 2 - t, z1: -0.01 - d + t, z2: -0.01 - t, floor: t };

  // Mặt trước khay (cao hơn thành khay một chút) + tay cầm
  const front = new THREE.Group();
  front.name = 'feedDrawerFront';
  front.add(box(w + 0.02, h + 0.035, 0.014, M.green, { y: (h + 0.035) / 2 - 0.005 }));
  const lbl = plane(0.20, 0.032, texMat(labelTexture('KHAY NẠP RÁC', { bg: '#166534', size: 90 })), { y: 0.03, z: 0.0075 });
  front.add(lbl);
  const handle = new THREE.Group();
  handle.name = 'feedDrawerHandle';
  handle.position.set(0, 0.085, 0.007);
  const bar = cyl(0.007, 0.007, 0.22, M.steel, { z: 0.028 });
  bar.rotation.z = Math.PI / 2;
  handle.add(bar);
  for (const x of [-0.1, 0.1]) {
    const s = cyl(0.005, 0.005, 0.028, M.steel, { x, z: 0.014 });
    s.rotation.x = Math.PI / 2;
    handle.add(s);
  }
  front.add(handle);
  group.add(front);

  // Vạch giới hạn đổ rác (miệng khay)
  const limit = box(w - 0.02, 0.004, 0.004, new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5 }),
    { y: h - 0.006, z: -d - 0.006 });
  group.add(limit);

  // Con trượt hai bên khay (ăn vào ray)
  for (const sx of [-1, 1]) {
    group.add(box(0.01, 0.018, d - 0.04, M.steel, { x: sx * (w / 2 + 0.005), y: 0.045, z: -d / 2 - 0.01 }));
  }

  return { group, handle };
}

/** Hốc phía sau cửa nạp + 2 thanh ray cố định */
export function buildFeedCavity() {
  const { x1, x2, y1, y2 } = D.DOOR;
  const g = new THREE.Group();
  g.name = 'feedCavity';
  // Hốc không có đáy: rác rơi qua xuống buồng quét
  const cav = openBox(x2 - x1, y2 - y1, 0.56, 0.01, M.cavity);
  cav.remove(cav.children[0]);
  cav.position.set(0, y1, D.FRONT - D.T);
  cav.name = 'feedCavityLiner';
  g.add(cav);
  for (const sx of [-1, 1]) {
    g.add(box(0.012, 0.03, 0.54, M.steel, {
      x: sx * (D.TRAY.w / 2 + 0.016), y: D.TRAY.y + 0.045, z: D.FRONT - D.T - 0.28,
    }));
  }
  // Thanh gạt giới hạn chiều cao: rác cao hơn miệng khay sẽ vướng thanh này -> khay kẹt
  const bar = box(D.TRAY.w + 0.03, 0.012, 0.02, M.steel, {
    y: LIMIT_Y, z: D.FRONT - D.T - 0.06,
  });
  bar.name = 'trayLimiter';
  g.add(bar);
  return g;
}
