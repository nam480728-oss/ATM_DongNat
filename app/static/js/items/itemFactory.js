// Mô hình 3D các loại rác (dựng bằng code, vật liệu PBR + bao bì vẽ bằng canvas) – làm giống thật để model
// YOLO (train trên ảnh chụp thật) nhận diện được qua camera buồng quét.
// Mọi vật đặt NẰM trên mặt phẳng: gốc tọa độ = tâm vật, trục dài theo X, đáy chạm y = -size.y/2.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const ITEM_TYPES = {
  bottle_500:  { name: 'Chai nhựa 500ml', group: 'bottle', valid: true },
  bottle_1500: { name: 'Chai nhựa 1,5L', group: 'bottle', valid: true },
  bottle_flat: { name: 'Chai nhựa bẹp', group: 'bottle', valid: true },
  cup_straw:   { name: 'Cốc nhựa có ống hút', group: 'bottle', valid: true },
  can_tall:    { name: 'Lon nhôm cao', group: 'can', valid: true },
  can_short:   { name: 'Lon nhôm lùn', group: 'can', valid: true },
  can_dented:  { name: 'Lon nhôm móp', group: 'can', valid: true },
  milk_carton: { name: 'Hộp sữa giấy', group: 'other', valid: false },
  plastic_bag: { name: 'Túi nilon', group: 'other', valid: false },
  glass_bottle:{ name: 'Chai thủy tinh', group: 'other', valid: false },
  foam_box:    { name: 'Hộp xốp', group: 'other', valid: false },
  paper_ball:  { name: 'Giấy vo', group: 'other', valid: false },
  snack_bag:   { name: 'Vỏ bánh snack', group: 'other', valid: false },
  paper_cup:   { name: 'Ly giấy cà phê', group: 'other', valid: false },
};

const FONT = '"Be Vietnam Pro", "Segoe UI", Arial, sans-serif';
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------------ ảnh chụp thật (tools/tao_anh_that_3d.py)
// Ảnh cắt chai/lon/rác thật từ tập train, dán lên khối 3D theo hướng camera buồng quét nhìn xuống.
const REAL_BASE = '/static/textures/real/';
const REAL = await fetch(REAL_BASE + 'manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
function loadShared(file, srgb) {
  let t = texCache.get(file);
  if (!t) {
    t = texLoader.load(REAL_BASE + file);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.userData.shared = true;        // dùng chung giữa các vật -> không dispose khi bỏ vật
    texCache.set(file, t);
  }
  return t;
}
/** {map: ảnh vật, alpha: mặt nạ tách nền (trắng = vật)} */
const realTex = (entry) => ({ map: loadShared(entry.file, true), alpha: entry.mask ? loadShared(entry.mask, false) : null });
for (const list of Object.values(REAL)) list.forEach(realTex);   // tải trước để lúc chụp đã có ảnh
const realPick = (kind) => (REAL[kind]?.length ? pick(REAL[kind]) : null);

/** Gán UV chiếu từ trên xuống (theo hướng camera buồng quét) cho mọi mesh trong obj và phủ 1 vật liệu ảnh.
 *  Phần nền trong ảnh (mặt nạ = đen) bị cắt bỏ -> nhìn từ camera chỉ thấy đúng hình vật thật. */
function projectPhoto(obj, { map, alpha }, matOpts = {}) {
  obj.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  // Chiếu theo hướng nhìn của camera buồng quét (đặt phía sau, cao, chếch ~60° xuống): các điểm trên cùng 1 tia nhìn
  // có cùng toạ độ ảnh -> mặt bên hướng về camera không bị kéo dãn thành vệt.
  const K = 0.6;   // dz/dy dọc tia nhìn
  const key = (p) => p.z + K * p.y;
  let x0 = Infinity, x1 = -Infinity, k0 = Infinity, k1 = -Infinity;
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
      // chỉ lấy nửa trên (phần camera thấy) để ảnh khít với hình vật nhìn từ trên
      if (v.y >= 0) { k0 = Math.min(k0, key(v)); k1 = Math.max(k1, key(v)); }
    }
  });
  const mat = new THREE.MeshPhysicalMaterial({
    map, alphaMap: alpha, alphaTest: alpha ? 0.5 : 0,
    // Ảnh chụp đã có sẵn ánh sáng/bóng thật: phần lớn màu lấy thẳng từ ảnh (tự phát sáng, bỏ tone mapping),
    // đèn buồng quét chỉ thêm chút đổ bóng/ánh phản chiếu cho ra khối 3D.
    color: 0x5a5a5a, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.78, toneMapped: false,
    roughness: 0.35, metalness: 0, ...matOpts,
  });
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    const uv = new Float32Array(p.count * 2);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      // camera đặt phía sau (-z) nhìn về +z: mép xa (+z) là đỉnh ảnh, bên phải ảnh là -x
      uv[i * 2] = THREE.MathUtils.clamp((x1 - v.x) / (x1 - x0), 0.002, 0.998);
      uv[i * 2 + 1] = THREE.MathUtils.clamp((key(v) - k0) / (k1 - k0), 0.002, 0.998);
    }
    o.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    o.material = mat;
  });
  return obj;
}
/** Bán kính khối trụ sao cho hình chiếu (dài L, rộng 2r) đúng tỉ lệ ảnh -> ảnh không bị méo */
const radiusFor = (entry, L, lo, hi) => THREE.MathUtils.clamp(L / (2 * entry.aspect), lo, hi);

