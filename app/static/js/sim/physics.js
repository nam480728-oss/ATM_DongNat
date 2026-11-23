// Vật lý thật bằng Rapier (WASM): rác rơi, lăn, va nhau, lật trong phễu nón, chạy trên băng chuyền, bị thanh gạt
// đẩy rơi xuống máng vào thùng. Cơ cấu máy (khay, cánh phễu, thanh gạt, xe thùng) là vật "kinematic" bám theo
// mesh đang được gsap điều khiển; mesh hộp có userData.phys ('fixed' | 'kin') được tự tạo khối va chạm.
import * as THREE from 'three';
import RAPIER from '../../vendor/rapier/rapier.es.js';
import { D } from '../station/dims.js';

const CYL = new Set(['bottle_500', 'bottle_1500', 'can_tall', 'can_short', 'can_dented', 'glass_bottle', 'cup_straw', 'paper_cup']);
const DENSITY = { glass_bottle: 700, can_tall: 120, can_short: 120, can_dented: 120, foam_box: 30, plastic_bag: 40, paper_ball: 60 };
const H = 1 / 120;                       // bước mô phỏng

export async function setupPhysics(ctx) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = H;
  world.integrationParameters.numSolverIterations = 8;
  const P = { world, RAPIER, items: new Map(), kin: [], beltRunning: false, enabled: true };
  ctx.physics = P;

  const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const v3 = (v) => ({ x: v.x, y: v.y, z: v.z });
  const q4 = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });

  // mặt đất + sàn trạm
  world.createCollider(RAPIER.ColliderDesc.cuboid(30, 0.05, 30).setTranslation(0, -0.05, 0));
  world.createCollider(RAPIER.ColliderDesc.cuboid(D.W / 2, 0.01, D.DEPTH / 2).setTranslation(0, D.PLINTH + D.T - 0.01, 0));

  function boxCollider(mesh) {
    const prm = mesh.geometry.parameters;
    mesh.updateWorldMatrix(true, false);
    mesh.matrixWorld.decompose(_p, _q, _s);
    const hx = Math.max(0.006, (prm.width * Math.abs(_s.x)) / 2);
    const hy = Math.max(0.006, (prm.height * Math.abs(_s.y)) / 2);
    const hz = Math.max(0.006, (prm.depth * Math.abs(_s.z)) / 2);
    return RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.6).setRestitution(0.05);
  }

  /** Tạo khối va chạm cho mọi mesh hộp có userData.phys trong root */
  P.addTagged = (root) => {
    root.updateWorldMatrix(true, true);
    root.traverse((m) => {
      if (!m.isMesh || !m.userData.phys || m.userData.physAdded || m.geometry.type !== 'BoxGeometry') return;
      m.userData.physAdded = true;
      m.matrixWorld.decompose(_p, _q, _s);
      const kin = m.userData.phys === 'kin';
      const desc = (kin ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed())
        .setTranslation(_p.x, _p.y, _p.z).setRotation(q4(_q));
      const body = world.createRigidBody(desc);
      const cd = boxCollider(m);
      // ma sát riêng (inox bóng / máng trượt): lấy ma sát NHỎ NHẤT giữa 2 bề mặt -> vật trượt thật sự
      if (m.userData.friction != null) cd.setFriction(m.userData.friction).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min);
      world.createCollider(cd, body);
      if (kin) P.kin.push({ mesh: m, body });
    });
  };

  // ---------------------------------------------------------------- vật rác
  /** Thêm vật (mesh đã đặt đúng chỗ trong không gian) làm vật thể động */
  P.addItem = (item, { kinematic = false, linvel, angvel } = {}) => {
    item.updateWorldMatrix(true, false);
    item.matrixWorld.decompose(_p, _q, _s);
    const desc = (kinematic ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic())
      .setTranslation(_p.x, _p.y, _p.z).setRotation(q4(_q))
      .setLinearDamping(0.15).setAngularDamping(0.6).setCcdEnabled(true);
    const body = world.createRigidBody(desc);
    const s = item.userData.size, type = item.userData.type;
    let cd;
    if (CYL.has(type)) {
      cd = RAPIER.ColliderDesc.cylinder(s.x / 2, Math.max(s.y, s.z) / 2 * 0.96)
        .setRotation({ x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 });       // trục trụ dọc theo X của vật
    } else {
      cd = RAPIER.ColliderDesc.roundCuboid(s.x / 2 - 0.004, s.y / 2 - 0.004, s.z / 2 - 0.004, 0.004);
    }
    cd.setDensity(DENSITY[type] ?? 90).setFriction(0.55).setRestitution(0.12);
    world.createCollider(cd, body);
    if (linvel) body.setLinvel(linvel, true);
    if (angvel) body.setAngvel(angvel, true);
    P.items.set(item, body);
    return body;
  };
  P.remove = (item) => {
    const b = P.items.get(item);
    if (b) { world.removeRigidBody(b); P.items.delete(item); poses.delete(b); }
  };
  P.has = (item) => P.items.has(item);
  P.body = (item) => P.items.get(item);
  /** kinematic: mesh điều khiển (tay gắp cầm, ngăn kéo đang trượt); dynamic: vật lý điều khiển */
  P.setKinematic = (item, on) => {
    const b = P.items.get(item);
    if (!b) return;
    // đặt thân vật lý đúng chỗ mesh đang đứng (mesh có thể vừa được tay gắp / ngăn kéo di chuyển)
    item.updateWorldMatrix(true, false);
    item.matrixWorld.decompose(_p, _q, _s);
    b.setBodyType(on ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
    b.setTranslation(v3(_p), true);
    b.setRotation(q4(_q), true);
    if (!on) { b.setLinvel({ x: 0, y: 0, z: 0 }, true); b.setAngvel({ x: 0, y: 0, z: 0 }, true); }
  };
  P.impulse = (item, i, wake = true) => P.items.get(item)?.applyImpulse(i, wake);
  P.torque = (item, t) => P.items.get(item)?.applyTorqueImpulse(t, true);
  P.speed = (item) => { const v = P.items.get(item)?.linvel(); return v ? Math.hypot(v.x, v.y, v.z) : 0; };

  // ---------------------------------------------------------------- băng chuyền: vật nằm trên băng chạy theo băng
  const B = D.BELT;
  // Chạy băng chính xác theo thời gian mô phỏng (không phụ thuộc FPS):
  //   runBelt({ seconds }) chạy đúng bấy nhiêu giây; runBelt({ item, x }) chạy tới khi vật tới tọa độ x;
  //   runBelt({ until, max }) chạy tới khi until() đúng hoặc hết max giây.
  let beltJob = null;
  P.runBelt = (job) => new Promise((resolve) => {
    beltJob = { ...job, t: 0, resolve };
    P.beltRunning = true;
  });
  function beltTick() {
    if (!beltJob) return;
    beltJob.t += H;
    const done = beltJob.seconds != null ? beltJob.t >= beltJob.seconds - 1e-9
      : beltJob.until ? beltJob.until() || beltJob.t >= (beltJob.max ?? 10)
      : beltJob.item ? (P.items.get(beltJob.item)?.translation().x ?? Infinity) >= beltJob.x || beltJob.t > 10 : true;
    if (done) {
      P.beltRunning = false;
      for (const [, b] of P.items) {                       // băng dừng: vật trên băng dừng theo
        if (!b.isDynamic()) continue;
        const t = b.translation();
        if (Math.abs(t.z - B.z) < B.w / 2 + 0.02 && t.y < B.y + 0.13 && t.y > B.y - 0.02) { const v = b.linvel(); b.setLinvel({ x: 0, y: v.y, z: v.z }, true); }
      }
      const { resolve } = beltJob;
      beltJob = null;
      resolve();
    }
  }
  function conveyor() {
    if (!P.beltRunning) return;
    for (const [, b] of P.items) {
      if (!b.isDynamic()) continue;
      const t = b.translation();
      if (t.x < B.x1 - 0.02 || t.x > B.x2 + 0.01 || Math.abs(t.z - B.z) > B.w / 2 + 0.02 || t.y > B.y + 0.13 || t.y < B.y - 0.02) continue;
      const v = b.linvel();
      // qua tấm gạt chéo cuối băng: vật bị lái sang mép -Z, rơi vào thùng 'khác'
      if (t.x > B.endX - 0.16 + (B.z + B.w / 2 - t.z) * 1.15) b.setLinvel({ x: B.speed * 0.25, y: v.y, z: -B.speed }, true);
      else b.setLinvel({ x: B.speed, y: v.y, z: v.z * 0.9 }, true);
    }
  }

  // ---------------------------------------------------------------- vòng lặp
  // Bộ phận máy (kinematic) được nội suy giữa tư thế khung hình trước và khung hình này qua từng bước con
  // -> kể cả khi trình duyệt tụt FPS, khay / thanh gạt không "nhảy cóc" xuyên qua vật.
  const toLocal = new THREE.Matrix4();
  const poses = new Map();          // body -> {p0, q0, p1, q1}
  const _p2 = new THREE.Vector3(), _q2 = new THREE.Quaternion();
  function capturePoses() {
    const take = (obj, body) => {
      obj.updateWorldMatrix(true, false);
      obj.matrixWorld.decompose(_p, _q, _s);
      let e = poses.get(body);
      if (!e) { e = { p0: _p.clone(), q0: _q.clone(), p1: new THREE.Vector3(), q1: new THREE.Quaternion() }; poses.set(body, e); }
      else { e.p0.copy(e.p1); e.q0.copy(e.q1); }
      e.p1.copy(_p); e.q1.copy(_q);
      if (e.fresh) { e.p0.copy(_p); e.q0.copy(_q); }
      e.fresh = false;
    };
    for (const { mesh, body } of P.kin) take(mesh, body);
    for (const [item, body] of P.items) {
      if (body.isKinematic()) take(item, body);
      else { const e = poses.get(body); if (e) e.fresh = true; }        // khi thành kinematic lại thì bắt đầu từ chỗ đứng
    }
  }
  function syncKinematic(alpha) {
    for (const [body, e] of poses) {
      if (!body.isKinematic() || e.fresh) continue;
      _p2.lerpVectors(e.p0, e.p1, alpha);
      _q2.slerpQuaternions(e.q0, e.q1, alpha);
      body.setNextKinematicTranslation(v3(_p2));
      body.setNextKinematicRotation(q4(_q2));
    }
  }
  function syncItems() {
    for (const [item, body] of P.items) {
      if (!body.isDynamic() || !item.parent) continue;
      const t = body.translation(), r = body.rotation();
      _p.set(t.x, t.y, t.z); _q.set(r.x, r.y, r.z, r.w);
      item.parent.updateWorldMatrix(true, false);
      toLocal.copy(item.parent.matrixWorld).invert();
      _p.applyMatrix4(toLocal);
      item.position.copy(_p);
      item.quaternion.copy(item.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(_q));
      // văng ra ngoài vùng máy (lỗi hiếm của mô phỏng) -> báo cho module rác đặt lại đúng chỗ
      // (khay rút ra nhô khỏi mặt trước tới FRONT + travel)
      if (t.y < 0.03 || t.z > D.FRONT + D.TRAY.travel + 0.15 || t.z < -D.FRONT - 0.05 || Math.abs(t.x) > D.W / 2 + 0.05) P.onLost?.(item, body);
    }
  }

  // việc cần làm SAU khi các bộ phận máy đã tới tư thế mới (vd thả vật khỏi khay vừa trượt xong)
  const later = [];
  P.afterCatchUp = (fn) => later.push({ fn, frames: 2 });
  let acc = 0;
  ctx.onFrame.push((dt) => {
    if (!P.enabled) return;
    const scale = window.gsap?.globalTimeline.timeScale() || 1;
    acc = Math.min(acc + dt * scale, H * 60);
    const n = Math.floor(acc / H);
    capturePoses();
    // không có vật rác nào: khỏi bước mô phỏng (máy chỉ có vật cố định / cơ cấu chạy không tải)
    const idle = !P.items.size && !beltJob;
    for (let i = 1; i <= (idle ? 0 : n); i++) {
      syncKinematic(i / n);
      conveyor();
      world.step();
      beltTick();
    }
    acc -= n * H;
    syncItems();
    for (let i = later.length - 1; i >= 0; i--) if (--later[i].frames <= 0) { const { fn } = later.splice(i, 1)[0]; fn(); }
  });
  return P;
}
