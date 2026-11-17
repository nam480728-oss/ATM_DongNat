// Lỗ bỏ từng chai/lon (Ø11 cm) phía trên cửa nạp: viền + nắp servo + đèn báo + ống dẫn bên trong.
// Vật đi: lỗ -> ống ngang ra sau -> rơi xuống ống đứng -> tấm hắt -> mặt phẳng quét (cảm biến hồng ngoại cuối máng).
import * as THREE from 'three';
import { D } from './dims.js';
import { M, emissive, COLORS } from './materials.js';
import { box, cyl, plane, texMat } from './helpers.js';
import { slotLabelTexture } from './textures.js';

export const SLOT_OUTLET_Y = 0.70;           // miệng dưới ống đứng
export const SLOT_FLAP_OPEN = 1.45;          // góc nắp khi mở (lật vào trong)

export function buildSlot() {
  const S = D.SLOT;
  const g = new THREE.Group();
  g.name = 'slot';

  // ---- Mặt trước: vành thép + đế xanh ----
  const front = new THREE.Group();
  front.name = 'slotFront';
  front.position.set(S.x, S.y, D.FRONT);
  const collar = new THREE.Mesh(new THREE.RingGeometry(S.r, S.r + 0.028, 48), M.green);
  collar.position.z = 0.0012;
  front.add(collar);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(S.r + 0.004, 0.0055, 12, 48), M.steel);
  rim.position.z = 0.003;
  front.add(rim);
  // ống lót miệng lỗ (nhìn vào thấy tối)
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.8, side: THREE.DoubleSide });
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(S.r, S.r, 0.05, 40, 1, true), sleeveMat);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = -0.025;
  front.add(sleeve);

  // ---- Nắp servo: bản lề ở mép trên, lật vào trong khi mở ----
  const flap = new THREE.Group();
  flap.name = 'slotFlap';
  flap.position.set(0, S.r - 0.002, -0.012);
  const flapMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(S.r - 0.003, 40), flapMat);
  disc.position.y = -(S.r - 0.002);
  flap.add(disc);
  // gân + logo nhỏ trên nắp
  const rib = box(0.05, 0.004, 0.003, M.trim, { y: -(S.r - 0.002), z: 0.002 });
  flap.add(rib);
  front.add(flap);
  g.add(front);

  // ---- Nhãn + đèn báo (xanh = mời bỏ, đỏ = đang bận / tạm ngưng) ----
  const lblX = S.x + 0.135;
  const label = plane(0.125, 0.0625, texMat(slotLabelTexture(), { roughness: 0.5 }), { x: lblX, y: S.y + 0.004, z: D.FRONT + 0.0012 });
  label.name = 'slotLabel';
  g.add(label);
  const ledBase = cyl(0.011, 0.011, 0.004, M.trim, { x: lblX, y: S.y - 0.048, z: D.FRONT + 0.002 });
  ledBase.rotation.x = Math.PI / 2;
  g.add(ledBase);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.0065, 24), emissive(COLORS.red, 2));
  led.name = 'slotLed';
  led.position.set(lblX, S.y - 0.048, D.FRONT + 0.0045);
  g.add(led);

  // ---- Ống dẫn bên trong (nhựa trong mờ để nhìn được ở chế độ cắt lớp) ----
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0xcfd8dc, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide,
  });
  const R = S.r + 0.004;
  const z0 = D.FRONT - D.T - 0.03, z1 = S.back;
  const hTube = new THREE.Mesh(new THREE.CylinderGeometry(R, R, z0 - z1, 36, 1, true), tubeMat);
  hTube.rotation.x = Math.PI / 2;
  hTube.position.set(S.x, S.y, (z0 + z1) / 2);
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), tubeMat);
  elbow.position.set(S.x, S.y, z1);
  const vTube = new THREE.Mesh(new THREE.CylinderGeometry(R, R, S.y - SLOT_OUTLET_Y, 36, 1, true), tubeMat);
  vTube.position.set(S.x, (S.y + SLOT_OUTLET_Y) / 2, z1);
  // tấm hắt dưới miệng ống: đưa vật trượt về phía trước lên mặt phẳng quét
  const deflector = box(0.13, 0.006, 0.13, M.steel, { x: S.x, y: SLOT_OUTLET_Y - 0.035, z: z1 + 0.035 });
  deflector.rotation.x = THREE.MathUtils.degToRad(32);
  deflector.name = 'slotDeflector';
  // cảm biến hồng ngoại cuối máng (2 mắt đối diện)
  const ir = [-1, 1].map((sx) => box(0.012, 0.012, 0.02, M.trim, { x: S.x + sx * (R + 0.006), y: SLOT_OUTLET_Y - 0.01, z: z1 }));
  // đai + giá treo ống vào vách
  const strap = cyl(R + 0.006, R + 0.006, 0.02, M.steel, { x: S.x, y: 1.0, z: z1, seg: 36 });
  const wallZ = -D.FRONT + D.T;
  const bracket = box(0.02, 0.02, z1 - R - wallZ + 0.004, M.steel, { x: S.x, y: 1.0, z: (z1 - R + wallZ) / 2 });
  const tube = new THREE.Group();
  tube.name = 'slotTube';
  tube.add(hTube, elbow, vTube, deflector, ...ir, strap, bracket);
  [hTube, elbow, vTube].forEach((m) => { m.castShadow = false; m.renderOrder = 2; });

  return { group: g, flap, led, tube, sleeve };
}
