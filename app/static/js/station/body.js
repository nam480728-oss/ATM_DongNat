// Lắp ráp toàn bộ trạm: vỏ, bảng hiệu, tấm hướng dẫn, cửa, khay, ngăn trả rác, bảng thao tác
import * as THREE from 'three';
import { D } from './dims.js';
import { M, emissive, COLORS } from './materials.js';
import { box, enableShadows, plane, rbox, texMat } from './helpers.js';
import { infoTexture, sideDecalTexture, signTexture } from './textures.js';
import { buildDoor } from './door.js';
import { buildFeedCavity, buildFeedDrawer } from './feedDrawer.js';
import { buildReturnCavity, buildReturnDrawer } from './returnDrawer.js';
import { buildPanel } from './panel.js';
import { buildSlot } from './slot.js';
import { buildBackPanel, buildRearDoor } from './rearDoor.js';

function roundedRectPath(path, x1, y1, x2, y2, r) {
  path.moveTo(x1 + r, y1);
  path.lineTo(x2 - r, y1); path.quadraticCurveTo(x2, y1, x2, y1 + r);
  path.lineTo(x2, y2 - r); path.quadraticCurveTo(x2, y2, x2 - r, y2);
  path.lineTo(x1 + r, y2); path.quadraticCurveTo(x1, y2, x1, y2 - r);
  path.lineTo(x1, y1 + r); path.quadraticCurveTo(x1, y1, x1 + r, y1);
  return path;
}

/** Mặt trước: tấm phẳng khoét 3 lỗ (cửa nạp, ngăn trả rác, lỗ bỏ chai tròn) */
function buildFrontPanel() {
  const hw = D.W / 2;
  const shape = roundedRectPath(new THREE.Shape(), -hw, D.PLINTH, hw, D.TOP, 0.02);
  for (const o of [D.DOOR, D.RETURN]) {
    shape.holes.push(roundedRectPath(new THREE.Path(), o.x1, o.y1, o.x2, o.y2, 0.006));
  }
  const slotHole = new THREE.Path();
  slotHole.absarc(D.SLOT.x, D.SLOT.y, D.SLOT.r, 0, Math.PI * 2, true);
  shape.holes.push(slotHole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: D.T, bevelEnabled: false, curveSegments: 8 });
  const mesh = new THREE.Mesh(geo, M.body);
  mesh.position.z = D.FRONT - D.T;
  mesh.name = 'frontPanel';
  return mesh;
}

