// Lắp ráp vỏ trạm: thân, mái, bảng hiệu, tấm hướng dẫn, cửa khoang nạp, màn hình, lỗ từ thiện, cửa sau,
// đèn cảnh báo, 2 thùng rác công cộng hai bên.
import * as THREE from 'three';
import { D } from './dims.js';
import { M, emissive, COLORS } from './materials.js';
import { box, enableShadows, plane, rbox, texMat } from './helpers.js';
import { infoTexture, labelTexture, sideDecalTexture, signTexture } from './textures.js';
import { buildDoor } from './door.js';
import { buildPanel } from './panel.js';
import { buildSlot } from './slot.js';
import { buildBackPanel, buildRearDoor } from './rearDoor.js';
import { buildPublicBins, publicHole } from './publicBins.js';

export function roundedRectPath(path, x1, y1, x2, y2, r) {
  path.moveTo(x1 + r, y1);
  path.lineTo(x2 - r, y1); path.quadraticCurveTo(x2, y1, x2, y1 + r);
  path.lineTo(x2, y2 - r); path.quadraticCurveTo(x2, y2, x2 - r, y2);
  path.lineTo(x1 + r, y2); path.quadraticCurveTo(x1, y2, x1, y2 - r);
  path.lineTo(x1, y1 + r); path.quadraticCurveTo(x1, y1, x1 + r, y1);
  return path;
}

/** Mặt trước: tấm phẳng khoét lỗ cửa khoang nạp + lỗ tròn từ thiện */
function buildFrontPanel() {
  const hw = D.W / 2;
  const shape = roundedRectPath(new THREE.Shape(), -hw, D.PLINTH, hw, D.TOP, 0.03);
  const o = D.DOOR;
  shape.holes.push(roundedRectPath(new THREE.Path(), o.x1, o.y1, o.x2, o.y2, 0.008));
  const slotHole = new THREE.Path();
  slotHole.absarc(D.SLOT.x, D.SLOT.y, D.SLOT.r, 0, Math.PI * 2, true);
  shape.holes.push(slotHole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: D.T, bevelEnabled: false, curveSegments: 10 });
  const mesh = new THREE.Mesh(geo, M.body);
  mesh.position.z = D.FRONT - D.T;
  mesh.name = 'frontPanel';
  return mesh;
}

