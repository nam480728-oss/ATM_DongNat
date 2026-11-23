// Xe cộ trên đường: ô tô + xe máy chạy 2 chiều (đi bên phải), giữ khoảng cách xe trước,
// gặp nhân vật / người đi bộ trước mũi xe thì giảm tốc, dừng hẳn, bấm còi; không bao giờ đâm vào người.
// Vẽ bằng InstancedMesh (mỗi bộ phận 1 lệnh vẽ cho mọi xe).
import * as THREE from 'three';
import { L } from './street.js';

const ROAD_Y = -0.15;
const HALF = 58;
const CAR_COLORS = [0xef4444, 0xf8fafc, 0x1f2937, 0x3b82f6, 0x9ca3af, 0xf59e0b, 0x0f766e, 0x7c3aed];
const BIKE_COLORS = [0xdc2626, 0x111827, 0x2563eb, 0xf8fafc, 0x16a34a, 0xea580c];
const SHIRTS = [0x3b82f6, 0xf97316, 0x22c55e, 0xe11d48, 0xfafafa, 0x0ea5e9, 0xfacc15];

function merge(geos) {
  const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  const out = new THREE.BufferGeometry();
  for (const k of ['position', 'normal']) {
    const arr = new Float32Array(parts.reduce((n, g) => n + g.attributes[k].array.length, 0));
    let o = 0;
    for (const g of parts) { arr.set(g.attributes[k].array, o); o += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, 3));
  }
  return out;
}
const wheel = (r, w, x, z) => { const g = new THREE.CylinderGeometry(r, r, w, 12); g.rotateX(Math.PI / 2); g.translate(x, r, z); return g; };

