// Khung đường ven biển: vỉa hè có 3 trạm đứng thẳng hàng, lòng đường, vỉa hè đối diện có cửa hàng demo + dãy nhà phố,
// phía sau trạm là kè biển, bãi cát (dù, ghế nằm, chòi cứu hộ) và biển có sóng; người đi bộ / tắm biển.
//
// Trạm ĐANG DÙNG luôn nằm ở gốc tọa độ (đủ cơ cấu + vật lý). Cả khung phố là 1 group dời theo trục X:
// chọn trạm khác -> camera bay tới bản sao của trạm đó -> dời khung phố để trạm đó về gốc, đổi kết nối sang trạm đó.
// 2 trạm còn lại là bản sao tĩnh (mesh đã gộp theo vật liệu, không vật lý / không đèn) -> nhẹ máy.
import * as THREE from 'three';
import { asphaltTexture, labelTexture, pavingTexture } from '../station/textures.js';
import { buildStation } from '../station/body.js';
import { M } from '../station/materials.js';
import { D } from '../station/dims.js';
import { bakeStatic, freeze } from './merge.js';
import { buildCrowd } from './people.js';
import { WM, bench, lifeguardTower, mesh, palm, planter, streetLamp, towel, umbrellaSet } from '../world.js';
import { VIEWS, flyTo } from '../ui/viewButtons.js';
import { toast } from '../ui/toast.js';

// ---- Bố cục (m, hệ tọa độ "phố": x dọc theo đường, z: +z về phía đường / cửa hàng, -z về phía biển)
export const L = {
  SLOT_X: [-7, 0, 7],                  // 3 trạm thẳng hàng
  WALK: { z1: -2.9, z2: 3.7 },          // vỉa hè bên trạm
  ROAD: { z1: 3.95, z2: 10.95 },
  OPP: { z1: 11.2, z2: 14.2 },          // vỉa hè đối diện
  SHOP: { x: 0, z: 14.2, w: 9, d: 6, h: 3.8 },
  SAND: { z1: -3.1, y1: -0.65, shoreZ: -18, y2: -0.95 },
  SEA_Y: -0.97,
  HALF: 60,                             // nửa chiều dài đoạn phố dựng
};

/** Độ cao mặt cát tại z (phố) */
export const sandY = (z) => L.SAND.y1 + (L.SAND.y2 - L.SAND.y1) * THREE.MathUtils.clamp((L.SAND.z1 - z) / (L.SAND.z1 - L.SAND.shoreZ), 0, 1);
/** Bậc xuống bãi tắm (khe hở lan can kè) */
export const STAIRS_X = [-3.5, 3.5, -17, 17];

// ============================================================ texture
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}
const sandTex = () => canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#e8d4a6'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5 ? `rgba(160,130,80,${Math.random() * 0.18})` : `rgba(255,250,235,${Math.random() * 0.25})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
}, [30, 6]);
const windowsTex = () => canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {
    g.fillStyle = '#5b6b7a'; g.fillRect(k * 128 + 30, r * 128 + 26, 68, 80);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(k * 128 + 34, r * 128 + 30, 26, 72);
    g.fillStyle = '#d6d3d1'; g.fillRect(k * 128 + 24, r * 128 + 104, 80, 8);   // bậu cửa
  }
}, [1, 1]);

