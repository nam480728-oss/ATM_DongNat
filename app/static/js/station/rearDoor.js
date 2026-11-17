// Cửa sau (nhân viên thu gom): bản lề dọc mép phải (nhìn từ phía sau), mở ra ngoài; khóa bằng chìa.
import * as THREE from 'three';
import { D } from './dims.js';
import { M } from './materials.js';
import { box, cyl, plane, texMat } from './helpers.js';
import { rearLabelTexture } from './textures.js';

export const REAR_OPEN_ANGLE = THREE.MathUtils.degToRad(-105);

export function buildRearDoor() {
  const { x1, x2, y1, y2 } = D.REAR;
  const W = x2 - x1 + 0.02, H = y2 - y1 + 0.02, TH = 0.016;

  // Pivot tại bản lề (x lớn = bên trái người đứng sau máy)
  const pivot = new THREE.Group();
  pivot.name = 'rearDoor';
  pivot.position.set(x2 + 0.01, (y1 + y2) / 2, -D.FRONT);

  const leaf = new THREE.Group();
  leaf.position.set(-W / 2, 0, -TH / 2);
  pivot.add(leaf);
  leaf.add(box(W, H, TH, M.body));
  // viền xanh trên/dưới
  leaf.add(box(W, 0.02, TH + 0.002, M.green, { y: H / 2 - 0.01 }));
  leaf.add(box(W, 0.02, TH + 0.002, M.green, { y: -H / 2 + 0.01 }));
  const lbl = plane(0.40, 0.10, texMat(rearLabelTexture(), { roughness: 0.55 }), { y: 0.09, z: -TH / 2 - 0.0008 });
  lbl.rotation.y = Math.PI;
  leaf.add(lbl);
  // khe thông gió
  for (let i = 0; i < 5; i++) leaf.add(box(0.28, 0.008, 0.004, M.trim, { y: -0.06 - i * 0.022, z: -TH / 2 - 0.001 }));

  // Ổ khóa chìa + tay nắm (phía mép tự do, x âm của leaf)
  const lock = new THREE.Group();
  lock.name = 'rearLock';
  lock.position.set(-W / 2 + 0.05, 0.0, -TH / 2);
  const barrel = cyl(0.014, 0.014, 0.012, M.steel, { z: -0.006 });
  barrel.rotation.x = Math.PI / 2;
  lock.add(barrel);
  const keyway = box(0.003, 0.012, 0.002, M.rubber, { z: -0.0125 });
  keyway.name = 'rearKeyway';
  lock.add(keyway);
  const grip = box(0.022, 0.12, 0.014, M.trim, { y: -0.10, z: -0.012 });
  lock.add(grip);
  leaf.add(lock);

  // bản lề
  for (const y of [-H / 2 + 0.06, H / 2 - 0.06]) pivot.add(cyl(0.008, 0.008, 0.05, M.steel, { y, z: -0.008 }));

  return { pivot, lock, keyway };
}

/** Mặt lưng: tấm phẳng khoét lỗ cửa sau */
export function buildBackPanel(roundedRectPath) {
  const hw = D.W / 2 - 0.01;
  const R = D.REAR;
  const shape = new THREE.Shape();
  shape.moveTo(-hw, D.PLINTH); shape.lineTo(hw, D.PLINTH); shape.lineTo(hw, D.TOP); shape.lineTo(-hw, D.TOP); shape.lineTo(-hw, D.PLINTH);
  shape.holes.push(roundedRectPath(new THREE.Path(), R.x1, R.y1, R.x2, R.y2, 0.006));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: D.T, bevelEnabled: false, curveSegments: 6 });
  const mesh = new THREE.Mesh(geo, M.body);
  mesh.position.z = -D.FRONT;
  mesh.name = 'backPanel';
  return mesh;
}