// ------------------------------------------------------------------ tiện ích canvas
function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function tex(c, { srgb = true, wrap = false } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (wrap) t.wrapS = THREE.RepeatWrapping;
  return t;
}
function barcode(g, x, y, w, h) {
  g.fillStyle = '#fff'; g.fillRect(x - 4, y - 4, w + 8, h + 8);
  g.fillStyle = '#111';
  for (let i = 0; i < w;) { const bw = pick([1, 1, 2, 3]); if (Math.random() < 0.55) g.fillRect(x + i, y, bw, h * 0.86); i += bw + 1; }
  g.font = `500 ${Math.round(h * 0.14)}px ${FONT}`; g.textAlign = 'center';
  g.fillText('8 934588 ' + Math.floor(rand(100000, 999999)), x + w / 2, y + h * 1.02);
}
function fineText(g, x, y, w, lines, color, size = 9) {
  g.fillStyle = color; g.font = `400 ${size}px ${FONT}`; g.textAlign = 'left';
  for (let i = 0; i < lines; i++) {
    let s = '';
    while (g.measureText(s).width < w * rand(0.7, 1)) s += pick(['Thành phần', 'nước', 'đường', 'hương', 'tự nhiên', 'bảo quản', 'nơi khô', 'mát', 'HSD', 'xem', 'trên', 'nắp', 'NSX', '330ml']) + ' ';
    g.fillText(s, x, y + i * (size + 3));
  }
}
function noiseCanvas(w, h, base, amp) {
  const [c, g] = cv(w, h);
  const img = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const n = (Math.random() - 0.5) * amp;
    img.data[i * 4] = base[0] + n; img.data[i * 4 + 1] = base[1] + n; img.data[i * 4 + 2] = base[2] + n; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return [c, g];
}

// ------------------------------------------------------------------ bao bì
const DRINKS = [
  { brand: 'AQUA PURE', sub: 'Nước khoáng thiên nhiên', bg: ['#e0f2fe', '#0284c7'], ink: '#0c4a6e', accent: '#38bdf8' },
  { brand: 'VIVA', sub: 'Nước uống tinh khiết', bg: ['#ffffff', '#2563eb'], ink: '#1e3a8a', accent: '#ef4444' },
  { brand: 'BIOTEA', sub: 'Trà xanh vị chanh', bg: ['#dcfce7', '#15803d'], ink: '#14532d', accent: '#facc15' },
  { brand: 'ORANGO', sub: 'Nước cam ép', bg: ['#ffedd5', '#ea580c'], ink: '#7c2d12', accent: '#16a34a' },
  { brand: 'COOL+', sub: 'Nước bù khoáng', bg: ['#f1f5f9', '#0f172a'], ink: '#0f172a', accent: '#22d3ee' },
  { brand: 'TRÀ ĐÀO', sub: 'Trà đào cam sả', bg: ['#fff7ed', '#f97316'], ink: '#9a3412', accent: '#db2777' },
];
const CANS = [
  { brand: 'COLA', sub: 'Nước giải khát có ga', bg: '#c1121f', ink: '#ffffff', accent: '#111111' },
  { brand: 'BIA VIỆT', sub: 'Lager · 4.9%', bg: '#0b6e2e', ink: '#fde047', accent: '#ffffff' },
  { brand: 'GOLD BEER', sub: 'Premium Lager', bg: '#b45309', ink: '#fff7d6', accent: '#7f1d1d' },
  { brand: 'BOLT', sub: 'Nước tăng lực', bg: '#111827', ink: '#facc15', accent: '#ef4444' },
  { brand: 'LEMON SODA', sub: 'Soda chanh', bg: '#facc15', ink: '#065f46', accent: '#16a34a' },
  { brand: 'CÀ PHÊ SỮA', sub: 'Cà phê sữa đá', bg: '#5b3a1e', ink: '#fde68a', accent: '#e7c9a9' },
  { brand: 'BIA XANH', sub: 'Beer · 330ml', bg: '#1d4ed8', ink: '#ffffff', accent: '#93c5fd' },
];