export function buildStation({ prices } = {}) {
  const root = new THREE.Group();
  root.name = 'station';
  const shell = new THREE.Group();   // các tấm vỏ (sẽ làm trong suốt ở chế độ cắt lớp)
  shell.name = 'shell';
  root.add(shell);

  const H = D.TOP - D.PLINTH, cy = D.PLINTH + H / 2;

  // ---- Bệ ----
  root.add(rbox(D.W + 0.06, D.PLINTH, D.DEPTH + 0.06, 0.01, M.rubber, { y: D.PLINTH / 2 }));

  // ---- Vỏ ----
  shell.add(buildFrontPanel());
  for (const sx of [-1, 1]) {
    shell.add(rbox(D.T * 2, H, D.DEPTH - D.T, 0.012, M.body, { x: sx * (D.W / 2 - D.T), y: cy, z: -D.T / 2 }));
  }
  shell.add(buildBackPanel(roundedRectPath));                                                // lưng (có cửa sau)
  shell.add(box(D.W - 0.02, D.T, D.DEPTH - 0.02, M.body, { y: D.PLINTH + D.T / 2 }));      // đáy
  // Mái che xanh
  shell.add(rbox(D.W + 0.05, 0.045, D.DEPTH + 0.06, 0.015, M.green, { y: D.TOP + 0.02, z: 0.015 }));

  // ---- Bảng hiệu phát sáng ----
  const signH = D.SIGN.y2 - D.SIGN.y1;
  const signMat = texMat(signTexture(), { emissive: 0.55, roughness: 0.35 });
  const sign = box(D.W - 0.04, signH, 0.035, [M.green, M.green, M.green, M.green, signMat, M.green],
    { y: (D.SIGN.y1 + D.SIGN.y2) / 2, z: D.FRONT + 0.0175 });
  sign.name = 'sign';
  root.add(sign);

  // ---- Tấm hướng dẫn góc trên trái ----
  const I = D.INFO;
  root.add(rbox(I.w + 0.02, I.h + 0.02, 0.006, 0.006, M.green, { x: I.x, y: I.y, z: D.FRONT + 0.003 }));
  const info = plane(I.w, I.h, texMat(infoTexture(prices), { roughness: 0.6 }), { x: I.x, y: I.y, z: D.FRONT + 0.0065 });
  info.name = 'infoPanel';
  root.add(info);

  // ---- Thanh đèn trạng thái ----
  const S = D.STATUS;
  root.add(rbox(S.w + 0.03, S.h + 0.02, 0.01, 0.005, M.trim, { y: S.y, z: D.FRONT + 0.005 }));
  const status = box(S.w, S.h, 0.004, emissive(COLORS.green, 1.1), { y: S.y, z: D.FRONT + 0.011 });
  status.name = 'statusBar';
  root.add(status);

  // ---- Viền xanh trang trí hai bên + logo hông ----
  const decal = sideDecalTexture();
  for (const sx of [-1, 1]) {
    root.add(box(0.004, 0.03, D.DEPTH - 0.04, M.green, { x: sx * (D.W / 2 + 0.0005), y: 0.55 }));
    root.add(box(0.004, 0.03, D.DEPTH - 0.04, M.green, { x: sx * (D.W / 2 + 0.0005), y: 1.62 }));
    const d = plane(0.5, 0.5, new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.5 }),
      { x: sx * (D.W / 2 + 0.003), y: 1.08 });
    d.rotation.y = sx * Math.PI / 2;
    root.add(d);
    // khe thông gió
    for (let i = 0; i < 6; i++) {
      root.add(box(0.004, 0.008, 0.22, M.trim, { x: sx * (D.W / 2 + 0.001), y: 0.18 + i * 0.022, z: -0.18 }));
    }
  }

  // ---- Cửa nạp + khay ----
  const door = buildDoor();
  root.add(door.pivot, ...door.extras);
  root.add(buildFeedCavity());
  const feed = buildFeedDrawer();
  root.add(feed.group);

  // ---- Ngăn trả rác ----
  root.add(buildReturnCavity());
  const ret = buildReturnDrawer();
  root.add(ret.group);

  // ---- Lỗ bỏ từng chai/lon ----
  const slot = buildSlot();
  root.add(slot.group, slot.tube);

  // ---- Cửa sau ----
  const rear = buildRearDoor();
  root.add(rear.pivot);

  // ---- Bảng thao tác ----
  const panel = buildPanel();
  root.add(panel.plate, panel.mount, panel.pay, panel.payLabel);

  enableShadows(root);
  // Kính không đổ bóng đậm
  door.glass.castShadow = false;
  slot.tube.traverse((o) => { if (o.isMesh && o.material.transparent) { o.castShadow = false; o.receiveShadow = false; } });

  return {
    root,
    shell,
    parts: {
      door: door.pivot, doorHandle: door.handle, doorLockLed: door.lockLed,
      feedDrawer: feed.group, feedHandle: feed.handle,
      returnDrawer: ret.group, returnHandle: ret.handle, returnLed: ret.led,
      screenMount: panel.mount, screen: panel.screen,
      payButton: panel.pay, payCap: panel.cap, payRing: panel.ring,
      statusBar: status, sign, infoPanel: info,
      slot: slot.group, slotFront: slot.group.getObjectByName('slotFront'), slotFlap: slot.flap, slotLed: slot.led,
      slotTube: slot.tube,
      rearDoor: rear.pivot, rearLock: rear.lock,
    },
  };
}
