// Người 3D phong cách low-poly: người đi bộ trên 2 vỉa hè, đi dạo / nằm phơi nắng trên cát, bơi và tắm dưới biển.
// Cả đám đông vẽ bằng InstancedMesh (mỗi bộ phận 1 draw call cho mọi người) -> vài chục người vẫn nhẹ máy.
// makePerson(): 1 người riêng (khớp tay / chân xoay được) – dùng làm người đang đứng dùng trạm (camera giám sát chụp).
import * as THREE from 'three';

const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac];
const SHIRT = [0xef4444, 0x3b82f6, 0x22c55e, 0xf59e0b, 0xffffff, 0xa855f7, 0x14b8a6, 0xf472b6, 0x1f2937, 0xfde047];
const SHORTS = [0x1e3a8a, 0x111827, 0x78716c, 0x0f766e, 0x7c2d12, 0x2563eb];
const HAIR = [0x1c1917, 0x292524, 0x44403c, 0x78350f, 0x0c0a09];
const SWIM = [0xdc2626, 0x2563eb, 0x0d9488, 0xdb2777, 0xf97316, 0x111827];

// Kích thước người (m) – cao ~1,65 m
const P = { hipY: 0.86, legL: 0.82, shoulderY: 1.38, armL: 0.62, torsoH: 0.5, headY: 1.55 };

function rnd(a) { return a[Math.floor(Math.random() * a.length)]; }

/** Geometry các bộ phận (đã dời gốc về khớp xoay: hông / vai) */
function partGeos() {
  const leg = new THREE.BoxGeometry(0.13, P.legL, 0.14); leg.translate(0, -P.legL / 2, 0);
  const arm = new THREE.BoxGeometry(0.085, P.armL, 0.095); arm.translate(0, -P.armL / 2, 0);
  const torso = new THREE.BoxGeometry(0.36, P.torsoH, 0.2); torso.translate(0, P.shoulderY - P.torsoH / 2 + 0.03, 0);
  const hips = new THREE.BoxGeometry(0.34, 0.16, 0.2); hips.translate(0, P.hipY + 0.02, 0);
  const head = new THREE.SphereGeometry(0.11, 12, 9); head.translate(0, P.headY, 0);
  const hair = new THREE.SphereGeometry(0.117, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55); hair.translate(0, P.headY + 0.01, -0.01);
  return { leg, arm, torso, hips, head, hair };
}

// ============================================================ 1 người riêng (người dùng trạm)
export function makePerson({ shirt = 0x2563eb, shorts = 0x1f2937, skin = 0xe0ac69, hair = 0x1c1917 } = {}) {
  const G = partGeos();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
  const g = new THREE.Group();
  const add = (geo, m, parent = g) => { const o = new THREE.Mesh(geo, m); o.castShadow = true; o.receiveShadow = true; parent.add(o); return o; };
  add(G.torso, mat(shirt)); add(G.hips, mat(shorts)); add(G.head, mat(skin)); add(G.hair, mat(hair));
  const joint = (x, y) => { const j = new THREE.Group(); j.position.set(x, y, 0); g.add(j); return j; };
  const legL = joint(-0.09, P.hipY), legR = joint(0.09, P.hipY);
  const armL = joint(-0.225, P.shoulderY), armR = joint(0.225, P.shoulderY);
  add(G.leg, mat(shorts), legL); add(G.leg, mat(shorts), legR);
  const skinM = mat(skin);
  add(G.arm, skinM, armL); add(G.arm, skinM, armR);
  g.userData.joints = { legL, legR, armL, armR };
  return g;
}

// ============================================================ đám đông (instanced)
/**
 * buildCrowd(paths) – paths: { walkLanes: [{z, y, x1, x2}], beach: {...}, sea: {...}, loungers: [{x,z,y,rot}] }
 * Trả về { group, update(dt, t, camPos), setDensity(0..1) }
 */
