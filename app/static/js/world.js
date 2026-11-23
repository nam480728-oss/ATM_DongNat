// Đồ trang trí đường phố (cây, cọ, ghế, đèn đường, dù bãi biển...) + ánh sáng mặt trời.
// Vật liệu dùng chung (module-level) để street.js gộp mesh theo vật liệu được nhiều nhất (ít draw call).
import * as THREE from 'three';

const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
export const WM = {
  bark: std(0x6b4f3a, { roughness: 0.95 }),
  palmBark: std(0x8b6f4e, { roughness: 0.95 }),
  leaf: std(0x3f8f3a, { flatShading: true }),
  leaf2: std(0x2f7a32, { flatShading: true }),
  palmLeaf: std(0x3f9142, { flatShading: true, side: THREE.DoubleSide }),
  curb: std(0x9ca3af, { roughness: 0.9 }),
  soil: std(0x4a3b2c, { roughness: 1 }),
  pot: std(0x57534e, { roughness: 0.8 }),
  bush: std(0x4d9a45, { roughness: 0.9, flatShading: true }),
  wood: std(0xa16207, { roughness: 0.7 }),
  iron: std(0x27272a, { roughness: 0.5, metalness: 0.6 }),
  lamp: std(0x1f2937, { roughness: 0.5, metalness: 0.7 }),
  lampGlass: std(0xfffbeb, { emissive: 0xfff3c4, emissiveIntensity: 0.25, roughness: 0.3 }),
  white: std(0xf8fafc, { roughness: 0.6 }),
  pole: std(0xe5e7eb, { roughness: 0.4, metalness: 0.3 }),
  chair: std(0xf5f5f4, { roughness: 0.6 }),
  umbrellaA: std(0xef4444, { side: THREE.DoubleSide, flatShading: true }),
  umbrellaB: std(0x2563eb, { side: THREE.DoubleSide, flatShading: true }),
  umbrellaC: std(0xf59e0b, { side: THREE.DoubleSide, flatShading: true }),
  towelA: std(0xf472b6), towelB: std(0x22d3ee), towelC: std(0xfde047),
  lifeguard: std(0xdc2626, { roughness: 0.6 }),
};

export function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function tree(x, z, scale = 1) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.11, 2.2, 8), WM.bark, 0, 1.1, 0));
  const blobs = [[0, 2.6, 0, 0.9], [0.55, 2.35, 0.2, 0.6], [-0.5, 2.4, -0.15, 0.65], [0.1, 3.05, -0.2, 0.6], [-0.2, 2.3, 0.45, 0.55]];
  blobs.forEach(([bx, by, bz, r], i) => g.add(mesh(new THREE.IcosahedronGeometry(r, 1), i % 2 ? WM.leaf2 : WM.leaf, bx, by, bz)));
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  return g;
}

/** Cây dừa / cọ ven biển: thân cong (nhiều đốt nghiêng dần) + tàu lá rủ */
export function palm(x, z, { h = 5.2, lean = 0.5, yaw = 0, y = 0 } = {}) {
  const g = new THREE.Group();
  const segs = 7;
  let px = 0, py = 0;
  for (let i = 0; i < segs; i++) {
    const t = i / segs, len = h / segs;
    const ang = lean * t * t;
    const s = mesh(new THREE.CylinderGeometry(0.1 - 0.035 * t, 0.13 - 0.035 * t, len * 1.04, 7), WM.palmBark);
    s.position.set(px + Math.sin(ang) * len / 2, py + Math.cos(ang) * len / 2, 0);
    s.rotation.z = -ang;
    g.add(s);
    px += Math.sin(ang) * len; py += Math.cos(ang) * len;
  }
  const crown = new THREE.Group();
  crown.position.set(px, py, 0);
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Group();
    const blade = mesh(new THREE.PlaneGeometry(0.42, 1.9, 1, 3), WM.palmLeaf);
    // tàu lá cong rủ xuống: dời các đỉnh theo parabol
    const pos = blade.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const v = (pos.getY(k) + 0.95) / 1.9;          // 0 gốc .. 1 ngọn
      pos.setZ(k, -v * v * 0.9);
      pos.setX(k, pos.getX(k) * (1 - v * 0.7));
    }
    blade.geometry.computeVertexNormals();
    blade.position.y = 0.95;
    blade.castShadow = true;
    leaf.add(blade);
    leaf.rotation.set(1.05 + (i % 2) * 0.25, (i / 9) * Math.PI * 2, 0, 'YXZ');
    crown.add(leaf);
  }
  crown.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), WM.palmBark));
  g.add(crown);
  g.position.set(x, y, z);
  g.rotation.y = yaw;
  return g;
}

