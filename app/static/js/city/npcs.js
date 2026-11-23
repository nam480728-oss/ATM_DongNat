// Người 3D có "việc": thỉnh thoảng có người rẽ vào trạm bỏ chai qua lỗ từ thiện hoặc bỏ rác vào thùng mini
// (chỉ hoạt ảnh – không vật lý, không ghi CSDL), và người qua đường ở vạch kẻ trước cửa hàng (xe cộ nhường).
import * as THREE from 'three';
import { makePerson } from './people.js';
import { L } from './street.js';
import { D, publicX } from '../station/dims.js';
import { groundY } from '../player/player.js';

const SPEED = 1.25;
const SHIRTS = [0xf43f5e, 0x0ea5e9, 0xa3e635, 0xfbbf24, 0x8b5cf6, 0xffffff, 0x14b8a6];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export function setupNpcs(ctx) {
  const city = ctx.street.city;
  const slots = ctx.stations.slots;
  const actors = [];
  const crossRefs = new Map();
  ctx.crossers = [];
  const bottleMat = new THREE.MeshStandardMaterial({ color: 0xbfe3f5, roughness: 0.2, transparent: true, opacity: 0.85 });
  const trashMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 });

  function spawn(kind, path) {
    const body = makePerson({ shirt: pick(SHIRTS), shorts: pick([0x1e3a8a, 0x111827, 0x78716c]), skin: pick([0xf1c27d, 0xe0ac69, 0xc68642]) });
    body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    city.add(body);
    const a = { kind, body, path, i: 0, x: path[0].x, z: path[0].z, yaw: 0, phase: 0, busy: 0, J: body.userData.joints, walk: true };
    actors.push(a);
    return a;
  }
  function despawn(a) {
    const ref = crossRefs.get(a);
    if (ref && ctx.crossers.includes(ref)) ctx.crossers.splice(ctx.crossers.indexOf(ref), 1);
    crossRefs.delete(a);
    city.remove(a.body);
    a.body.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    actors.splice(actors.indexOf(a), 1);
  }

  // ---------------------------------------------------------------- người bỏ rác
  function stationBusyByPlayer(i) {
    if (i !== ctx.stations.active) return false;
    const s = ctx.serverState || {};
    const P = ctx.player?.P;
    return !!s.user || ctx.player?.mode === 'use' || (P && Math.hypot(P.x - slots[i].x, P.z - 1.2) < 3);
  }
  function spawnDropper() {
    const free = slots.map((s, i) => i).filter((i) => !stationBusyByPlayer(i));
    if (!free.length) return;
    const s = slots[pick(free)];
    const side = Math.random() < 0.5 ? -1 : 1;
    const laneZ = 2.9 + (Math.random() - 0.5) * 0.4;
    const toSlot = Math.random() < 0.6;
    let stand, face, hole, item;
    if (toSlot) {   // đút chai qua lỗ từ thiện
      stand = { x: s.x + D.SLOT.x, z: D.FRONT + 0.48 };
      face = Math.PI;
      hole = new THREE.Vector3(s.x + D.SLOT.x, D.SLOT.y, D.FRONT - 0.02);
      item = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 10), bottleMat);
    } else {        // rác thường vào thùng mini bên hông
      const bs = Math.random() < 0.5 ? 'left' : 'right';
      const px = s.x + publicX(bs);
      const out = bs === 'left' ? -1 : 1;
      stand = { x: px + out * 0.62, z: D.PUBLIC.z + 0.05 };
      face = out > 0 ? -Math.PI / 2 : Math.PI / 2;
      hole = new THREE.Vector3(px + out * 0.12, D.PUBLIC.y + D.PUBLIC.h / 2 - 0.05, D.PUBLIC.z);
      item = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.1), trashMat);
    }
    const startX = s.x + side * 16, endX = s.x - side * 16;
    const path = [
      { x: startX, z: laneZ }, { x: stand.x + side * 1.2, z: laneZ },
      { x: stand.x, z: Math.max(stand.z, 1.4) }, { ...stand, act: 'drop', face, hole, item },
      { x: stand.x - side * 1.2, z: laneZ }, { x: endX, z: laneZ, end: true },
    ];
    spawn('dropper', path);
  }

  function dropAnim(a, wp) {
    const gs = window.gsap;
    a.walk = false;
    a.busy = 1;
    const item = wp.item;
    const hand = new THREE.Vector3(a.x + Math.sin(a.yaw) * 0.25, 1.15, a.z + Math.cos(a.yaw) * 0.25);
    item.position.copy(hand);
    city.add(item);
    gs.to(a.J.armR.rotation, { x: -1.4, duration: 0.45, ease: 'power2.out' });
    gs.to(item.position, { x: wp.hole.x, y: wp.hole.y, z: wp.hole.z, duration: 0.55, delay: 0.35, ease: 'power1.inOut',
      onUpdate: () => item.updateMatrixWorld(),
      onComplete: () => {
        city.remove(item); item.geometry.dispose();
        gs.to(a.J.armR.rotation, { x: 0, duration: 0.35 });
        setTimeout(() => { a.busy = 0; a.walk = true; a.i++; }, 450);
      } });
  }

  // ---------------------------------------------------------------- người qua đường (vạch kẻ trước cửa hàng)
  function spawnCrosser() {
    const x = L.SHOP.x + (Math.random() - 0.5) * 3.2;
    const north = Math.random() < 0.5;        // từ vỉa hè trạm sang cửa hàng hay ngược lại
    const z1 = L.WALK.z2 - 0.5, z2 = L.OPP.z1 + 0.5;
    const away = x + (Math.random() < 0.5 ? -1 : 1) * 18;
    const path = north
      ? [{ x: away, z: 3.2 }, { x, z: z1 }, { x, z: z2, cross: true }, { x: x + (away - x) * -1, z: 12.4, end: true }]
      : [{ x: away, z: 12.4 }, { x, z: z2 }, { x, z: z1, cross: true }, { x: x + (away - x) * -1, z: 3.2, end: true }];
    spawn('crosser', path);
  }

  // ---------------------------------------------------------------- vòng lặp
  let tDrop = 6, tCross = 3;
  ctx.onFrame.push((dt) => {
    tDrop -= dt; tCross -= dt;
    if (tDrop <= 0) { tDrop = 18 + Math.random() * 18; if (actors.filter((a) => a.kind === 'dropper').length < 2) spawnDropper(); }
    if (tCross <= 0) { tCross = 10 + Math.random() * 12; if (actors.filter((a) => a.kind === 'crosser').length < 2) spawnCrosser(); }

    for (const a of [...actors]) {
      const wp = a.path[a.i];
      if (!wp) { despawn(a); continue; }
      let moving = false;
      if (a.walk) {
        // người qua đường: chờ xe trước khi bước xuống lòng đường
        const onRoadNext = wp.cross && !crossRefs.get(a);
        if (onRoadNext) {
          const danger = ctx.traffic?.vehicles.some((v) => {
            const d = (a.x - v.x) * v.lane.dir;
            return d > 0 && d < 9 && v.v > 1.5;
          });
          if (danger) { a.phase = 0; }
          else crossRefs.set(a, { x: a.x, z: a.z });
        }
        if (!onRoadNext || crossRefs.get(a)) {
          const dx = wp.x - a.x, dz = wp.z - a.z, d = Math.hypot(dx, dz);
          if (d < 0.05) {
            if (wp.act === 'drop') { a.yaw = wp.face; dropAnim(a, wp); }
            else if (wp.end) { despawn(a); continue; }
            else a.i++;
          } else {
            const step = Math.min(d, SPEED * dt);
            a.x += (dx / d) * step; a.z += (dz / d) * step;
            const want = Math.atan2(dx, dz);
            let dy = want - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            a.yaw += dy * Math.min(1, dt * 10);
            a.phase += step * 4.3;
            moving = true;
          }
        }
      }
      // đăng ký người đang ở lòng đường để xe nhường
      const ref = crossRefs.get(a);
      if (ref) {
        ref.x = a.x; ref.z = a.z;
        const onRoad = a.z > L.ROAD.z1 - 0.5 && a.z < L.ROAD.z2 + 0.5;
        if (onRoad && !ctx.crossers.includes(ref)) ctx.crossers.push(ref);
        if (!onRoad && ctx.crossers.includes(ref) && !wp?.cross) { ctx.crossers.splice(ctx.crossers.indexOf(ref), 1); crossRefs.delete(a); }
      }
      const sw = moving ? Math.sin(a.phase) * 0.5 : 0;
      a.J.legL.rotation.x = sw; a.J.legR.rotation.x = -sw;
      if (!a.busy) { a.J.armL.rotation.x = -sw * 0.8; a.J.armR.rotation.x = sw * 0.8; }
      a.body.position.set(a.x, groundY(a.x, a.z), a.z);
      a.body.rotation.y = a.yaw;
      a.body.updateMatrixWorld(true);     // khung phố đóng băng ma trận -> tự cập nhật người đang đi
    }
  });
  ctx.npcs = { actors, spawnDropper, spawnCrosser };
  return ctx.npcs;
}
