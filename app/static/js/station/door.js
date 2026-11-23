// Cửa nạp: kính mờ, mở sang ngang (bản lề dọc cạnh trái, quay ra ngoài về bên trái)
import * as THREE from 'three';
import { D } from './dims.js';
import { M, emissive, COLORS } from './materials.js';
import { box, cyl } from './helpers.js';

export const DOOR_OPEN_ANGLE = THREE.MathUtils.degToRad(-100);

export function buildDoor() {
  const { x1, x2, y1, y2 } = D.DOOR;
  const W = x2 - x1 + 0.02, H = y2 - y1 + 0.02, TH = 0.014, F = 0.035;

  // Pivot nằm đúng trục bản lề
  const pivot = new THREE.Group();
  pivot.name = 'door';
  pivot.position.set(x1 - 0.01, (y1 + y2) / 2, D.FRONT);

  const leaf = new THREE.Group();
  leaf.position.set(0, 0, TH / 2);
  pivot.add(leaf);

  // Khung xanh
  leaf.add(box(W, F, TH, M.green, { x: W / 2, y: H / 2 - F / 2 }));
  leaf.add(box(W, F, TH, M.green, { x: W / 2, y: -H / 2 + F / 2 }));
  leaf.add(box(F, H, TH, M.green, { x: F / 2 }));
  leaf.add(box(F, H, TH, M.green, { x: W - F / 2 }));
  // Kính mờ
  const glass = box(W - 2 * F + 0.004, H - 2 * F + 0.004, 0.006, M.glass, { x: W / 2 });
  glass.name = 'doorGlass';
  glass.userData.phys = 'kin';             // rác trên khay không văng ra khi cửa đóng
  leaf.add(glass);

  // Tay nắm dọc cạnh phải
  const handle = new THREE.Group();
  handle.name = 'doorHandle';
  handle.position.set(W - 0.045, 0, TH / 2);
  handle.add(cyl(0.008, 0.008, 0.20, M.steel, { z: 0.035 }));
  for (const y of [-0.085, 0.085]) {
    const s = cyl(0.006, 0.006, 0.035, M.steel, { y, z: 0.0175 });
    s.rotation.x = Math.PI / 2;
    handle.add(s);
  }
  leaf.add(handle);

  // Bản lề
  for (const y of [-H / 2 + 0.06, H / 2 - 0.06]) {
    pivot.add(cyl(0.008, 0.008, 0.05, M.steel, { y, z: 0.008 }));
  }

  // Đèn khóa điện từ (trên vỏ, cạnh phải cửa)
  const lockLed = new THREE.Mesh(new THREE.CircleGeometry(0.009, 24), emissive(COLORS.red, 2.2));
  lockLed.name = 'doorLockLed';
  lockLed.position.set(x2 + 0.035, (y1 + y2) / 2 + 0.06, D.FRONT + 0.0035);
  const lockBase = cyl(0.016, 0.016, 0.004, M.trim, { x: x2 + 0.035, y: (y1 + y2) / 2 + 0.06, z: D.FRONT + 0.001 });
  lockBase.rotation.x = Math.PI / 2;
  // Ổ khóa
  const latch = box(0.014, 0.05, 0.01, M.trim, { x: x2 + 0.035, y: (y1 + y2) / 2 - 0.01, z: D.FRONT + 0.005 });

  return { pivot, handle, glass, lockLed, extras: [lockBase, lockLed, latch] };
}