export function buildStation({ prices } = {}) {
  const root = new THREE.Group();
  root.name = 'station';
  const shell = new THREE.Group();   // các tấm vỏ (trong suốt ở chế độ cắt vách)
  shell.name = 'shell';
  root.add(shell);

  const H = D.TOP - D.PLINTH, cy = D.PLINTH + H / 2;

  // ---- Bệ ----
  root.add(rbox(D.W + 0.08, D.PLINTH, D.DEPTH + 0.08, 0.012, M.rubber, { y: D.PLINTH / 2 }));

  // ---- Vỏ ----
  shell.add(buildFrontPanel());
  // vách hông: tấm phẳng khoét ô cho thùng rác mini âm vách
  for (const sx of [-1, 1]) {
    const hole = publicHole();
    const shape = new THREE.Shape();
    shape.moveTo(-D.DEPTH / 2, D.PLINTH); shape.lineTo(D.FRONT - D.T, D.PLINTH); shape.lineTo(D.FRONT - D.T, D.TOP);
    shape.lineTo(-D.DEPTH / 2, D.TOP); shape.lineTo(-D.DEPTH / 2, D.PLINTH);
    shape.holes.push(roundedRectPath(new THREE.Path(), hole.z1, hole.y1, hole.z2, hole.y2, 0.006));
    const side = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: D.T * 2, bevelEnabled: false, curveSegments: 6 }), M.body);
    side.rotation.y = -Math.PI / 2;               // (u, v) của shape -> (z, y) của trạm, bề dày -> -X
    side.position.x = sx > 0 ? D.W / 2 : -D.W / 2 + D.T * 2;
    side.name = `sidePanel_${sx > 0 ? 'right' : 'left'}`;
    shell.add(side);
  }
  shell.add(buildBackPanel(roundedRectPath));
  shell.add(box(D.W - 0.02, D.T, D.DEPTH - 0.02, M.body, { y: D.PLINTH + D.T / 2 }));      // đáy
  shell.add(box(D.W - 0.02, D.T, D.DEPTH - 0.02, M.body, { y: D.TOP - D.T / 2 }));         // trần
  // Mái che xanh nhô ra phía trước (che mưa cho người dùng)
  const roof = new THREE.Group();
  roof.add(rbox(D.W + 0.16, 0.06, D.DEPTH + 0.30, 0.02, M.green, { y: D.TOP + 0.03, z: 0.11 }));
  roof.add(rbox(D.W + 0.10, 0.03, D.DEPTH + 0.22, 0.01, M.greenDark, { y: D.TOP + 0.075, z: 0.09 }));
  shell.add(roof);
  // Dải ốp xanh dọc 2 cạnh mặt trước
  for (const sx of [-1, 1]) shell.add(box(0.05, H, 0.012, M.green, { x: sx * (D.W / 2 - 0.025), y: cy, z: D.FRONT + 0.006 }));

  // ---- Bảng hiệu phát sáng ----
  const signH = D.SIGN.y2 - D.SIGN.y1;
  const signMat = texMat(signTexture(), { emissive: 0.55, roughness: 0.35 });
  const sign = box(D.W - 0.14, signH, 0.04, [M.green, M.green, M.green, M.green, signMat, M.green],
    { y: (D.SIGN.y1 + D.SIGN.y2) / 2, z: D.FRONT + 0.02 });
  sign.name = 'sign';
  shell.add(sign);

  // ---- Tấm hướng dẫn ----
  const I = D.INFO;
  shell.add(rbox(I.w + 0.02, I.h + 0.02, 0.006, 0.006, M.green, { x: I.x, y: I.y, z: D.FRONT + 0.003 }));
  const info = plane(I.w, I.h, texMat(infoTexture(prices), { roughness: 0.6 }), { x: I.x, y: I.y, z: D.FRONT + 0.0065 });
  info.name = 'infoPanel';
  shell.add(info);

  // ---- Nhãn khoang nạp (trên cửa) ----
  const lbl = plane(0.62, 0.075, texMat(labelTexture('KHOANG NẠP CHAI NHỰA · LON', { bg: '#166534', size: 70, w: 1400, h: 170 }), { emissive: 0.25 }),
    { y: D.DOOR.y2 + 0.07, z: D.FRONT + 0.002 });
  lbl.name = 'intakeLabel';
  shell.add(lbl);
  const how = plane(0.62, 0.05, texMat(labelTexture('Bỏ vào · đóng cửa · máy tự quét & tính tiền', { bg: '#f3f5f4', fg: '#14532d', size: 56, w: 1400, h: 110, weight: 600 })),
    { y: D.DOOR.y2 + 0.135, z: D.FRONT + 0.002 });
  shell.add(how);

  // ---- Thanh đèn trạng thái ----
  const S = D.STATUS;
  root.add(rbox(S.w + 0.03, S.h + 0.02, 0.01, 0.005, M.trim, { y: S.y, z: D.FRONT + 0.005 }));
  const status = box(S.w, S.h, 0.004, emissive(COLORS.green, 1.1), { y: S.y, z: D.FRONT + 0.011 });
  status.name = 'statusBar';
  root.add(status);

  // ---- Đèn cảnh báo đỏ: 2 đèn xoay góc trên + viền đỏ quanh cửa ----
  const beacons = [];
  for (const sx of [-1, 1]) {
    const b = new THREE.Group();
    b.position.set(sx * (D.W / 2 - 0.09), D.TOP + 0.09, D.FRONT - 0.05);
    b.add(box(0.07, 0.02, 0.07, M.trim, { y: 0.01 }));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.035, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x7f1d1d, emissive: COLORS.red, emissiveIntensity: 0.05, roughness: 0.25, transparent: true, opacity: 0.92 }));
    dome.position.y = 0.02;
    b.add(dome);
    const light = new THREE.PointLight(0xff2020, 0, 2.2, 2);
    light.position.y = 0.05;
    b.add(light);
    root.add(b);
    beacons.push({ dome, light });
  }
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x4b5563, emissive: COLORS.red, emissiveIntensity: 0, roughness: 0.4 });
  const o = D.DOOR, fz = D.FRONT + 0.004, ft = 0.012;
  const doorFrame = new THREE.Group();
  doorFrame.add(box(o.x2 - o.x1 + 0.05, ft, 0.006, frameMat, { y: o.y2 + 0.022, z: fz }));
  doorFrame.add(box(o.x2 - o.x1 + 0.05, ft, 0.006, frameMat, { y: o.y1 - 0.022, z: fz }));
  doorFrame.add(box(ft, o.y2 - o.y1 + 0.056, 0.006, frameMat, { x: o.x1 - 0.022, y: (o.y1 + o.y2) / 2, z: fz }));
  doorFrame.add(box(ft, o.y2 - o.y1 + 0.056, 0.006, frameMat, { x: o.x2 + 0.022, y: (o.y1 + o.y2) / 2, z: fz }));
  root.add(doorFrame);

  // ---- Logo tái chế 2 hông + khe thông gió ----
  const decal = sideDecalTexture();
  for (const sx of [-1, 1]) {
    const d = plane(0.62, 0.62, new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.5 }),
      { x: sx * (D.W / 2 + 0.003), y: 1.62, z: -0.15 });
    d.rotation.y = sx * Math.PI / 2;
    shell.add(d);
    for (let i = 0; i < 8; i++) {
      shell.add(box(0.004, 0.01, 0.34, M.trim, { x: sx * (D.W / 2 + 0.001), y: 2.05 + i * 0.026, z: -0.25 }));
    }
  }
  // Mặt trước phần dưới: bảng giá nhỏ + logo
  const lower = plane(0.7, 0.42, new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 0.5 }),
    { y: 0.56, z: D.FRONT + 0.002 });
  shell.add(lower);

  // ---- Cửa khoang nạp ----
  const door = buildDoor();
  root.add(door.pivot, ...door.extras);

  // ---- Lỗ từ thiện ----
  const slot = buildSlot();
  root.add(slot.group, slot.tube);

  // ---- Cửa sau ----
  const rear = buildRearDoor();
  root.add(rear.pivot);

  // ---- Màn hình ----
  const panel = buildPanel();
  root.add(panel.plate, panel.mount);

  // ---- 2 thùng rác mini âm vách hông ----
  const pub = buildPublicBins();
  root.add(pub.group);

  enableShadows(root);
  door.glass.castShadow = false;
  slot.tube.traverse((m) => { if (m.isMesh && m.material.transparent) { m.castShadow = false; m.receiveShadow = false; } });

  return {
    root,
    shell,
    parts: {
      door: door.pivot, doorHandle: door.handle, doorLockLed: door.lockLed, doorFrame, doorFrameMat: frameMat,
      screenMount: panel.mount, screen: panel.screen,
      statusBar: status, sign, infoPanel: info, beacons,
      slot: slot.group, slotFront: slot.group.getObjectByName('slotFront'), slotFlap: slot.flap, slotLed: slot.led,
      slotTube: slot.tube,
      rearDoor: rear.pivot, rearLock: rear.lock,
      publicBins: pub.bins,
    },
  };
}