/** Nhãn chai nhựa quấn quanh thân (lặp 2 lần để nằm nghiêng góc nào cũng thấy chữ) */
function bottleLabel(d) {
  const [c, g] = cv(1024, 256);
  const half = 512;
  for (let k = 0; k < 2; k++) {
    const x0 = k * half;
    const gr = g.createLinearGradient(0, 0, 0, 256);
    gr.addColorStop(0, d.bg[0]); gr.addColorStop(1, d.bg[1]);
    g.fillStyle = gr; g.fillRect(x0, 0, half, 256);
    g.fillStyle = d.accent; g.globalAlpha = 0.85;
    g.beginPath(); g.moveTo(x0, 190);
    for (let x = 0; x <= half; x += 16) g.lineTo(x0 + x, 190 + Math.sin(x / 40 + k) * 12);
    g.lineTo(x0 + half, 256); g.lineTo(x0, 256); g.fill();
    g.globalAlpha = 1;
    g.fillStyle = d.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${d.brand.length > 7 ? 70 : 88}px ${FONT}`;
    g.fillText(d.brand, x0 + 256, 100);
    g.font = `600 26px ${FONT}`; g.fillText(d.sub, x0 + 256, 160);
    g.font = `700 22px ${FONT}`; g.fillStyle = '#fff'; g.fillText(pick(['500ml', '350ml', '1,5L']), x0 + 440, 226);
    barcode(g, x0 + 24, 205, 90, 40);
  }
  return tex(c, { wrap: true });
}

function canPrint(d) {
  const [c, g] = cv(1024, 512);
  g.fillStyle = d.bg; g.fillRect(0, 0, 1024, 512);
  for (let k = 0; k < 2; k++) {
    const x0 = k * 512;
    g.fillStyle = d.accent; g.globalAlpha = 0.9;
    g.beginPath(); g.moveTo(x0, 380); g.bezierCurveTo(x0 + 170, 300, x0 + 340, 470, x0 + 512, 360); g.lineTo(x0 + 512, 512); g.lineTo(x0, 512); g.fill();
    g.globalAlpha = 0.18; g.fillStyle = '#fff';
    for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(x0 + rand(20, 490), rand(30, 330), rand(4, 16), 0, Math.PI * 2); g.fill(); }
    g.globalAlpha = 1;
    g.save(); g.translate(x0 + 256, 200); g.rotate(-0.08);
    g.fillStyle = d.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${d.brand.length > 7 ? 84 : 120}px ${FONT}`;
    g.fillText(d.brand, 0, 0);
    g.font = `600 34px ${FONT}`; g.fillText(d.sub, 0, 82);
    g.restore();
    fineText(g, x0 + 30, 430, 260, 4, d.ink, 13);
    barcode(g, x0 + 360, 420, 110, 52);
  }
  // mép trên/dưới lon thường để lộ nhôm
  g.fillStyle = '#c9ced4'; g.fillRect(0, 0, 1024, 10); g.fillRect(0, 502, 1024, 10);
  return tex(c, { wrap: true });
}

// ------------------------------------------------------------------ vật liệu
const petMat = (tint = 0xe6f3ff) => new THREE.MeshPhysicalMaterial({
  color: tint, metalness: 0, roughness: 0.06, transmission: 0.9, thickness: 0.004, ior: 1.46,
  clearcoat: 0.6, clearcoatRoughness: 0.1, specularIntensity: 1, side: THREE.DoubleSide,
});
const aluMat = () => new THREE.MeshStandardMaterial({ color: 0xd9dde2, metalness: 1, roughness: 0.24 });

