// Bản đồ nhỏ góc dưới bên trái: biển, bãi cát, vỉa hè, đường, cửa hàng, 3 trạm (trạm đang dùng viền sáng),
// rác trên đường (chấm vàng), xe cộ, người bỏ rác, nhân vật (mũi tên theo hướng nhìn) + hình quạt tầm nhìn camera.
// Bấm vào bản đồ: cắm cờ đích đến (hiện cột sáng trong cảnh 3D + khoảng cách). Bấm nút +/− để đổi tỉ lệ.
import * as THREE from 'three';
import { L } from '../city/street.js';

export function setupMinimap(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'minimap';
  wrap.innerHTML = `<canvas width="220" height="220" aria-label="Bản đồ nhỏ"></canvas>
    <div class="mm-tools"><button type="button" data-z="1" aria-label="Phóng to">+</button><button type="button" data-z="-1" aria-label="Thu nhỏ">−</button></div>
    <div class="mm-info"></div>`;
  document.body.appendChild(wrap);
  const cv = wrap.querySelector('canvas');
  const g = cv.getContext('2d');
  const info = wrap.querySelector('.mm-info');
  const W = cv.width, H = cv.height;
  let scale = 4.5;                 // px / m
  let goal = null;

  // cột sáng đánh dấu đích (trong khung phố)
  const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 6, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide }));
  beacon.visible = false;
  ctx.street.city.add(beacon);

  // tâm bản đồ: nhân vật (hoặc tâm nhìn camera khi không có nhân vật)
  function center() {
    const P = ctx.player?.P;
    if (P) return { x: P.x, z: P.z, yaw: P.yaw };
    const t = ctx.controls.target;
    return { x: t.x - ctx.stations.toWorld(0), z: t.z, yaw: 0 };
  }
  const cam = new THREE.Vector3();

  function draw() {
    const c = center();
    const sx = (x) => W / 2 + (x - c.x) * scale;
    const sz = (z) => H / 2 + (z - c.z) * scale;
    const rect = (x1, z1, x2, z2, col) => { g.fillStyle = col; g.fillRect(sx(x1), sz(z1), (x2 - x1) * scale, (z2 - z1) * scale); };
    g.clearRect(0, 0, W, H);
    rect(-200, -200, 200, L.SAND.shoreZ, '#38bdf8');                 // biển
    rect(-200, L.SAND.shoreZ, 200, L.WALK.z1, '#fde68a');             // cát
    rect(-200, L.WALK.z1, 200, L.WALK.z2, '#d6d3d1');                 // vỉa hè
    rect(-200, L.ROAD.z1, 200, L.ROAD.z2, '#475569');                 // đường
    rect(-200, L.OPP.z1, 200, L.OPP.z2, '#d6d3d1');
    rect(-200, L.OPP.z2, 200, 60, '#a8a29e');                         // dãy nhà
    g.strokeStyle = '#f8fafc'; g.setLineDash([6, 6]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, sz((L.ROAD.z1 + L.ROAD.z2) / 2)); g.lineTo(W, sz((L.ROAD.z1 + L.ROAD.z2) / 2)); g.stroke(); g.setLineDash([]);
    // cửa hàng
    const S = L.SHOP;
    rect(S.x - S.w / 2, S.z, S.x + S.w / 2, S.z + S.d, '#0284c7');
    g.fillStyle = '#fff'; g.font = 'bold 10px sans-serif'; g.textAlign = 'center';
    g.fillText('PEACE Mart', sx(S.x), sz(S.z + S.d / 2) + 3);
    // trạm
    ctx.stations.slots.forEach((s, i) => {
      const act = i === ctx.stations.active;
      rect(s.x - 0.8, -0.7, s.x + 0.8, 0.7, act ? '#16a34a' : '#166534');
      if (act) { g.strokeStyle = '#bbf7d0'; g.lineWidth = 2; g.strokeRect(sx(s.x - 0.8) - 2, sz(-0.7) - 2, 1.6 * scale + 4, 1.4 * scale + 4); }
      g.fillStyle = '#0f172a'; g.font = 'bold 10px sans-serif';
      g.fillText(String(s.info.code || s.info.id).slice(-3), sx(s.x), sz(-1.3));   // 001 / 002 / 003
    });
    // rác trên đường
    g.fillStyle = '#facc15';
    for (const it of ctx.litter?.items || []) { g.beginPath(); g.arc(sx(it.userData.sx), sz(it.userData.sz), 2.2, 0, 7); g.fill(); }
    // xe
    for (const v of ctx.traffic?.vehicles || []) {
      g.fillStyle = v.kind === 'car' ? '#e2e8f0' : '#f97316';
      g.fillRect(sx(v.x - v.half), sz(v.z - (v.kind === 'car' ? 0.85 : 0.3)), v.half * 2 * scale, (v.kind === 'car' ? 1.7 : 0.6) * scale);
    }
    // người có việc (bỏ rác / qua đường)
    g.fillStyle = '#f472b6';
    for (const a of ctx.npcs?.actors || []) { g.beginPath(); g.arc(sx(a.x), sz(a.z), 2.4, 0, 7); g.fill(); }
    // cờ đích
    if (goal) {
      g.fillStyle = '#22c55e'; g.beginPath(); g.arc(sx(goal.x), sz(goal.z), 4, 0, 7); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
    }
    // tầm nhìn camera
    cam.subVectors(ctx.controls.target, ctx.camera.position);
    const camYaw = Math.atan2(cam.x, cam.z);
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.beginPath(); g.moveTo(W / 2, H / 2);
    g.arc(W / 2, H / 2, 46, Math.PI / 2 - camYaw - 0.45, Math.PI / 2 - camYaw + 0.45); g.closePath(); g.fill();
    // nhân vật: mũi tên
    if (ctx.player) {
      g.save(); g.translate(W / 2, H / 2); g.rotate(-c.yaw + Math.PI);
      g.fillStyle = '#ffffff'; g.strokeStyle = '#16a34a'; g.lineWidth = 2;
      g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
      g.restore();
    }
    // bắc / ghi chú hướng
    g.fillStyle = 'rgba(15,23,42,.6)'; g.font = '10px sans-serif'; g.textAlign = 'left';
    g.fillText('▲ biển', 6, 14); g.fillText('▼ cửa hàng', 6, H - 6);
    info.textContent = goal ? `Đích: ${Math.round(Math.hypot(goal.x - c.x, goal.z - c.z))} m` : 'Bấm bản đồ để cắm cờ đích';
  }

  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const c = center();
    const x = c.x + ((e.clientX - r.left) * (W / r.width) - W / 2) / scale;
    const z = c.z + ((e.clientY - r.top) * (H / r.height) - H / 2) / scale;
    if (goal && Math.hypot(goal.x - x, goal.z - z) < 2) { goal = null; beacon.visible = false; return; }   // bấm lại: bỏ cờ
    goal = { x, z };
    beacon.position.set(x, 2.5, z);
    beacon.visible = true;
    beacon.updateMatrixWorld(true);
  });
  wrap.querySelector('.mm-tools').addEventListener('click', (e) => {
    const b = e.target.closest('[data-z]');
    if (b) scale = THREE.MathUtils.clamp(scale * (b.dataset.z === '1' ? 1.4 : 1 / 1.4), 1.2, 9);
  });

  let acc = 0;
  ctx.onFrame.push((dt) => {
    acc += dt;
    if (acc < 0.1) return;          // vẽ 10 lần / giây là đủ
    acc = 0;
    if (goal && ctx.player && Math.hypot(goal.x - ctx.player.P.x, goal.z - ctx.player.P.z) < 1.5) { goal = null; beacon.visible = false; }
    draw();
  });
  draw();
  return { draw };
}