export function buildCrowd(layout) {
  const G = partGeos();
  const people = [];
  const add = (p) => people.push({ skin: rnd(SKIN), hair: rnd(HAIR), speed: 1, phase: Math.random() * 10, ...p });

  // người đi bộ trên vỉa hè (2 chiều, nhiều làn), đi dạo trên cát
  for (const lane of layout.walkLanes) {
    for (let i = 0; i < lane.count; i++) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      add({ kind: 'walk', lane, dir, x: lane.x1 + Math.random() * (lane.x2 - lane.x1), z: lane.z + (Math.random() - 0.5) * (lane.spread || 0.3),
        speed: (lane.slow ? 0.7 : 1.15) + Math.random() * 0.35, shirt: lane.swim ? rnd(SWIM) : rnd(SHIRT),
        shorts: rnd(SHORTS), bare: !!lane.swim });
    }
  }
  // bơi (chỉ thấy đầu, vai, tay sải) + đứng tắm ngâm nước
  const S = layout.sea;
  for (let i = 0; i < S.swimmers; i++) {
    add({ kind: 'swim', x: S.x1 + Math.random() * (S.x2 - S.x1), z: S.z1 + Math.random() * (S.z2 - S.z1), dir: Math.random() < 0.5 ? 1 : -1,
      speed: 0.35 + Math.random() * 0.25, shirt: rnd(SKIN), shorts: rnd(SWIM), bare: true, y: S.y });
  }
  for (let i = 0; i < S.bathers; i++) {
    add({ kind: 'bathe', x: S.x1 + Math.random() * (S.x2 - S.x1), z: S.shoreZ - 1.5 - Math.random() * 5, dir: 1, rot: Math.random() * Math.PI * 2,
      shirt: rnd(SWIM), shorts: rnd(SWIM), bare: true, y: S.y, depth: 0.45 + Math.random() * 0.5 });
  }
  // nằm phơi nắng dưới dù
  for (const l of layout.loungers) add({ kind: 'lie', x: l.x, z: l.z, y: l.y, rot: l.rot, shirt: rnd(SWIM), shorts: rnd(SWIM), bare: true });

  const n = people.length;
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const mk = (geo, count) => {
    const m = new THREE.InstancedMesh(geo, mat, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true; m.receiveShadow = true;
    m.frustumCulled = false;   // người di chuyển khắp nơi: khung bao của geometry gốc không đúng
    return m;
  };
  const mesh = { torso: mk(G.torso, n), hips: mk(G.hips, n), head: mk(G.head, n), hair: mk(G.hair, n), leg: mk(G.leg, n * 2), arm: mk(G.arm, n * 2) };
  const c = new THREE.Color();
  people.forEach((p, i) => {
    mesh.torso.setColorAt(i, c.setHex(p.bare && p.kind !== 'walk' ? p.skin : p.shirt));
    mesh.hips.setColorAt(i, c.setHex(p.shorts));
    mesh.head.setColorAt(i, c.setHex(p.skin));
    mesh.hair.setColorAt(i, c.setHex(p.hair));
    for (const k of [0, 1]) {
      mesh.leg.setColorAt(i * 2 + k, c.setHex(p.bare || Math.random() < 0.5 ? p.skin : p.shorts));
      mesh.arm.setColorAt(i * 2 + k, c.setHex(p.skin));
    }
  });
  const group = new THREE.Group();
  group.name = 'crowd';
  Object.values(mesh).forEach((m) => { m.instanceColor.needsUpdate = true; group.add(m); });

  const base = new THREE.Matrix4(), part = new THREE.Matrix4(), rot = new THREE.Matrix4(), tmp = new THREE.Matrix4();
  const q = new THREE.Quaternion(), pos = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Matrix4().makeScale(0, 0, 0);
  const eY = new THREE.Euler();
  let visibleCount = n;
  const camLocal = new THREE.Vector3();

  function limb(m, idx, x, y, angleX, angleZ = 0) {
    part.makeTranslation(x, y, 0);
    rot.makeRotationFromEuler(eY.set(angleX, 0, angleZ));
    tmp.multiplyMatrices(base, part).multiply(rot);
    m.setMatrixAt(idx, tmp);
  }

  function update(dt, t, camWorld) {
    if (camWorld) { camLocal.copy(camWorld); group.worldToLocal(camLocal); }
    for (let i = 0; i < n; i++) {
      const p = people[i];
      if (i >= visibleCount) {
        for (const m of [mesh.torso, mesh.hips, mesh.head, mesh.hair]) m.setMatrixAt(i, zero);
        for (const k of [0, 1]) { mesh.leg.setMatrixAt(i * 2 + k, zero); mesh.arm.setMatrixAt(i * 2 + k, zero); }
        continue;
      }
      let swing = 0, armSwing = 0, armZ = 0, yaw = 0, y = p.y ?? 0, pitch = 0, legSpread = 0;
      if (p.kind === 'walk') {
        p.x += p.dir * p.speed * dt;
        const L = p.lane;
        if (p.x > L.x2) p.x = L.x1; else if (p.x < L.x1) p.x = L.x2;
        const ph = (p.x * p.dir) * (Math.PI / 0.72) + p.phase;   // bước chân theo quãng đường (không trượt)
        swing = Math.sin(ph) * 0.55; armSwing = -swing * 0.8;
        yaw = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        y = (L.y || 0) + Math.abs(Math.cos(ph)) * 0.025;
      } else if (p.kind === 'swim') {
        p.x += p.dir * p.speed * dt;
        if (p.x > layout.sea.x2) p.dir = -1; else if (p.x < layout.sea.x1) p.dir = 1;
        yaw = p.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
        pitch = 1.25;                                      // nằm sấp trên mặt nước
        const ph = t * 2.6 + p.phase;
        armSwing = ph % (Math.PI * 2); armZ = 0;           // tay sải tròn
        swing = Math.sin(ph * 2) * 0.35;
        y = p.y - 0.95 + Math.sin(t * 1.3 + p.phase) * 0.04;
      } else if (p.kind === 'bathe') {
        yaw = p.rot + Math.sin(t * 0.3 + p.phase) * 0.4;
        y = p.y - p.depth + Math.sin(t * 1.2 + p.phase) * 0.06;  // sóng nhấp nhô
        armZ = 0.5 + Math.sin(t * 1.7 + p.phase) * 0.35;
        legSpread = 0.08;
      } else if (p.kind === 'lie') {
        yaw = p.rot; pitch = -Math.PI / 2; y = p.y + 0.02;
        armZ = 0.25; armSwing = Math.PI;                   // gối tay sau đầu
      }
      // ẩn người đứng sát camera (không che tầm nhìn khi zoom gần)
      if (camWorld && Math.hypot(p.x - camLocal.x, p.z - camLocal.z) < 0.7 && Math.abs(y + 1 - camLocal.y) < 1.4) {
        for (const m of [mesh.torso, mesh.hips, mesh.head, mesh.hair]) m.setMatrixAt(i, zero);
        for (const k of [0, 1]) { mesh.leg.setMatrixAt(i * 2 + k, zero); mesh.arm.setMatrixAt(i * 2 + k, zero); }
        continue;
      }
      pos.set(p.x, y, p.z);
      if (pitch) {
        // xoay quanh hông cho tư thế nằm / bơi
        q.setFromEuler(eY.set(0, yaw, 0));
        base.compose(pos, q, one);
        base.multiply(part.makeTranslation(0, P.hipY * (p.kind === 'lie' ? 0.12 : 1), 0))
          .multiply(rot.makeRotationX(pitch)).multiply(part.makeTranslation(0, -P.hipY, 0));
      } else {
        q.setFromEuler(eY.set(0, yaw, 0));
        base.compose(pos, q, one);
      }
      mesh.torso.setMatrixAt(i, base); mesh.hips.setMatrixAt(i, base); mesh.head.setMatrixAt(i, base); mesh.hair.setMatrixAt(i, base);
      limb(mesh.leg, i * 2, -0.09, P.hipY, swing, -legSpread);
      limb(mesh.leg, i * 2 + 1, 0.09, P.hipY, -swing, legSpread);
      if (p.kind === 'swim') {
        limb(mesh.arm, i * 2, -0.225, P.shoulderY, armSwing, 0);
        limb(mesh.arm, i * 2 + 1, 0.225, P.shoulderY, armSwing + Math.PI, 0);
      } else {
        limb(mesh.arm, i * 2, -0.225, P.shoulderY, armSwing, -armZ);
        limb(mesh.arm, i * 2 + 1, 0.225, P.shoulderY, p.kind === 'lie' ? armSwing : -armSwing, armZ);
      }
    }
    Object.values(mesh).forEach((m) => { m.instanceMatrix.needsUpdate = true; });
  }
  update(0, 0);

  return {
    group, count: n,
    update,
    /** Mật độ người 0..1 (chế độ đồ họa thấp bớt người) */
    setDensity(d) { visibleCount = Math.round(n * THREE.MathUtils.clamp(d, 0, 1)); },
    setShadows(on) { Object.values(mesh).forEach((m) => { m.castShadow = on; }); },
  };
}