// ------------------------------------------------------------------ chai nhựa PET
function petProfile(r, h, { ribs = 2, squeeze = 1 } = {}) {
  const pts = [];
  const add = (x, y) => pts.push(new THREE.Vector2(Math.max(0.0008, x), y));
  // đáy hoa mai (petaloid) thu gọn
  add(0.0008, h * 0.012); add(r * 0.35, 0); add(r * 0.75, h * 0.004); add(r * 0.94, h * 0.025); add(r, h * 0.06);
  // thân + gờ
  const b0 = h * 0.06, b1 = h * 0.6;
  const N = 40;
  for (let i = 1; i <= N; i++) {
    const t = i / N, y = b0 + (b1 - b0) * t;
    let rr = r;
    for (let k = 1; k <= ribs; k++) {
      const c = (k / (ribs + 1)), dist = Math.abs(t - c);
      if (dist < 0.035) rr -= r * 0.06 * Math.cos((dist / 0.035) * Math.PI / 2);
    }
    add(rr * squeeze, y);
  }
  // vai
  for (let i = 1; i <= 12; i++) {
    const t = i / 12;
    add(r - (r - r * 0.36) * (1 - Math.cos(t * Math.PI)) / 2, b1 + (h * 0.86 - b1) * t);
  }
  // cổ + vòng đỡ + miệng ren
  add(r * 0.36, h * 0.87); add(r * 0.47, h * 0.875); add(r * 0.47, h * 0.885); add(r * 0.36, h * 0.89);
  add(r * 0.34, h * 0.93);
  return pts;
}

function capMesh(r, h, color) {
  const geo = new THREE.CylinderGeometry(r, r, h, 64, 1);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {            // khía dọc thành nắp
    const x = p.getX(i), z = p.getZ(i), a = Math.atan2(z, x);
    const k = 1 + 0.035 * Math.sign(Math.sin(a * 32));
    if (Math.abs(p.getY(i)) < h / 2 - 1e-4 || Math.hypot(x, z) > r * 0.9) { p.setX(i, x * k); p.setZ(i, z * k); }
  }
  geo.computeVertexNormals();
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.45 }));
}

function makePet(r, h, { ribs = 2, crushed = false, tint } = {}) {
  const inner = new THREE.Group();
  const geo = new THREE.LatheGeometry(petProfile(r, h, { ribs }), 48);
  if (crushed) {                                  // chai bị đạp bẹp: ép dẹt + nếp gấp ngẫu nhiên
    const p = geo.attributes.position;
    const ph = rand(0, 6);
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if (y > h * 0.86) continue;
      const f = Math.min(1, y / (h * 0.12)) * Math.min(1, (h * 0.86 - y) / (h * 0.2));
      p.setZ(i, p.getZ(i) * (1 - 0.4 * f));
      p.setX(i, p.getX(i) * (1 + 0.12 * f) + Math.sin(y * 90 + ph) * 0.003 * f);
    }
    geo.computeVertexNormals();
  }
  inner.add(new THREE.Mesh(geo, petMat(tint)));
  const d = pick(DRINKS);
  const lblGeo = new THREE.CylinderGeometry(r * 1.004, r * 1.004, h * 0.24, 48, 1, true);
  if (crushed) {
    const p = lblGeo.attributes.position;
    for (let i = 0; i < p.count; i++) { p.setZ(i, p.getZ(i) * 0.45); p.setX(i, p.getX(i) * 1.12); }
    lblGeo.computeVertexNormals();
  }
  const lbl = new THREE.Mesh(lblGeo, new THREE.MeshStandardMaterial({ map: bottleLabel(d), roughness: 0.38, side: THREE.DoubleSide }));
  lbl.position.y = h * 0.36;
  inner.add(lbl);
  const cap = capMesh(r * 0.4, h * 0.065, pick([0x1d4ed8, 0xdc2626, 0x16a34a, 0xf8fafc, 0xf97316, 0x0ea5e9]));
  cap.position.y = h * 0.93 + h * 0.03;
  inner.add(cap);
  return wrapAndLay(inner, h * 0.995);
}

function wrapAndLay(inner, length) {
  // dựng đứng theo trục Y -> nằm ngang theo trục X, tâm tại gốc
  const g = new THREE.Group();
  inner.rotation.z = -Math.PI / 2;
  inner.position.x = -length / 2;
  g.add(inner);
  return g;
}

