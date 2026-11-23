// Lỗ từ thiện (Ø11 cm) bên trái cửa: miệng loe + nắp servo + đèn báo + ống CHÚC XUỐNG bên trong.
// Vật đi: lỗ -> ống nghiêng (trượt nhờ trọng lực) -> rơi vào miệng phễu nón -> băng chuyền (cảm biến hồng ngoại cuối ống).
import * as THREE from 'three';
import { D } from './dims.js';
import { M, emissive, COLORS } from './materials.js';
import { box, cyl, plane, texMat } from './helpers.js';
import { slotLabelTexture } from './textures.js';

export const SLOT_FLAP_OPEN = 1.45;          // góc nắp khi mở (lật vào trong)

/** Điểm đầu (sau mặt trước) và cuối (trên băng chuyền) của ống, tọa độ trạm */
export function slotPath() {
  const S = D.SLOT;
  const a = new THREE.Vector3(S.x, S.y, D.FRONT - D.T - 0.02);
  const b = new THREE.Vector3(...S.outlet);
  return { a, b, dir: b.clone().sub(a).normalize(), len: a.distanceTo(b) };
}

export function buildSlot() {
  const S = D.SLOT;
  const g = new THREE.Group();
  g.name = 'slot';

  // ---- Mặt trước: miệng loe chúc xuống + vành thép + đế hồng ----
  const front = new THREE.Group();
  front.name = 'slotFront';
  front.position.set(S.x, S.y, D.FRONT);
  const collar = new THREE.Mesh(new THREE.RingGeometry(S.r, S.r + 0.03, 48), new THREE.MeshStandardMaterial({ color: 0xdb2777, roughness: 0.4 }));
  collar.position.z = 0.0012;
  front.add(collar);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(S.r + 0.004, 0.006, 12, 48), M.steel);
  rim.position.z = 0.004;
  front.add(rim);
  // mái che phía trên miệng (che mưa, hướng vật đi xuống)
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(S.r + 0.03, S.r + 0.03, 0.07, 32, 1, true, -Math.PI / 2, Math.PI),
    new THREE.MeshStandardMaterial({ color: 0xbe185d, roughness: 0.45, side: THREE.DoubleSide }));
  hood.rotation.x = Math.PI / 2;
  hood.rotation.y = Math.PI / 2;
  hood.position.z = 0.035;
  front.add(hood);
  // ống lót miệng lỗ nghiêng theo hướng ống (nhìn vào thấy dốc xuống)
  const { a, dir } = slotPath();
  const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x15191d, roughness: 0.8, side: THREE.DoubleSide });
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(S.r, S.r, 0.06, 40, 1, true), sleeveMat);
  sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().negate());
  sleeve.position.set(0, 0, -0.03);
  front.add(sleeve);

  // ---- Nắp servo: bản lề mép trên, lật vào trong khi mở ----
  const flap = new THREE.Group();
  flap.name = 'slotFlap';
  flap.position.set(0, S.r - 0.002, -0.012);
  const flapMat = new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(S.r - 0.003, 40), flapMat);
  disc.position.y = -(S.r - 0.002);
  flap.add(disc);
  flap.add(box(0.05, 0.004, 0.003, M.trim, { y: -(S.r - 0.002), z: 0.002 }));
  front.add(flap);
  g.add(front);

  // ---- Nhãn + đèn báo ----
  const label = plane(0.16, 0.08, texMat(slotLabelTexture(), { roughness: 0.5 }), { x: S.x, y: S.y - 0.15, z: D.FRONT + 0.0012 });
  label.name = 'slotLabel';
  g.add(label);
  const ledBase = cyl(0.011, 0.011, 0.004, M.trim, { x: S.x + 0.11, y: S.y, z: D.FRONT + 0.002 });
  ledBase.rotation.x = Math.PI / 2;
  g.add(ledBase);
  const led = new THREE.Mesh(new THREE.CircleGeometry(0.0065, 24), emissive(COLORS.red, 2));
  led.name = 'slotLed';
  led.position.set(S.x + 0.11, S.y, D.FRONT + 0.0045);
  g.add(led);

  // ---- Ống nghiêng bên trong (nhựa trong mờ để nhìn được khi cắt vách) ----
  const tubeMat = new THREE.MeshStandardMaterial({
    color: 0xcfd8dc, roughness: 0.25, metalness: 0.1, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide,
  });
  const R = S.r + 0.006;
  const { len, b } = slotPath();
  const tubeMesh = new THREE.Mesh(new THREE.CylinderGeometry(R, R, len, 36, 1, true), tubeMat);
  tubeMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  tubeMesh.position.copy(a).add(b).multiplyScalar(0.5);
  // cảm biến hồng ngoại cuối ống (2 mắt đối diện) + đai treo
  const ir = [-1, 1].map((sx) => box(0.012, 0.012, 0.02, M.trim, { x: b.x + sx * (R + 0.006), y: b.y + 0.01, z: b.z }));
  const mid = a.clone().lerp(b, 0.5);
  const strap = cyl(R + 0.006, R + 0.006, 0.02, M.steel, { x: mid.x, y: mid.y, z: mid.z, seg: 36 });
  strap.quaternion.copy(tubeMesh.quaternion);
  const wallX = -D.W / 2 + D.T * 2;
  const bracket = box(mid.x - R - wallX, 0.02, 0.02, M.steel, { x: (mid.x - R + wallX) / 2, y: mid.y, z: mid.z });
  const tube = new THREE.Group();
  tube.name = 'slotTube';
  tube.add(tubeMesh, ...ir, strap, bracket);
  tubeMesh.castShadow = false;
  tubeMesh.renderOrder = 2;

  return { group: g, flap, led, tube, sleeve };
}