export function setupTraffic(ctx) {
  const city = ctx.street.city;
  const mid = (L.ROAD.z1 + L.ROAD.z2) / 2;
  // làn: hướng +x đi phía +z (bên phải theo chiều đi), hướng -x phía -z
  const lanes = [
    { z: mid + 1.15, dir: 1, kind: 'car' }, { z: L.ROAD.z2 - 0.75, dir: 1, kind: 'bike' },
    { z: mid - 1.15, dir: -1, kind: 'car' }, { z: L.ROAD.z1 + 0.75, dir: -1, kind: 'bike' },
  ];
  const V = [];
  for (const lane of lanes) {
    const n = lane.kind === 'car' ? 4 : 6;
    for (let i = 0; i < n; i++) {
      const cruise = lane.kind === 'car' ? 7.5 + Math.random() * 2.5 : 6 + Math.random() * 2.5;
      V.push({ lane, kind: lane.kind, x: -HALF + (i + Math.random() * 0.6) * (2 * HALF / n), z: lane.z + (Math.random() - 0.5) * 0.3,
        v: cruise, cruise, half: lane.kind === 'car' ? 2.1 : 0.9, wait: 0, honked: 0 });
    }
  }
  const cars = V.filter((v) => v.kind === 'car'), bikes = V.filter((v) => v.kind === 'bike');

  // ---- hình khối (gốc tại tâm xe, đáy ở y = 0, đầu xe hướng +x)
  const std = (o) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45, metalness: 0.2, ...o });
  const carBody = (() => { const a = new THREE.BoxGeometry(4.2, 0.62, 1.75); a.translate(0, 0.62, 0); return a; })();
  const carCabin = (() => { const a = new THREE.BoxGeometry(2.3, 0.55, 1.6); a.translate(-0.2, 1.2, 0); return a; })();
  const carWheels = merge([wheel(0.32, 0.22, 1.35, 0.82), wheel(0.32, 0.22, 1.35, -0.82), wheel(0.32, 0.22, -1.35, 0.82), wheel(0.32, 0.22, -1.35, -0.82)]);
  const carLights = merge([(() => { const g = new THREE.BoxGeometry(0.05, 0.12, 0.35); g.translate(2.11, 0.75, 0.6); return g; })(),
    (() => { const g = new THREE.BoxGeometry(0.05, 0.12, 0.35); g.translate(2.11, 0.75, -0.6); return g; })()]);
  const bikeBody = merge([(() => { const g = new THREE.BoxGeometry(1.5, 0.35, 0.3); g.translate(0, 0.6, 0); return g; })(),
    (() => { const g = new THREE.BoxGeometry(0.5, 0.12, 0.34); g.translate(-0.2, 0.82, 0); return g; })(),
    (() => { const g = new THREE.BoxGeometry(0.08, 0.5, 0.55); g.translate(0.62, 0.95, 0); return g; })()]);
  const bikeWheels = merge([wheel(0.3, 0.1, 0.6, 0), wheel(0.3, 0.1, -0.6, 0)]);
  const rider = merge([(() => { const g = new THREE.BoxGeometry(0.3, 0.55, 0.38); g.translate(-0.15, 1.15, 0); return g; })(),
    (() => { const g = new THREE.BoxGeometry(0.42, 0.14, 0.36); g.translate(0.0, 0.9, 0); return g; })()]);
  const helmet = (() => { const g = new THREE.SphereGeometry(0.15, 10, 8); g.translate(-0.1, 1.58, 0); return g; })();

  const inst = (geo, mat, n, color) => {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
    if (color) for (let i = 0; i < n; i++) m.setColorAt(i, new THREE.Color(color(i)));
    city.add(m);
    return m;
  };
  const M = {
    carBody: inst(carBody, std({ roughness: 0.3, metalness: 0.5 }), cars.length, (i) => CAR_COLORS[i % CAR_COLORS.length]),
    carCabin: inst(carCabin, std({ color: 0x1e293b, roughness: 0.1, metalness: 0.6 }), cars.length),
    carWheels: inst(carWheels, std({ color: 0x111111, roughness: 0.9 }), cars.length),
    carLights: inst(carLights, new THREE.MeshStandardMaterial({ color: 0xfffbe6, emissive: 0xfff3c4, emissiveIntensity: 0.6 }), cars.length),
    bikeBody: inst(bikeBody, std({ roughness: 0.35 }), bikes.length, (i) => BIKE_COLORS[i % BIKE_COLORS.length]),
    bikeWheels: inst(bikeWheels, std({ color: 0x111111, roughness: 0.9 }), bikes.length),
    rider: inst(rider, std({ roughness: 0.8 }), bikes.length, (i) => SHIRTS[i % SHIRTS.length]),
    helmet: inst(helmet, std({ roughness: 0.3 }), bikes.length, (i) => [0xfacc15, 0xffffff, 0xef4444, 0x111827][i % 4]),
  };
  city.updateMatrixWorld(true);

  // ---- còi xe (âm thanh tạo bằng WebAudio, chỉ sau khi người dùng đã thao tác trang)
  let audio = null;
  function honk(kind) {
    try {
      audio ||= new AudioContext();
      const o = audio.createOscillator(), g = audio.createGain();
      o.type = 'square'; o.frequency.value = kind === 'car' ? 420 : 620;
      g.gain.setValueAtTime(0.0001, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.05, audio.currentTime + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.35);
      o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + 0.4);
    } catch { /* trình duyệt chặn âm thanh */ }
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const ident = new THREE.Quaternion();
  const BRAKE = 14;

  /** người đứng trên lòng đường cần nhường: nhân vật + người đi bộ (nếu module khác đăng ký) */
  function pedestrians() {
    const out = [];
    const P = ctx.player?.P;
    if (P && P.z > L.ROAD.z1 - 0.3 && P.z < L.ROAD.z2 + 0.3) out.push({ x: P.x, z: P.z, player: true });
    for (const w of ctx.crossers || []) out.push(w);
    return out;
  }

  ctx.onFrame.push((dt) => {
    const peds = pedestrians();
    const now = performance.now();
    for (const v of V) {
      // khoảng trống phía trước (tính theo chiều chạy)
      let gap = Infinity, byPlayer = false;
      for (const o of V) {
        if (o === v || o.lane.dir !== v.lane.dir || Math.abs(o.z - v.z) > 1.3) continue;
        let d = (o.x - v.x) * v.lane.dir;
        if (d < 0) d += 2 * HALF;                       // vòng lại đầu đường
        d -= o.half + v.half;
        if (d < gap) gap = d;
      }
      for (const ped of peds) {
        if (Math.abs(ped.z - v.z) > (v.kind === 'car' ? 1.45 : 0.9)) continue;
        const d = (ped.x - v.x) * v.lane.dir - v.half - 0.5;
        if (d > -0.4 && d < gap) { gap = Math.max(0, d); byPlayer = !!ped.player; }
      }
      const target = gap < 1.2 ? 0 : Math.min(v.cruise, v.cruise * (gap - 1.2) / BRAKE);
      const dv = target - v.v;
      v.v += Math.max(-9 * dt, Math.min(dv, 2.5 * dt));
      if (gap < 0.3) v.v = 0;                            // sát người: đứng im tuyệt đối
      v.x += v.lane.dir * v.v * dt;
      if (v.x > HALF) v.x -= 2 * HALF; else if (v.x < -HALF) v.x += 2 * HALF;
      // bị nhân vật chặn đường quá 1,2 giây -> bấm còi (cách nhau ít nhất 4 giây)
      v.wait = byPlayer && v.v < 0.3 ? v.wait + dt : 0;
      if (v.wait > 1.2 && now - v.honked > 4000) { v.honked = now; honk(v.kind); }
    }
    cars.forEach((v, i) => {
      p.set(v.x, ROAD_Y, v.z);
      m4.compose(p, v.lane.dir > 0 ? ident : flip, one);
      for (const k of ['carBody', 'carCabin', 'carWheels', 'carLights']) M[k].setMatrixAt(i, m4);
    });
    bikes.forEach((v, i) => {
      p.set(v.x, ROAD_Y, v.z);
      q.copy(v.lane.dir > 0 ? ident : flip);
      m4.compose(p, q, one);
      for (const k of ['bikeBody', 'bikeWheels', 'rider', 'helmet']) M[k].setMatrixAt(i, m4);
    });
    Object.values(M).forEach((m) => { m.instanceMatrix.needsUpdate = true; });
  });

  ctx.traffic = { vehicles: V };
  return ctx.traffic;
}