// ------------------------------------------------------------------ lon nhôm
function makeCan(r, h, { dent = 0 } = {}) {
  const inner = new THREE.Group();
  const d = pick(CANS);
  // thân in bao bì
  const bodyGeo = new THREE.CylinderGeometry(r, r, h * 0.86, 64, 24, true);
  if (dent > 0) {                                 // vết móp
    const p = bodyGeo.attributes.position;
    const cy = rand(-0.2, 0.2) * h, ca = rand(0, Math.PI * 2);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), a = Math.atan2(z, x);
      const da = Math.atan2(Math.sin(a - ca), Math.cos(a - ca));
      const f = Math.exp(-((y - cy) ** 2) / (2 * (h * 0.12) ** 2) - (da ** 2) / 0.5);
      const f2 = 0.35 * Math.exp(-((y + cy * 0.6) ** 2) / (2 * (h * 0.06) ** 2) - ((da + 2.4) ** 2) / 0.3);
      const k = 1 - dent * (f + f2) + Math.sin(a * 9 + y * 140) * 0.012 * dent;
      p.setX(i, x * k); p.setZ(i, z * k);
    }
    bodyGeo.computeVertexNormals();
  }
  const body = new THREE.Mesh(bodyGeo, new THREE.MeshStandardMaterial({ map: canPrint(d), metalness: 0.55, roughness: 0.3 }));
  body.position.y = h * 0.47;
  inner.add(body);
  // đáy vòm + cổ thắt + vành miệng (nhôm trơn)
  const alu = aluMat();
  const bottom = new THREE.LatheGeometry([
    new THREE.Vector2(0.0008, h * 0.03), new THREE.Vector2(r * 0.55, h * 0.018), new THREE.Vector2(r * 0.72, h * 0.002),
    new THREE.Vector2(r * 0.8, 0), new THREE.Vector2(r * 0.93, h * 0.01), new THREE.Vector2(r, h * 0.04),
  ], 48);
  inner.add(new THREE.Mesh(bottom, alu));
  const top = new THREE.LatheGeometry([
    new THREE.Vector2(r, h * 0.9), new THREE.Vector2(r * 0.97, h * 0.93), new THREE.Vector2(r * 0.86, h * 0.975),
    new THREE.Vector2(r * 0.86, h * 0.99), new THREE.Vector2(r * 0.88, h * 0.997), new THREE.Vector2(r * 0.84, h),
    new THREE.Vector2(r * 0.8, h * 0.985), new THREE.Vector2(0.0008, h * 0.985),
  ], 48);
  inner.add(new THREE.Mesh(top, alu));
  // khoen kéo + miệng uống
  const tabShape = new THREE.Shape();
  const tw = r * 0.36, tl = r * 0.9;
  tabShape.absarc(0, tl * 0.25, tw / 2, 0, Math.PI, false); tabShape.lineTo(-tw / 2, -tl * 0.45);
  tabShape.absarc(0, -tl * 0.45, tw / 2, Math.PI, Math.PI * 2, false); tabShape.lineTo(tw / 2, tl * 0.25);
  const hole = new THREE.Path(); hole.absellipse(0, -tl * 0.35, tw * 0.28, tl * 0.18, 0, Math.PI * 2, true);
  tabShape.holes.push(hole);
  const tab = new THREE.Mesh(new THREE.ExtrudeGeometry(tabShape, { depth: 0.0006, bevelEnabled: false }), alu);
  tab.rotation.x = -Math.PI / 2; tab.position.set(0, h * 0.987, -r * 0.05);
  inner.add(tab);
  const mouth = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshStandardMaterial({ color: 0x6b7280, metalness: 0.8, roughness: 0.4 }));
  mouth.scale.set(r * 0.28, r * 0.2, 1); mouth.rotation.x = -Math.PI / 2; mouth.position.set(0, h * 0.9862, r * 0.42);
  inner.add(mouth);
  return wrapAndLay(inner, h);
}

// ------------------------------------------------------------------ rác khác
function makeCarton() {
  const front = (() => {
    const [c, g] = cv(512, 320);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 512, 320);
    g.fillStyle = pick(['#2563eb', '#16a34a', '#db2777']);
    g.beginPath(); g.moveTo(0, 210); g.bezierCurveTo(140, 150, 330, 270, 512, 190); g.lineTo(512, 320); g.lineTo(0, 320); g.fill();
    g.fillStyle = '#111'; for (let i = 0; i < 5; i++) { g.beginPath(); g.ellipse(rand(300, 480), rand(40, 160), rand(10, 26), rand(8, 18), rand(0, 3), 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#1e3a8a'; g.textAlign = 'left'; g.font = `900 64px ${FONT}`; g.fillText('SỮA TƯƠI', 26, 96);
    g.font = `600 26px ${FONT}`; g.fillText(pick(['Có đường', 'Ít đường', 'Socola', 'Dâu']), 30, 140);
    g.fillStyle = '#fff'; g.font = `800 30px ${FONT}`; g.fillText('180ml', 30, 290);
    return tex(c);
  })();
  const side = (() => { const [c, g] = cv(256, 128); g.fillStyle = '#f8fafc'; g.fillRect(0, 0, 256, 128); fineText(g, 10, 20, 230, 7, '#334155', 10); barcode(g, 150, 70, 80, 36); return tex(c); })();
  const white = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.6 });
  const mf = new THREE.MeshStandardMaterial({ map: front, roughness: 0.45 });
  const ms = new THREE.MeshStandardMaterial({ map: side, roughness: 0.5 });
  // nằm: dài 10,5 cm theo X, dày 4 cm, rộng 6,5 cm; mặt in lớn hướng lên
  const box = new THREE.Mesh(new RoundedBoxGeometry(0.105, 0.04, 0.065, 2, 0.003), [ms, ms, mf, mf, white, white]);
  const g = new THREE.Group(); g.add(box);
  const straw = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.004, 0.012), new THREE.MeshPhysicalMaterial({ color: 0xfefce8, roughness: 0.2, transmission: 0.4, thickness: 0.002 }));
  straw.position.set(0, 0.022, 0.018); straw.rotation.y = 0.05;
  g.add(straw);
  return g;
}

