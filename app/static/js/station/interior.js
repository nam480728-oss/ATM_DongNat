// Cơ cấu bên trong trạm: mặt phẳng rung, camera quét + đèn LED vòng, máng trượt, kho chứa
import * as THREE from 'three';
import { D } from './dims.js';
import { M, emissive } from './materials.js';
import { box, cyl, openBox, rbox } from './helpers.js';

// Mặt phẳng rung (tâm, kích thước) – nằm ngay dưới khay nạp
export const PLATE = { y: 0.55, z: 0.04, w: 0.70, d: 0.42, tilt: THREE.MathUtils.degToRad(30) };
// Kho chứa phía sau, dưới đáy
// Thùng chứa phía sau, dưới đáy – rút ra qua cửa sau (rộng 71 cm vừa lỗ cửa 72 cm)
export const BIN = { x1: -0.355, x2: 0.355, z1: -0.35, z2: -0.11, y1: D.PLINTH + D.T, y2: 0.47 };
// Camera quét: gắn trần buồng quét, phía sau khay, nhìn xuống mặt phẳng
export const SCAN_LAYER = 1;
export const SCAN_CAM = { pos: [0, 0.84, -0.13], fov: 92, w: 640, h: 480 };

export function buildInterior() {
  const g = new THREE.Group();
  g.name = 'interior';

  // ---- Khung đỡ ----
  const frame = M.steel;
  for (const sx of [-1, 1]) {
    g.add(box(0.02, 0.5, 0.02, frame, { x: sx * 0.38, y: 0.30, z: PLATE.z + PLATE.d / 2 }));
    g.add(box(0.02, 0.5, 0.02, frame, { x: sx * 0.38, y: 0.30, z: PLATE.z - PLATE.d / 2 }));
  }
  // Trục quay của mặt phẳng
  const axle = cyl(0.008, 0.008, 0.78, M.steel, { y: PLATE.y - 0.03, z: PLATE.z });
  axle.rotation.z = Math.PI / 2;
  g.add(axle);

  // ---- Mặt phẳng rung (pivot quanh trục X tại tâm) ----
  const plate = new THREE.Group();
  plate.name = 'vibratePlate';
  plate.position.set(0, PLATE.y, PLATE.z);
  const plateMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.75, metalness: 0.2 });
  plate.add(box(PLATE.w, 0.012, PLATE.d, plateMat, { y: -0.006 }));
  // thành chắn 2 bên (trước/sau để hở cho rác trượt ra)
  for (const sx of [-1, 1]) plate.add(box(0.01, 0.05, PLATE.d, M.steel, { x: sx * (PLATE.w / 2 - 0.005), y: 0.025 }));
  // motor rung bên dưới
  const motor = cyl(0.035, 0.035, 0.09, M.trim, { y: -0.045 });
  motor.rotation.z = Math.PI / 2;
  plate.add(motor);
  plate.add(box(0.12, 0.02, 0.08, M.trim, { y: -0.02 }));
  g.add(plate);

  // ---- Camera + đèn LED vòng ----
  const cam = new THREE.Group();
  cam.name = 'scanCamera';
  cam.position.set(...SCAN_CAM.pos);
  cam.add(box(0.07, 0.045, 0.05, M.rubber));
  // (Object3D.lookAt hướng trục +Z về mục tiêu -> ống kính đặt theo +Z)
  const lens = cyl(0.014, 0.016, 0.02, new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.05, metalness: 0.8 }), { z: 0.032 });
  lens.rotation.x = Math.PI / 2;
  cam.add(lens);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 10, 40), emissive(0xffffff, 0));
  ring.name = 'ledRing';
  ring.position.z = 0.03;
  cam.add(ring);
  // đèn báo đang chụp (đỏ nhỏ) như camera thật
  const rec = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), emissive(0xff2d2d, 0));
  rec.name = 'recLed';
  rec.position.set(0.026, 0.016, 0.026);
  cam.add(rec);
  cam.lookAt(0, PLATE.y, PLATE.z);
  g.add(cam);
  // giá treo camera: thanh ngang gắn vào vách sau
  const armLen = SCAN_CAM.pos[2] + D.FRONT;
  g.add(box(0.02, 0.02, armLen, M.steel, { x: 0, y: SCAN_CAM.pos[1] + 0.012, z: SCAN_CAM.pos[2] - armLen / 2 }));

  // Đèn chiếu sáng buồng quét (bật khi chụp)
  const light = new THREE.SpotLight(0xffffff, 0, 1.6, THREE.MathUtils.degToRad(60), 0.5, 1.2);
  light.position.set(SCAN_CAM.pos[0], SCAN_CAM.pos[1] - 0.04, SCAN_CAM.pos[2]);
  light.target.position.set(0, PLATE.y, PLATE.z);
  light.name = 'scanLight';
  g.add(light, light.target);

  // ---- Máng trượt trước: từ mép trước mặt phẳng xuống ngăn trả rác ----
  const chute = box(0.66, 0.008, 0.16, M.steel, { y: 0.44, z: 0.30 });
  chute.rotation.x = THREE.MathUtils.degToRad(-35);
  chute.name = 'returnChute';
  g.add(chute);

  // ---- Thùng chứa phía sau (kéo ra phía sau trên ray) ----
  const bin = new THREE.Group();
  bin.name = 'storageBin';
  bin.userData.closedZ = 0;
  const bw = BIN.x2 - BIN.x1, bd = BIN.z2 - BIN.z1, bh = BIN.y2 - BIN.y1;
  const shell = openBox(bw, bh, bd, 0.008, new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 }), { openTop: true });
  shell.position.set(0, BIN.y1, BIN.z2);
  bin.add(shell);
  // khối "đống rác" thể hiện mức đầy kho
  const fill = rbox(bw - 0.03, 1, bd - 0.03, 0.01, new THREE.MeshStandardMaterial({ color: 0x9fb8c9, roughness: 0.5, metalness: 0.4 }),
    { y: BIN.y1, z: (BIN.z1 + BIN.z2) / 2 });
  fill.name = 'storageFill';
  fill.scale.y = 0.0001;
  bin.add(fill);
  // tay kéo ở mặt sau thùng + nhãn
  const pull = box(0.22, 0.03, 0.025, M.trim, { y: BIN.y2 - 0.07, z: BIN.z1 - 0.012 });
  pull.name = 'binHandle';
  bin.add(pull);
  for (const sx of [-1, 1]) bin.add(box(0.02, 0.03, 0.02, M.trim, { x: sx * 0.1, y: BIN.y2 - 0.07, z: BIN.z1 - 0.004 }));
  g.add(bin);
  // máng nghiêng sau dẫn rác vào thùng (gắn cố định vào khung)
  const backChute = box(0.66, 0.008, 0.12, M.steel, { y: 0.49, z: -0.17 });
  backChute.rotation.x = THREE.MathUtils.degToRad(35);
  g.add(backChute);

  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // ---- Vách buồng quét kín (chỉ camera quét nhìn thấy – layer 1) ----
  // Người xem mô phỏng không thấy vách này nên chế độ cắt lớp vẫn nhìn được vào trong.
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.95, side: THREE.BackSide });
  const lz1 = -0.22, lz2 = D.FRONT - D.T - 0.005, ly1 = 0.40, ly2 = 0.865;
  const liner = new THREE.Mesh(new THREE.BoxGeometry(0.82, ly2 - ly1, lz2 - lz1), linerMat);
  liner.position.set(0, (ly1 + ly2) / 2, (lz1 + lz2) / 2);
  liner.layers.set(SCAN_LAYER);
  liner.name = 'scanChamberLiner';
  g.add(liner);

  return { group: g, plate, camera: cam, ring, rec, light, fill, fillBaseY: BIN.y1, bin };
}

/** Cập nhật mức đầy kho (0..1) */
export function setStorageLevel(fill, ratio) {
  const h = Math.max(0.0001, Math.min(1, ratio) * (BIN.y2 - BIN.y1 - 0.03));
  fill.scale.y = h;
  fill.position.y = BIN.y1 + h / 2 + 0.008;
}