// ============================================================ biển có sóng (dời đỉnh trong shader)
function buildSea() {
  const geo = new THREE.PlaneGeometry(L.HALF * 4, 150, 160, 60);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, L.SAND.shoreZ - 75 + 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x1e8fb0, roughness: 0.12, metalness: 0.05 });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uTime;
        float wv(vec2 p) {
          return sin(p.x * 0.35 + uTime * 1.1) * 0.05 + sin(p.y * 0.55 - uTime * 1.6) * 0.07
               + sin((p.x + p.y) * 1.3 + uTime * 2.3) * 0.02;
        }`)
      .replace('#include <beginnormal_vertex>', `
        vec2 pw = position.xz;
        float e = 0.15;
        float hx = wv(pw + vec2(e, 0.0)) - wv(pw - vec2(e, 0.0));
        float hz = wv(pw + vec2(0.0, e)) - wv(pw - vec2(0.0, e));
        vec3 objectNormal = normalize(vec3(-hx / (2.0 * e), 1.0, -hz / (2.0 * e)));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3(1.0, 0.0, 0.0);
        #endif`)
      .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
        transformed.y += wv(position.xz) * smoothstep(${(L.SAND.shoreZ + 1).toFixed(1)}, ${(L.SAND.shoreZ - 6).toFixed(1)}, position.z);`);
  };
  const sea = new THREE.Mesh(geo, mat);
  sea.position.y = L.SEA_Y;
  sea.receiveShadow = true;
  sea.name = 'sea';
  // dải bọt sóng vỗ bờ
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(L.HALF * 4, 1.2), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, L.SEA_Y + 0.03, L.SAND.shoreZ - 0.4);
  return { sea, foam, update(t) {
    uniforms.uTime.value = t;
    const k = Math.sin(t * 0.7);
    foam.position.z = L.SAND.shoreZ - 0.6 + k * 0.9;
    foamMat.opacity = 0.35 + 0.25 * (0.5 + 0.5 * Math.cos(t * 0.7));
    foam.updateMatrix(); foam.updateMatrixWorld();      // khung phố đóng băng ma trận: tự cập nhật riêng dải bọt
  } };
}

// ============================================================ dãy nhà phố đối diện (sau cửa hàng)
function buildRow(g) {
  const win = windowsTex();
  const cols = [0xfde68a, 0xbfdbfe, 0xfecaca, 0xd9f99d, 0xe9d5ff, 0xfed7aa, 0xccfbf1, 0xf5f5f4];
  const mats = cols.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  const fronts = cols.map((c) => {
    const t = win.clone(); t.needsUpdate = true; t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return { tex: t, mat: new THREE.MeshStandardMaterial({ color: c, map: t, roughness: 0.8 }) };
  });
  const roof = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.8 });
  let x = -L.HALF, i = 0;
  while (x < L.HALF) {
    const w = 4 + (i * 7 % 5) * 0.8;
    if (x + w > L.SHOP.x - L.SHOP.w / 2 - 0.4 && x < L.SHOP.x + L.SHOP.w / 2 + 0.4) { x = L.SHOP.x + L.SHOP.w / 2 + 0.4; i++; continue; }
    const floors = 2 + (i * 3 % 3), h = floors * 3.2;
    const f = fronts[i % fronts.length];
    // mặt trước có cửa sổ, các mặt khác trơn (mảng vật liệu: +x -x +y -y +z -z)
    const m = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, h, 8), [mats[i % mats.length], mats[i % mats.length], roof, roof, mats[i % mats.length], f.mat]);
    m.position.set(x + w / 2, h / 2, L.SHOP.z + 4);
    m.castShadow = false; m.receiveShadow = true;
    g.add(m);
    // mái hiên tầng trệt
    g.add(mesh(new THREE.BoxGeometry(w - 0.3, 0.08, 1.2), roof, x + w / 2, 2.7, L.SHOP.z - 0.55));
    x += w; i++;
  }
  fronts.forEach((f) => f.tex.repeat.set(1, 1));
}

// ============================================================ dựng toàn cảnh
export function buildStreet(ctx) {
  const city = new THREE.Group();
  city.name = 'city';
  const decor = new THREE.Group();           // đồ tĩnh sẽ gộp theo vật liệu
  const H = L.HALF;

  // ---- vỉa hè bên trạm
  const pave = pavingTexture();
  const walkD = L.WALK.z2 - L.WALK.z1;
  pave.repeat.set((H * 2) / 2.4, walkD / 2.4);
  const paving = new THREE.MeshStandardMaterial({ map: pave, roughness: 0.92 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, walkD), paving);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, (L.WALK.z1 + L.WALK.z2) / 2);
  ground.receiveShadow = true;
  city.add(ground);
  // vỉa hè đối diện
  const pave2 = pave.clone(); pave2.needsUpdate = true;
  pave2.repeat.set((H * 2) / 2.4, (L.OPP.z2 - L.OPP.z1 + 6) / 2.4);
  const opp = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, L.OPP.z2 - L.OPP.z1 + 6), new THREE.MeshStandardMaterial({ map: pave2, roughness: 0.92 }));
  opp.rotation.x = -Math.PI / 2;
  opp.position.set(0, 0, (L.OPP.z1 + L.OPP.z2 + 6) / 2);
  opp.receiveShadow = true;
  city.add(opp);

  // ---- bó vỉa + lòng đường + vạch kẻ
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.85 });
  decor.add(mesh(new THREE.BoxGeometry(H * 2, 0.15, 0.25), curbMat, 0, -0.075, L.WALK.z2 + 0.12));
  decor.add(mesh(new THREE.BoxGeometry(H * 2, 0.15, 0.25), curbMat, 0, -0.075, L.OPP.z1 - 0.12));
  const asph = asphaltTexture();
  asph.repeat.set(H / 2, 3);
  const roadW = L.ROAD.z2 - L.ROAD.z1;
  const road = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, roadW), new THREE.MeshStandardMaterial({ map: asph, roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -0.15, (L.ROAD.z1 + L.ROAD.z2) / 2);
  road.receiveShadow = true;
  city.add(road);
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.7 });
  const lines = [];
  for (let x = -H + 1; x < H; x += 3) lines.push([x, (L.ROAD.z1 + L.ROAD.z2) / 2]);
  for (const [x, z] of lines) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.12), lineMat);
    l.rotation.x = -Math.PI / 2; l.position.set(x, -0.148, z);
    decor.add(l);
  }
  // vạch qua đường trước cửa hàng
  for (let k = 0; k < 8; k++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.45, roadW - 0.6), lineMat);
    l.rotation.x = -Math.PI / 2; l.position.set(L.SHOP.x - 1.9 + k * 0.55, -0.147, (L.ROAD.z1 + L.ROAD.z2) / 2);
    decor.add(l);
  }

  // ---- kè biển + lan can + bậc xuống bãi tắm
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.9 });
  decor.add(mesh(new THREE.BoxGeometry(H * 2, 0.9, 0.25), wallMat, 0, -0.25, L.WALK.z1 - 0.1));
  const railMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4, metalness: 0.4 });
  const stairsX = STAIRS_X;
  for (let x = -H; x <= H; x += 2) {
    if (stairsX.some((s) => Math.abs(x - s) < 1)) continue;
    decor.add(mesh(new THREE.BoxGeometry(0.06, 0.9, 0.06), railMat, x, 0.45, L.WALK.z1 + 0.05));
  }
  for (const [a, b] of [[-H, -17.8], [-16.2, -4.3], [-2.7, 2.7], [4.3, 16.2], [17.8, H]]) {
    decor.add(mesh(new THREE.BoxGeometry(b - a, 0.05, 0.08), railMat, (a + b) / 2, 0.92, L.WALK.z1 + 0.05));
    decor.add(mesh(new THREE.BoxGeometry(b - a, 0.03, 0.04), railMat, (a + b) / 2, 0.5, L.WALK.z1 + 0.05));
  }
  for (const sx of stairsX) {
    for (let k = 0; k < 4; k++) {
      decor.add(mesh(new THREE.BoxGeometry(1.4, 0.16, 0.35), wallMat, sx, -0.08 - k * 0.16, L.WALK.z1 - 0.38 - k * 0.35));
    }
  }

  // ---- bãi cát (dốc nhẹ ra biển) + bờ cát ướt
  const S = L.SAND;
  const sandGeo = new THREE.PlaneGeometry(H * 2, S.z1 - S.shoreZ + 4, 4, 8);
  sandGeo.rotateX(-Math.PI / 2);
  const sp = sandGeo.attributes.position;
  const z0 = (S.z1 + S.shoreZ - 4) / 2;
  for (let k = 0; k < sp.count; k++) {
    const z = sp.getZ(k) + z0;
    const t = THREE.MathUtils.clamp((S.z1 - z) / (S.z1 - S.shoreZ), 0, 1.3);
    sp.setY(k, S.y1 + (S.y2 - S.y1) * t - Math.max(0, t - 1) * 0.6);
  }
  sandGeo.computeVertexNormals();
  const sand = new THREE.Mesh(sandGeo, new THREE.MeshStandardMaterial({ map: sandTex(), roughness: 1 }));
  sand.position.z = z0;
  sand.receiveShadow = true;
  city.add(sand);

  const sea = buildSea();
  city.add(sea.sea, sea.foam);

  // ---- đồ trên bãi cát
  const loungers = [];
  const umbX = [-26, -21, -12.5, -9.5, -1.5, 1.5, 10.5, 13.5, 22, 26];
  umbX.forEach((x, i) => {
    const z = -8.5 - (i % 3) * 2.2;
    const u = umbrellaSet(x, z, sandY(z), i);
    decor.add(u.group);
    if (i % 2 === 0) loungers.push({ ...u.seats[0], rot: Math.PI });
    if (i % 3 === 0) loungers.push({ ...u.seats[1], rot: Math.PI });
  });
  [[-16, -12], [-5, -13.5], [6, -12.8], [18, -14]].forEach(([x, z], i) => {
    decor.add(towel(x, z, sandY(z), i));
    loungers.push({ x, z: z - 0.05, y: sandY(z), rot: i % 2 ? 0 : Math.PI });
  });
  decor.add(lifeguardTower(-6, -15, sandY(-15)));
  // cọ ven kè + cọ trên cát
  for (const x of [-24, -10.5, -3.5, 3.5, 10.5, 24]) decor.add(palm(x + 0.9, L.WALK.z1 + 0.6, { h: 5.6, lean: 0.55, yaw: Math.PI / 2 + (x > 0 ? 0.3 : -0.3) }));
  for (const [x, z] of [[-30, -6], [-15, -5.5], [8, -5.2], [30, -6.5], [-2, -6]]) decor.add(palm(x, z, { h: 6, lean: 0.75, yaw: Math.random() * 6.28, y: sandY(z) }));

  // ---- vỉa hè bên trạm: bồn cây, ghế, đèn
  for (const x of [-10.5, 10.5]) decor.add(planter(x, -2.3));
  for (const x of [-14, -4.2, 4.2, 14]) decor.add(bench(x, -2.15, Math.PI));
  for (const x of [-17.5, -10.5, -3.5, 3.5, 10.5, 17.5]) decor.add(streetLamp(x, L.WALK.z2 - 0.25));
  for (const x of [-17.5, -3.5, 10.5, 24.5]) decor.add(streetLamp(x, L.OPP.z1 + 0.25, Math.PI));

  // ---- dãy nhà phố đối diện
  const row = new THREE.Group();
  buildRow(row);
  city.add(row);

  // gộp đồ tĩnh theo vật liệu
  const baked = bakeStatic(decor);
  baked.name = 'decor';
  city.add(baked);

  // ---- người
  const crowd = buildCrowd({
    walkLanes: [
      { z: 2.55, x1: -H + 5, x2: H - 5, count: 7, spread: 0.2 },
      { z: 3.2, x1: -H + 5, x2: H - 5, count: 6, spread: 0.2 },
      { z: 12.1, x1: -H + 5, x2: H - 5, count: 6, spread: 0.3 },
      { z: 13.0, x1: -H + 5, x2: H - 5, count: 4, spread: 0.2 },
      { z: -6.5, y: sandY(-6.5), x1: -40, x2: 40, count: 5, slow: true, swim: true, spread: 1 },
      { z: S.shoreZ + 0.8, y: sandY(S.shoreZ + 0.8) - 0.02, x1: -40, x2: 40, count: 6, slow: true, swim: true, spread: 0.8 },
    ],
    sea: { x1: -35, x2: 35, z1: S.shoreZ - 6, z2: S.shoreZ - 22, shoreZ: S.shoreZ, y: L.SEA_Y, swimmers: 10, bathers: 12 },
    loungers,
  });
  city.add(crowd.group);

  freeze(city);
  ctx.scene.add(city);
  return { city, crowd, sea };
}

// ============================================================ 3 trạm + chuyển trạm
function codePlateTex(code) {
  return labelTexture(`MÃ TRẠM  ${code || '—'}`, { bg: '#0f172a', fg: '#ffffff', w: 1024, h: 180, size: 92, weight: 800 });
}

/** Biển mã trạm gắn mặt trước (bên phải, trên màn hình) */
export function addCodePlate(stationRoot, code) {
  const mat = new THREE.MeshStandardMaterial({ map: codePlateTex(code), roughness: 0.5, emissive: 0xffffff, emissiveIntensity: 0.15 });
  mat.emissiveMap = mat.map;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.053), mat);
  m.position.set(0.58, 1.93, D.FRONT + 0.003);
  m.name = 'codePlate';
  stationRoot.add(m);
  return {
    mesh: m,
    set(c) { mat.map.dispose(); mat.map = codePlateTex(c); mat.emissiveMap = mat.map; mat.needsUpdate = true; },
  };
}

function labelSprite(info, active) {
  const c = document.createElement('canvas'); c.width = 640; c.height = 150;
  const g = c.getContext('2d');
  g.fillStyle = active ? 'rgba(22,163,74,.92)' : 'rgba(15,23,42,.78)';
  g.beginPath(); g.roundRect(4, 4, 632, 142, 36); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center';
  g.font = '800 56px "Be Vietnam Pro", Arial';
  g.fillText(`Trạm ${info.id} · ${info.code || ''}`, 320, 68);
  g.font = '600 34px "Be Vietnam Pro", Arial'; g.fillStyle = 'rgba(255,255,255,.88)';
  g.fillText(active ? 'Đang dùng trạm này' : 'Bấm vào trạm để sang dùng', 320, 118);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(1.5, 0.35, 1);
  s.renderOrder = 5;
  return s;
}

/**
 * setupStations(ctx, street): bản sao tĩnh cho 3 vị trí + biển tên nổi + chuyển trạm.
 * window.STREET = [{id, code, name, ...}] (trái -> phải); trạm đang dùng = window.STATION_ID.
 */
export function setupStations(ctx, street) {
  const infos = (window.STREET && window.STREET.length) ? window.STREET : [{ id: window.STATION_ID || 1, code: '' }];
  const slots = infos.map((info, i) => ({ info, x: L.SLOT_X[infos.length === 1 ? 1 : i] ?? (i - 1) * 7 }));
  let active = Math.max(0, slots.findIndex((s) => s.info.id === window.STATION_ID));
  const city = street.city;

  // kính khúc xạ (transmission) tốn 1 lượt vẽ cả cảnh -> bản sao dùng kính trong suốt thường
  const simpleGlass = new THREE.MeshStandardMaterial({ color: 0xcfe9dc, roughness: 0.2, transparent: true, opacity: 0.35, depthWrite: false });
  const swap = (m) => (m === M.glass || m.transmission > 0 ? simpleGlass : m);
  const pick = (ctx.extraPickables ||= []);
  for (const [i, s] of slots.entries()) {
    const st = buildStation({ prices: ctx.state?.prices });
    addCodePlate(st.root, s.info.code);
    // lòng khoang nạp tối (bản sao không có cơ cấu bên trong)
    st.root.add(mesh(new THREE.BoxGeometry(D.DOOR.x2 - D.DOOR.x1, D.DOOR.y2 - D.DOOR.y1, 0.4), M.cavity,
      (D.DOOR.x1 + D.DOOR.x2) / 2, (D.DOOR.y1 + D.DOOR.y2) / 2, D.FRONT - 0.22));
    const clone = bakeStatic(st.root, { swap });
    clone.position.set(s.x, 0, 0);
    clone.name = `stationClone_${s.info.id}`;
    clone.userData.action = 'station';
    clone.userData.hint = `Trạm ${s.info.id} · ${s.info.code} – bấm để sang dùng trạm này`;
    clone.userData.onClick = () => {
      // điều khiển nhân vật: phải đi bộ tới trạm rồi bấm E
      if (ctx.player?.walking) { toast(`Đi bộ tới Trạm ${s.info.id} rồi bấm E để dùng`, 'info'); return; }
      select(i);
    };
    // bóng đổ giả dưới chân bản sao (nằm ngoài vùng bóng đổ thật của mặt trời)
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.004;
    clone.add(blob);
    city.add(clone);
    pick.push(clone);
    s.clone = clone;
    st.root.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
    const label = labelSprite(s.info, i === active);
    label.position.set(s.x, 3.05, 0.2);
    city.add(label);
    s.label = label;
  }

  const plate = addCodePlate(ctx.station.root, slots[active].info.code);

  function place() {
    city.position.x = -slots[active].x;
    city.updateMatrix();
    slots.forEach((s, i) => {
      s.clone.visible = i !== active;
      const fresh = labelSprite(s.info, i === active);
      s.label.material.map.dispose(); s.label.material.map = fresh.material.map;
      s.label.visible = i !== active;      // trạm đang dùng đã có biển mã trên thân, khỏi che tầm nhìn
    });
    city.updateMatrixWorld(true);
    plate.set(slots[active].info.code);
    document.title = `Trạm ${slots[active].info.id} · ${slots[active].info.code} – Mô phỏng 3D`;
    const sel = document.getElementById('station-select');
    if (sel) sel.value = String(slots[active].info.id);
  }
  place();
  city.matrixWorldAutoUpdate = false;     // khung phố đứng yên: không tính lại ma trận mỗi khung hình

  /** Trạm rảnh (không có người dùng / vật đang chạy) mới được rời đi */
  function idle() {
    const s = ctx.serverState || {};
    const T = ctx.trash || {};
    return s.state === 'IDLE' && !s.intake_busy && !s.sorter?.running && !s.sorter?.belt_busy
      && !(T.tray?.length) && !(T.falling?.length) && !(T.belt?.length)
      && !ctx.mech?.doorOpen && !ctx.mech?.drawerOut && !ctx.rear?.open;
  }

  let moving = false;
  async function select(i, { fly = true } = {}) {
    if (i === active || moving || !slots[i]) return false;
    if (!idle()) {
      toast('Hãy kết thúc phiên và đóng cửa trạm hiện tại trước khi sang trạm khác', 'warning');
      return false;
    }
    moving = true;
    ctx.shop?.close(false);
    const dx = slots[i].x - slots[active].x;
    const v = VIEWS.overview;
    if (fly) {
      await new Promise((res) => {
        flyTo(ctx.camera, ctx.controls, { pos: [v.pos[0] + dx, v.pos[1], v.pos[2]], target: [v.target[0] + dx, v.target[1], v.target[2]] }, 1.4);
        setTimeout(res, 1450);
      });
    }
    // trạm mới về gốc tọa độ: dời khung phố + camera cùng lúc (không thấy giật)
    active = i;
    ctx.camera.position.x -= dx;
    ctx.controls.target.x -= dx;
    ctx.controls.update();
    place();
    ctx.player?.onCityShift(dx);
    const id = slots[i].info.id;
    window.STATION_ID = id;
    history.replaceState(null, '', `?station=${id}`);
    ctx.bridge.switchStation(id);
    if (ctx.screenIframe) ctx.screenIframe.src = `/screen?station=${id}`;
    toast(`Đang dùng Trạm ${id} · ${slots[i].info.code}`, 'info');
    moving = false;
    return true;
  }

  return {
    slots,
    get active() { return active; },
    select,
    selectById: (id, opts) => select(slots.findIndex((s) => s.info.id === Number(id)), opts),
    idle,
    has: (id) => slots.some((s) => s.info.id === Number(id)),
    /** tọa độ X phố -> X trong scene */
    toWorld: (x) => x - slots[active].x,
  };
}