function crumple(geo, amp, scale = [1, 1, 1], freq = 9) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  const s = [rand(0, 9), rand(0, 9), rand(0, 9)];
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * freq + s[0]) * Math.sin(v.y * freq * 1.3 + s[1]) * Math.sin(v.z * freq * 0.9 + s[2]);
    v.multiplyScalar(1 + amp * n + rand(-amp, amp) * 0.6);
    v.set(v.x * scale[0], v.y * scale[1], v.z * scale[2]);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function makeBag() {
  const color = pick([0xf8fafc, 0x111827, 0xf472b6, 0x60a5fa, 0xfef08a]);
  const geo = crumple(new THREE.IcosahedronGeometry(0.06, 4), 0.28, [1.5, 0.45, 1.1], 70);
  const m = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.38, metalness: 0, transmission: color === 0xf8fafc ? 0.35 : 0.05, thickness: 0.001,
    sheen: 0.6, sheenRoughness: 0.4, flatShading: true, side: THREE.DoubleSide,
  });
  const g = new THREE.Group(); g.add(new THREE.Mesh(geo, m));
  // quai túi
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.004, 6, 16, Math.PI), m);
  handle.position.set(0.085, 0.004, 0); handle.rotation.set(Math.PI / 2, 0, 0.4);
  g.add(handle);
  return g;
}

function makeGlass() {
  const r = 0.031, h = 0.235;
  const pts = [];
  const add = (x, y) => pts.push(new THREE.Vector2(x, y));
  add(0.0008, h * 0.01); add(r * 0.8, 0); add(r, h * 0.02); add(r, h * 0.55);
  for (let i = 1; i <= 10; i++) { const t = i / 10; add(r - (r - r * 0.4) * (1 - Math.cos(t * Math.PI)) / 2, h * 0.55 + h * 0.2 * t); }
  add(r * 0.38, h * 0.95); add(r * 0.45, h * 0.96); add(r * 0.45, h); add(r * 0.3, h);
  const color = pick([0x14532d, 0x78350f, 0x065f46]);
  const glass = new THREE.MeshPhysicalMaterial({
    color, roughness: 0.04, metalness: 0, transmission: 0.85, thickness: 0.006, ior: 1.52,
    attenuationColor: color, attenuationDistance: 0.02, clearcoat: 1, side: THREE.DoubleSide,
  });
  const inner = new THREE.Group();
  inner.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 48), glass));
  const [c, g] = cv(512, 256);
  g.fillStyle = '#fef3c7'; g.fillRect(0, 0, 512, 256);
  g.fillStyle = '#7f1d1d'; g.font = `900 64px ${FONT}`; g.textAlign = 'center'; g.fillText('BEER', 128, 130); g.fillText('BEER', 384, 130);
  g.font = `600 22px ${FONT}`; g.fillText('Lager · 450ml', 128, 180); g.fillText('Lager · 450ml', 384, 180);
  const lbl = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.004, r * 1.004, h * 0.22, 48, 1, true, -0.9, 1.8 + Math.PI),
    new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.6, side: THREE.DoubleSide }));
  lbl.position.y = h * 0.3; inner.add(lbl);
  const cap = capMesh(r * 0.47, h * 0.03, 0xb8a14a); cap.material.metalness = 0.8; cap.material.roughness = 0.3;
  cap.position.y = h * 0.995; inner.add(cap);
  return wrapAndLay(inner, h * 1.01);
}

function makeFoam() {
  const [c] = noiseCanvas(256, 256, [244, 244, 240], 26);
  const m = new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.95, bumpMap: tex(c, { srgb: false }), bumpScale: 0.6 });
  const g = new THREE.Group();
  const base = new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.035, 0.14, 3, 0.012), m);
  base.position.y = -0.012;
  const lid = new THREE.Mesh(new RoundedBoxGeometry(0.168, 0.026, 0.138, 3, 0.012), m);
  lid.position.y = 0.017;
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.176, 0.004, 0.146), m);
  rim.position.y = 0.006;
  g.add(base, lid, rim);
  return g;
}

