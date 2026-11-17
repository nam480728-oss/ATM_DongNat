// Ngăn trả rác ở đáy máy: kéo ra như hộc tủ
import * as THREE from 'three';
import { D } from './dims.js';
import { M, emissive, COLORS } from './materials.js';
import { box, cyl, openBox, plane, texMat } from './helpers.js';
import { labelTexture } from './textures.js';

export function buildReturnDrawer() {
  const { x1, x2, y1, y2, depth } = D.RETURN;
  const W = x2 - x1 - 0.006, H = y2 - y1 - 0.006;

  const group = new THREE.Group();
  group.name = 'returnDrawer';
  group.position.set(0, y1 + 0.003, D.FRONT);
  group.userData.closedZ = group.position.z;

  // Mặt ngăn kéo
  group.add(box(W, H, 0.02, M.body, { y: H / 2, z: -0.01 }));
  group.add(box(W, 0.02, 0.021, M.green, { y: H - 0.01, z: -0.0095 }));
  const lbl = plane(0.30, 0.05, texMat(labelTexture('RÁC TRẢ LẠI', { bg: '#ffffff', fg: '#b45309', size: 96, weight: 800 })),
    { y: H * 0.42, z: 0.0006 });
  group.add(lbl);

  // Đèn báo có rác trả (nhấp nháy)
  const led = box(0.30, 0.008, 0.004, emissive(COLORS.amber, 0), { y: H * 0.42 + 0.045, z: 0.002 });
  led.name = 'returnLed';
  led.material.emissiveIntensity = 0;
  group.add(led);

  // Tay nắm âm (thanh ngang)
  const handle = new THREE.Group();
  handle.name = 'returnHandle';
  handle.position.set(0, H * 0.18, 0);
  const bar = cyl(0.008, 0.008, 0.26, M.steel, { z: 0.03 });
  bar.rotation.z = Math.PI / 2;
  handle.add(bar);
  for (const x of [-0.12, 0.12]) {
    const s = cyl(0.006, 0.006, 0.03, M.steel, { x, z: 0.015 });
    s.rotation.x = Math.PI / 2;
    handle.add(s);
  }
  group.add(handle);

  // Thân ngăn (hở nóc để rác từ máng rơi xuống)
  const body = openBox(W - 0.03, H - 0.03, depth, 0.008, M.trayPlastic, { openTop: true });
  body.position.set(0, 0.006, -0.02);
  group.add(body);
  // Lòng ngăn (hệ tọa độ group) để đặt rác bị trả
  group.userData.inner = { x1: -(W - 0.03) / 2 + 0.01, x2: (W - 0.03) / 2 - 0.01, z1: -0.02 - depth + 0.01, z2: -0.03, floor: 0.014 };

  return { group, handle, led };
}

export function buildReturnCavity() {
  const { x1, x2, y1, y2, depth } = D.RETURN;
  // Không có nóc: rác từ máng trượt rơi xuống ngăn
  const cav = openBox(x2 - x1, y2 - y1, depth + 0.04, 0.01, M.cavity, { openTop: true });
  cav.position.set(0, y1, D.FRONT - D.T);
  cav.name = 'returnCavity';
  return cav;
}