export function planter(x, z) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.45, 0.45), WM.pot, 0, 0.225, 0));
  for (let i = 0; i < 5; i++) {
    g.add(mesh(new THREE.IcosahedronGeometry(0.22 + Math.random() * 0.06, 1), WM.bush, -0.56 + i * 0.28, 0.55, (Math.random() - 0.5) * 0.1));
  }
  g.position.set(x, 0, z);
  return g;
}

export function bench(x, z, rotY = 0) {
  const g = new THREE.Group();
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(1.5, 0.03, 0.11), WM.wood, 0, 0.45, -0.13 + i * 0.13));
  for (let i = 0; i < 2; i++) {
    const b = mesh(new THREE.BoxGeometry(1.5, 0.1, 0.03), WM.wood, 0, 0.62 + i * 0.13, -0.24);
    b.rotation.x = -0.15; g.add(b);
  }
  for (const sx of [-0.65, 0.65]) {
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.45, 0.42), WM.iron, sx, 0.225, -0.02));
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.4, 0.04), WM.iron, sx, 0.7, -0.25));
  }
  g.position.set(x, 0, z); g.rotation.y = rotY;
  return g;
}

export function streetLamp(x, z, rotY = 0) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 4, 8), WM.lamp, 0, 2, 0));
  const arm = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6), WM.lamp, 0, 3.95, 0.35);
  arm.rotation.x = Math.PI / 2; g.add(arm);
  g.add(mesh(new THREE.BoxGeometry(0.25, 0.08, 0.4), WM.lamp, 0, 3.92, 0.7));
  g.add(mesh(new THREE.BoxGeometry(0.2, 0.02, 0.32), WM.lampGlass, 0, 3.87, 0.7));
  g.position.set(x, 0, z); g.rotation.y = rotY;
  return g;
}

/** Dù bãi biển + 2 ghế nằm. Trả về group và vị trí ghế (để đặt người nằm phơi nắng) */
export function umbrellaSet(x, z, y, variant = 0) {
  const g = new THREE.Group();
  const cloth = [WM.umbrellaA, WM.umbrellaB, WM.umbrellaC][variant % 3];
  g.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.3, 6), WM.pole, 0, 1.15, 0));
  const top = mesh(new THREE.ConeGeometry(1.15, 0.42, 10, 1, true), cloth, 0, 2.15, 0);
  g.add(top);
  const seats = [];
  for (const sx of [-0.45, 0.45]) {
    g.add(mesh(new THREE.BoxGeometry(0.6, 0.06, 1.75), WM.chair, sx, 0.3, 0.55));
    const back = mesh(new THREE.BoxGeometry(0.6, 0.06, 0.6), WM.chair, sx, 0.5, -0.2);
    back.rotation.x = 0.7; g.add(back);
    for (const lz of [-0.2, 1.3]) g.add(mesh(new THREE.BoxGeometry(0.05, 0.28, 0.05), WM.chair, sx, 0.14, lz));
    seats.push({ x: x + sx, z: z + 0.6, y: y + 0.33 });
  }
  g.position.set(x, y, z);
  return { group: g, seats };
}

export function towel(x, z, y, variant = 0) {
  const m = mesh(new THREE.BoxGeometry(0.9, 0.01, 1.8), [WM.towelA, WM.towelB, WM.towelC][variant % 3], x, y + 0.005, z);
  m.castShadow = false;
  return m;
}

export function lifeguardTower(x, z, y) {
  const g = new THREE.Group();
  for (const [lx, lz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) g.add(mesh(new THREE.BoxGeometry(0.1, 2.2, 0.1), WM.white, lx, 1.1, lz));
  g.add(mesh(new THREE.BoxGeometry(1.5, 0.08, 1.5), WM.white, 0, 2.2, 0));
  g.add(mesh(new THREE.BoxGeometry(1.5, 0.9, 0.06), WM.lifeguard, 0, 2.7, -0.72));
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.9, 1.5), WM.lifeguard, -0.72, 2.7, 0));
  g.add(mesh(new THREE.BoxGeometry(0.06, 0.9, 1.5), WM.lifeguard, 0.72, 2.7, 0));
  const roof = mesh(new THREE.ConeGeometry(1.25, 0.6, 4), WM.lifeguard, 0, 3.45, 0);
  roof.rotation.y = Math.PI / 4; g.add(roof);
  g.position.set(x, y, z);
  return g;
}

export function buildLights(scene) {
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x8a7d6a, 0.55);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3df, 2.4);
  sun.position.set(-4, 7, 5);
  sun.target.position.set(0, 0.8, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  // bóng đổ sắc nét quanh trạm đang dùng (trạm luôn ở gốc tọa độ, khung phố dời theo)
  s.left = -6; s.right = 6; s.top = 5; s.bottom = -4; s.near = 1; s.far = 24;
  s.layers.enable(2);   // người đang dùng trạm (lớp riêng) cũng đổ bóng
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  return { sun, hemi };
}
