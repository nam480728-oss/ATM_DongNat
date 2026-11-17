// Mô hình 3D các loại rác (dựng bằng code). Mọi vật đặt NẰM trên mặt phẳng:
// gốc tọa độ = tâm vật, trục dài theo X, đáy chạm y = -size.y/2.
import * as THREE from 'three';

export const ITEM_TYPES = {
  bottle_500:  { name: 'Chai nhựa 500ml', group: 'bottle', valid: true },
  bottle_1500: { name: 'Chai nhựa 1,5L', group: 'bottle', valid: true },
  bottle_flat: { name: 'Chai nhựa dẹt', group: 'bottle', valid: true },
  can_tall:    { name: 'Lon nhôm cao', group: 'can', valid: true },
  can_short:   { name: 'Lon nhôm lùn', group: 'can', valid: true },
  milk_carton: { name: 'Hộp sữa giấy', group: 'other', valid: false },
  plastic_bag: { name: 'Túi nilon', group: 'other', valid: false },
  cup_straw:   { name: 'Cốc nhựa có ống hút', group: 'other', valid: false },
  glass_bottle:{ name: 'Chai thủy tinh', group: 'other', valid: false },
  foam_box:    { name: 'Hộp xốp', group: 'other', valid: false },
  paper_ball:  { name: 'Giấy vo', group: 'other', valid: false },
};

const LABEL_COLORS = ['#ef4444', '#2563eb', '#16a34a', '#f59e0b', '#7c3aed', '#0891b2', '#db2777'];
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function labelTex(color, text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 256, 64);
  g.fillStyle = 'rgba(255,255,255,.92)';
  g.font = '700 30px "Be Vietnam Pro", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 128, 33);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Thân chai bằng LatheGeometry: profile [bán kính, chiều cao] từ đáy lên miệng */
function bottleMesh({ r, h, neck = 0.25, glass = false, color = 0xcfe9f7 }) {
  const pts = [];
  const body = h * (1 - neck);
  pts.push(new THREE.Vector2(0.001, 0));
  pts.push(new THREE.Vector2(r * 0.85, 0));
  pts.push(new THREE.Vector2(r, r * 0.25));
  pts.push(new THREE.Vector2(r, body * 0.92));
  for (let i = 1; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector2(r - (r - r * 0.36) * Math.sin((t * Math.PI) / 2), body * 0.92 + (h * neck * 0.75) * t));
  }
  pts.push(new THREE.Vector2(r * 0.36, h * 0.97));
  pts.push(new THREE.Vector2(r * 0.33, h));
  const geo = new THREE.LatheGeometry(pts, 28);
  const mat = glass
    ? new THREE.MeshStandardMaterial({ color, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.88 })
    : new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.55, depthWrite: false });
  return new THREE.Mesh(geo, mat);
}

function wrapAndLay(inner, length) {
  // dựng đứng theo trục Y -> nằm ngang theo trục X, tâm tại gốc
  const g = new THREE.Group();
  inner.rotation.z = -Math.PI / 2;
  inner.position.x = -length / 2;
  g.add(inner);
  return g;
}

function makeBottle(r, h, opts = {}) {
  const inner = new THREE.Group();
  const body = bottleMesh({ r, h, ...opts });
  inner.add(body);
  if (!opts.glass) {
    const lbl = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.22, 28, 1, true),
      new THREE.MeshStandardMaterial({ map: labelTex(pick(LABEL_COLORS), pick(['AQUA', 'COLA', 'TEA', 'SODA', 'JUICE'])), roughness: 0.5, side: THREE.DoubleSide }));
    lbl.position.y = h * 0.42;
    inner.add(lbl);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.4, r * 0.4, h * 0.06, 20),
    new THREE.MeshStandardMaterial({ color: opts.glass ? 0xb8a14a : pick([0x1d4ed8, 0xdc2626, 0x16a34a, 0xf8fafc]), roughness: 0.4, metalness: opts.glass ? 0.7 : 0 }));
  cap.position.y = h + h * 0.03;
  inner.add(cap);
  return wrapAndLay(inner, h * 1.06);
}