function makePaper() {
  const [c, g] = cv(512, 512);
  g.fillStyle = pick(['#f8fafc', '#fef9c3', '#f5f5f4']); g.fillRect(0, 0, 512, 512);
  g.strokeStyle = 'rgba(59,130,246,.45)'; g.lineWidth = 2;
  for (let y = 30; y < 512; y += 24) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.strokeStyle = 'rgba(30,41,59,.75)'; g.lineWidth = 2;
  for (let y = 50; y < 500; y += 24) {
    g.beginPath(); let x = rand(20, 60); g.moveTo(x, y);
    while (x < rand(300, 490)) { x += rand(4, 10); g.lineTo(x, y - rand(0, 8)); }
    g.stroke();
  }
  const geo = crumple(new THREE.IcosahedronGeometry(0.04, 3), 0.32, [1, 0.85, 1], 120);
  return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex(c), roughness: 0.95, flatShading: true }));
}

function makeSnack() {
  const L = 0.17, W = 0.12;
  const geo = new THREE.PlaneGeometry(L, W, 40, 28);
  const p = geo.attributes.position;
  const geoB = geo.clone();
  const pb = geoB.attributes.position;
  for (const [pp, sgn] of [[p, 1], [pb, -1]]) {
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i);
      const u = x / L + 0.5, v = y / W + 0.5;
      const edgeX = Math.min(u, 1 - u) < 0.06;
      const puff = Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.06) / 0.88))) * Math.sin(Math.PI * v);
      let z = 0.018 * puff + Math.sin(x * 160 + y * 90) * 0.0012 * puff;
      if (edgeX) { z = 0; pp.setY(i, y + Math.sin(y * 600) * 0.0015); }   // mép hàn răng cưa
      pp.setZ(i, sgn * z);
    }
  }
  geoB.scale(1, 1, 1);
  geo.computeVertexNormals(); geoB.computeVertexNormals();
  const [c, g] = cv(1024, 720);
  const col = pick(['#dc2626', '#f59e0b', '#16a34a', '#7c3aed']);
  g.fillStyle = col; g.fillRect(0, 0, 1024, 720);
  g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, 520, 1024, 200);
  g.fillStyle = '#fde047'; g.beginPath(); g.ellipse(700, 420, 220, 150, -0.3, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fef3c7'; for (let i = 0; i < 6; i++) { g.beginPath(); g.ellipse(620 + rand(-120, 140), 420 + rand(-80, 80), 60, 40, rand(0, 3), 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = `900 150px ${FONT}`; g.fillText('SNACK', 70, 240);
  g.font = `800 64px ${FONT}`; g.fillText(pick(['Vị tôm cay', 'Khoai tây', 'Vị phô mai', 'Rong biển']), 80, 330);
  g.font = `700 40px ${FONT}`; g.fillText('45g', 80, 660);
  const front = new THREE.MeshStandardMaterial({ map: tex(c), metalness: 0.35, roughness: 0.28, side: THREE.DoubleSide });
  const back = new THREE.MeshStandardMaterial({ color: 0xc0c4c8, metalness: 0.9, roughness: 0.25, side: THREE.DoubleSide });
  const a = new THREE.Mesh(geo, front), b = new THREE.Mesh(geoB, back);
  const grp = new THREE.Group();
  a.rotation.x = -Math.PI / 2; b.rotation.x = -Math.PI / 2;
  grp.add(a, b);
  grp.rotation.y = rand(-0.2, 0.2);
  return grp;
}