function makeCan(r, h) {
  const inner = new THREE.Group();
  const color = pick(LABEL_COLORS);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h * 0.9, 32, 1, true),
    new THREE.MeshStandardMaterial({ map: labelTex(color, pick(['BEER', 'COLA', 'ENERGY', 'SODA', 'COFFEE'])), roughness: 0.25, metalness: 0.6, side: THREE.DoubleSide }));
  side.position.y = h / 2;
  inner.add(side);
  const alu = new THREE.MeshStandardMaterial({ color: 0xd4d8dd, roughness: 0.22, metalness: 1 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.86, r, h * 0.05, 32), alu);
  top.position.y = h * 0.975;
  const bottom = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.86, h * 0.05, 32), alu);
  bottom.position.y = h * 0.025;
  inner.add(top, bottom);
  return wrapAndLay(inner, h);
}

function crumpled(radius, color, { opacity = 1, roughness = 0.9, scale = [1, 1, 1] } = {}) {
  const geo = new THREE.IcosahedronGeometry(radius, 2);
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.multiplyScalar(0.78 + Math.random() * 0.36);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color, roughness, transparent: opacity < 1, opacity, flatShading: true,
  }));
  m.scale.set(...scale);
  return m;
}

function makeCarton() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 256);
  g.fillStyle = '#2563eb'; g.fillRect(0, 150, 128, 106);
  g.fillStyle = '#1e3a8a'; g.font = '800 34px Arial'; g.textAlign = 'center'; g.fillText('MILK', 64, 120);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.045, 0.065), new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 }));
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.07, 8), new THREE.MeshStandardMaterial({ color: 0xfacc15 }));
  straw.rotation.z = Math.PI / 2; straw.position.set(0.02, 0.026, 0.01);
  const g2 = new THREE.Group(); g2.add(box, straw);
  return g2;
}

function makeCup() {
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.026, 0), new THREE.Vector2(0.042, 0.11), new THREE.Vector2(0.044, 0.112)];
  const cup = new THREE.Mesh(new THREE.LatheGeometry(pts, 24),
    new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.2, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.008, 24), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3 }));
  lid.position.y = 0.114;
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.16, 8), new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.4 }));
  straw.position.set(0.01, 0.13, 0); straw.rotation.z = 0.15;
  const inner = new THREE.Group(); inner.add(cup, lid, straw);
  return wrapAndLay(inner, 0.12);
}

function makeFoam() {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xfafaf9, roughness: 0.95 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.14), mat);
  base.position.y = -0.012;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.025, 0.14), mat);
  lid.position.y = 0.018;
  g.add(base, lid);
  return g;
}

const BUILDERS = {
  bottle_500: () => makeBottle(0.032, 0.20),
  bottle_1500: () => makeBottle(0.045, 0.30),
  bottle_flat: () => { const b = makeBottle(0.036, 0.21); b.scale.set(1, 0.62, 1.25); return b; },
  can_tall: () => makeCan(0.029, 0.155),
  can_short: () => makeCan(0.033, 0.115),
  milk_carton: makeCarton,
  plastic_bag: () => crumpled(0.06, 0xf8fafc, { opacity: 0.75, roughness: 0.4, scale: [1.2, 0.6, 1] }),
  cup_straw: makeCup,
  glass_bottle: () => makeBottle(0.033, 0.23, { glass: true, color: pick([0x166534, 0x78350f, 0x0f766e]) }),
  foam_box: makeFoam,
  paper_ball: () => crumpled(0.04, 0xe7e2d3, { roughness: 1 }),
};

let seq = 0;
/** Tạo 1 vật rác. Trả về Group có userData {type, id, size(Vector3 kích thước AABB)} */
export function createItem(type) {
  const obj = BUILDERS[type]();
  const root = new THREE.Group();
  root.add(obj);
  // Căn tâm AABB về gốc
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  obj.position.sub(center);
  const size = box.getSize(new THREE.Vector3());
  root.userData = { item: true, type, id: ++seq, size, action: 'item', hint: () => 'Lấy vật này ra' };
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return root;
}