function makePaperCup() {
  const h = 0.11, r0 = 0.027, r1 = 0.042;
  const pts = [new THREE.Vector2(0.0008, 0.004), new THREE.Vector2(r0, 0.004), new THREE.Vector2(r0, 0), new THREE.Vector2(r0 * 1.01, 0.006),
    new THREE.Vector2(r1, h), new THREE.Vector2(r1 + 0.0025, h + 0.0015), new THREE.Vector2(r1 + 0.001, h + 0.003), new THREE.Vector2(r1 - 0.001, h)];
  const [c, g] = cv(1024, 256);
  g.fillStyle = '#f5f0e6'; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#6b3f1d'; g.fillRect(0, 70, 1024, 120);
  for (let k = 0; k < 2; k++) {
    g.fillStyle = '#f5f0e6'; g.font = `900 64px ${FONT}`; g.textAlign = 'center'; g.fillText('CÀ PHÊ', 256 + k * 512, 152);
    g.strokeStyle = '#6b3f1d'; g.lineWidth = 6; g.beginPath(); g.arc(256 + k * 512, 40, 22, 0, Math.PI * 2); g.stroke();
  }
  const paper = new THREE.MeshStandardMaterial({ map: tex(c, { wrap: true }), roughness: 0.8, side: THREE.DoubleSide });
  const geo = new THREE.LatheGeometry(pts, 48);
  // UV thân cốc theo chiều cao (Lathe dùng chỉ số điểm) -> gán lại v theo y để in đúng
  const uv = geo.attributes.uv, pp = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setY(i, THREE.MathUtils.clamp(pp.getY(i) / h, 0, 1));
  const cup = new THREE.Mesh(geo, paper);
  const stain = new THREE.Mesh(new THREE.CircleGeometry(r0 * 0.98, 32), new THREE.MeshStandardMaterial({ color: 0x3b2412, roughness: 0.35 }));
  stain.rotation.x = -Math.PI / 2; stain.position.y = 0.005;
  const inner = new THREE.Group(); inner.add(cup, stain);
  const grp = wrapAndLay(inner, h);
  grp.children[0].rotation.z = -Math.PI / 2 + Math.atan((r1 - r0) / h);  // cốc nằm: thân côn chạm mặt phẳng
  return grp;
}

function makeCup() {
  const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(0.026, 0), new THREE.Vector2(0.042, 0.11), new THREE.Vector2(0.044, 0.112)];
  const cup = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), petMat(0xf1f5f9));
  const tea = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.001, 0.002), new THREE.Vector2(0.025, 0.002), new THREE.Vector2(0.03, 0.03), new THREE.Vector2(0.001, 0.03)], 32),
    new THREE.MeshStandardMaterial({ color: 0xb08968, roughness: 0.3, transparent: true, opacity: 0.85 }));
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.045, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2.6), petMat(0xf8fafc));
  lid.position.y = 0.1; lid.scale.y = 0.6;
  const straw = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.17, 12), new THREE.MeshStandardMaterial({ color: pick([0xe11d48, 0x0ea5e9, 0x111827]), roughness: 0.35 }));
  straw.position.set(0.008, 0.12, 0); straw.rotation.z = 0.12;
  const inner = new THREE.Group(); inner.add(cup, tea, lid, straw);
  return wrapAndLay(inner, 0.12);
}

// ---- Phiên bản phủ ảnh thật (dùng khi có ảnh trong manifest; không có thì về bản vẽ bằng code) ----
function realPet(L, opts) {
  const e = realPick('pet');
  if (!e) return makePet(opts.r, L, opts);
  const obj = makePet(radiusFor(e, L, 0.024, 0.05), L, opts);
  return projectPhoto(obj, realTex(e), { roughness: 0.3, clearcoat: 0.25, clearcoatRoughness: 0.3 });
}
function realCan(L, opts) {
  const e = realPick('can');
  if (!e) return makeCan(opts.r, L, opts);
  const obj = makeCan(radiusFor(e, L, 0.026, 0.04), L, opts);
  return projectPhoto(obj, realTex(e), { roughness: 0.28, metalness: 0.25, clearcoat: 0.5 });
}
function realGlass() {
  const e = realPick('glass');
  const obj = makeGlass();
  return e ? projectPhoto(obj, realTex(e), { roughness: 0.12, clearcoat: 1 }) : obj;
}
function realCarton() {
  const e = realPick('carton');
  const obj = makeCarton();
  return e ? projectPhoto(obj, realTex(e), { roughness: 0.75 }) : obj;
}
function realPaper() {
  const e = realPick('paper');
  const obj = makePaper();
  return e ? projectPhoto(obj, realTex(e), { roughness: 0.9, flatShading: true }) : obj;
}

const BUILDERS = {
  bottle_500: () => realPet(0.205, { r: 0.032, ribs: 2 }),
  bottle_1500: () => realPet(0.31, { r: 0.044, ribs: 3 }),
  bottle_flat: () => realPet(0.205, { r: 0.033, ribs: 2, crushed: true }),
  can_tall: () => realCan(0.157, { r: 0.0285 }),
  can_short: () => realCan(0.115, { r: 0.033 }),
  can_dented: () => realCan(0.115, { r: 0.033, dent: 0.22 }),
  milk_carton: realCarton,
  plastic_bag: makeBag,
  cup_straw: makeCup,
  glass_bottle: realGlass,
  foam_box: makeFoam,
  paper_ball: realPaper,
  snack_bag: makeSnack,
  paper_cup: makePaperCup,
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
