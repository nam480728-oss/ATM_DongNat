// Cơ cấu bên trong trạm:
//   khay ngăn kéo (người dùng rút ra bỏ rác; rung; camera khay nhìn xuống: quét tính tiền + vẽ khung cho tay gắp)
//   -> giàn XY + tay gắp 2 ngón lùa vật qua mép trái -> phễu hình nón (cánh loe rộng được)
//   -> băng chuyền (camera băng chuyền, thanh gạt chai trước, thanh gạt lon sau) -> xe thùng chứa.
// Mesh hộp gắn userData.phys = 'fixed' | 'kin' -> physics.js tự tạo khối va chạm (kin = bám theo mesh khi chuyển động).
import * as THREE from 'three';
import { D } from './dims.js';
import { M, emissive } from './materials.js';
import { box, cyl, plane, rbox, texMat } from './helpers.js';
import { labelTexture } from './textures.js';

export const SCAN_LAYER = 1;
const TR = D.TRAY, F = D.FUNNEL, B = D.BELT, BN = D.BINS, G = D.GANTRY;
export const TRAY_CZ = (TR.z1 + TR.z2) / 2;

// Camera: vị trí, điểm nhìn, hướng "lên" của ảnh, góc nhìn dọc, độ phân giải
// (camera khay: mép trái ảnh = phía phễu -> app/config.py FUNNEL_IMG = (0, 0.5))
export const CAMS = {
  tray: { pos: [TR.x, D.CAM_Y, TRAY_CZ], target: [TR.x, TR.y, TRAY_CZ], up: [0, 0, -1], fov: 46, w: 1280, h: 960 },
  belt: { pos: [B.camX, B.y + 0.27, B.z], target: [B.camX, B.y, B.z], up: [0, 0, -1], fov: 60, w: 640, h: 480 },
};

const phys = (m, kind = 'fixed') => { m.userData.phys = kind; return m; };
/** Khối va chạm dày, không hiển thị (mặt khay / mặt băng mỏng -> vật rơi mạnh không lọt qua) */
const solid = (w, h, d, pos, kind = 'fixed') => { const m = phys(box(w, h, d, M.trim, pos), kind); m.visible = false; m.castShadow = false; return m; };
const lensMat = new THREE.MeshStandardMaterial({ color: 0x0b1220, roughness: 0.05, metalness: 0.8 });

/** Thân camera công nghiệp + đèn LED vòng + đèn chiếu sáng lúc chụp */
function cameraRig(name, cfg) {
  const cam = new THREE.Group();
  cam.name = name;
  cam.position.set(...cfg.pos);
  cam.add(box(0.07, 0.045, 0.05, M.rubber));
  const lens = cyl(0.014, 0.016, 0.02, lensMat, { z: 0.032 });
  lens.rotation.x = Math.PI / 2;
  cam.add(lens);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.005, 10, 40), emissive(0xffffff, 0));
  ring.position.z = 0.03;
  cam.add(ring);
  const rec = new THREE.Mesh(new THREE.SphereGeometry(0.0035, 10, 8), emissive(0xff2d2d, 0));
  rec.position.set(0.026, 0.016, 0.026);
  cam.add(rec);
  cam.up.set(...cfg.up);
  cam.lookAt(...cfg.target);
  const light = new THREE.SpotLight(0xffffff, 0, 2.2, THREE.MathUtils.degToRad(62), 0.5, 1.2);
  const dir = new THREE.Vector3(...cfg.target).sub(new THREE.Vector3(...cfg.pos)).normalize();
  light.position.set(...cfg.pos).addScaledVector(dir, 0.04);
  light.target.position.set(...cfg.target);
  return { cam, ring, rec, light };
}

function beltTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1c1f22'; g.fillRect(0, 0, 512, 128);
  for (let i = 0; i < 1600; i++) {
    const v = 30 + Math.random() * 25;
    g.fillStyle = `rgba(${v},${v},${v + 3},0.7)`;
    g.fillRect(Math.random() * 512, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = 'rgba(120,130,140,0.35)'; g.lineWidth = 6;
  for (let x = 0; x < 512; x += 64) { g.beginPath(); g.moveTo(x, 10); g.lineTo(x + 26, 64); g.lineTo(x, 118); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set((B.x2 - B.x1) / 0.5, 1);
  return t;
}

export function buildInterior() {
  const g = new THREE.Group();
  g.name = 'interior';
  const rigs = {};
  const add = (...o) => { g.add(...o); return o[0]; };

  // ================================================================ KHAY NGĂN KÉO (rút ra / rung / phân loại)
  const drawer = new THREE.Group();          // trượt theo Z khi rút ra
  drawer.name = 'trayDrawer';
  drawer.position.set(TR.x, TR.y, 0);
  drawer.userData.closedZ = 0;
  const tray = new THREE.Group();            // rung
  tray.name = 'tray';
  drawer.add(tray);
  const deckMat = new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.8, metalness: 0.15 });
  const dz = TR.z2 - TR.z1, cz = TRAY_CZ, hw = TR.w / 2;
  tray.add(box(TR.w, 0.016, dz, deckMat, { y: -0.008, z: cz }));
  tray.add(solid(TR.w, 0.1, dz, { y: -0.05, z: cz }, 'kin'));
  for (let i = 1; i < 10; i++) tray.add(box(TR.w - 0.03, 0.002, 0.005, M.trim, { y: 0.001, z: TR.z1 + (dz / 10) * i }));
  const WH = TR.wall;                                                          // vách cao tới mép trên ô cửa
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x9aa5b1, roughness: 0.35, metalness: 0.75 });
  tray.add(phys(box(0.012, WH, dz, wallMat, { x: hw - 0.006, y: WH / 2, z: cz }), 'kin'));                     // vách phải
  tray.add(phys(box(TR.w, WH, 0.012, wallMat, { y: WH / 2, z: TR.z1 + 0.006 }), 'kin'));                     // vách sau (rút ra = bịt ô cửa)
  // vách trái = cửa lật, bản lề ở mép mặt khay: đóng = đứng thẳng; mở = lật xuống 180° áp sát ngoài miệng phễu
  const gate = new THREE.Group();
  gate.name = 'trayGate';
  gate.position.set(-hw, 0, 0);
  gate.add(phys(box(0.012, WH, dz, wallMat, { x: 0.006, y: WH / 2, z: cz }), 'kin'));
  const hingeBar = cyl(0.007, 0.007, dz, M.steel, { y: 0.002, z: cz });
  hingeBar.rotation.x = Math.PI / 2;
  gate.add(hingeBar);
  tray.add(gate);
  // đáy hộp dưới mặt khay (kín từ dưới lên tới mép dưới ô cửa)
  const under = D.DOOR.y1 - TR.y + 0.004;
  tray.add(box(TR.w, 0.01, dz, M.trim, { y: under, z: cz }));
  tray.add(box(0.01, -under, dz, M.trim, { x: hw - 0.005, y: under / 2, z: cz }));
  tray.add(box(TR.w, -under, 0.01, M.trim, { y: under / 2, z: TR.z1 + 0.005 }));
  // mặt trước ngăn kéo cao kín cả ô cửa + tay cầm + nhãn
  const front = new THREE.Group();
  front.name = 'drawerFront';
  const fh = WH - under;
  front.add(phys(box(TR.w + 0.012, fh, 0.016, M.green, { y: under + fh / 2, z: TR.z2 - 0.008 }), 'kin'));
  const handle = cyl(0.008, 0.008, 0.24, M.steel, { y: WH - 0.06, z: TR.z2 + 0.03 });
  handle.rotation.z = Math.PI / 2;
  front.add(handle);
  for (const x of [-0.11, 0.11]) {
    const st = cyl(0.005, 0.005, 0.03, M.steel, { x, y: WH - 0.06, z: TR.z2 + 0.015 });
    st.rotation.x = Math.PI / 2;
    front.add(st);
  }
  front.add(plane(0.3, 0.044, texMat(labelTexture('KHAY BỎ RÁC', { bg: '#166534', size: 90 })), { y: WH / 2 - 0.02, z: TR.z2 + 0.0005 }));
  tray.add(front);
  const motor = cyl(0.035, 0.035, 0.1, M.trim, { y: -0.05, z: cz });
  motor.rotation.z = Math.PI / 2;
  tray.add(motor);
  g.add(drawer);
  // ray trượt 2 bên (cố định)
  for (const sx of [-1, 1]) add(box(0.008, 0.03, dz + 0.04, M.steel, { x: sx * (hw + 0.006), y: TR.y - 0.06, z: cz }));
  const trayInner = { x1: -hw + 0.02, x2: hw - 0.02, z1: TR.z1 + 0.02, z2: TR.z2 - 0.03 };   // tọa độ của drawer (x) và trạm (z, khi khay đóng)

  rigs.tray = cameraRig('trayCamera', CAMS.tray);
  add(rigs.tray.cam, rigs.tray.light, rigs.tray.light.target);
  add(box(0.02, 0.02, cz + D.FRONT * 0.6, M.steel, { x: TR.x, y: D.CAM_Y + 0.03, z: cz / 2 - D.FRONT * 0.3 }));
  // Vách lót buồng quét (chỉ camera thấy – layer 1): nền ảnh luôn tối đều như máy thật
  const linerMat = new THREE.MeshStandardMaterial({ color: 0x1c2024, roughness: 0.95, side: THREE.BackSide });
  const liner = new THREE.Mesh(new THREE.BoxGeometry(TR.w + 0.2, D.CAM_Y - TR.y + 0.3, dz + 0.12), linerMat);
  liner.position.set(TR.x, (D.CAM_Y + TR.y) / 2, cz);
  liner.layers.set(SCAN_LAYER);
  liner.name = 'scanLiner';
  add(liner);

  // ================================================================ PHỄU HÌNH NÓN (cánh loe rộng được)
  const funnel = new THREE.Group();
  funnel.name = 'funnel';
  const funnelMat = new THREE.MeshStandardMaterial({ color: 0xb4c0ca, roughness: 0.28, metalness: 0.9, side: THREE.DoubleSide });
  // Hộp nối khay -> phễu: tấm phẳng khoét lỗ tròn đúng miệng phễu + vách nghiêng cao tới mép vách khay.
  // Mép phải hộp trùng mép trái khay (cửa lật), nên vật lùa qua chỉ có đường rơi vào phễu.
  {
    const top = TR.y + TR.wall, xL = F.x - F.rMouth - 0.012, xR = TR.x - TR.w / 2 - 0.014;   // khe 1,4 cm cho cửa lật thõng xuống
    const shape = new THREE.Shape();
    shape.moveTo(xL, TR.z1); shape.lineTo(xR, TR.z1); shape.lineTo(xR, TR.z2); shape.lineTo(xL, TR.z2); shape.lineTo(xL, TR.z1);
    const hole = new THREE.Path();
    hole.absarc(F.x, F.z, F.rMouth, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const plate = new THREE.Mesh(new THREE.ShapeGeometry(shape, 48), funnelMat);
    plate.rotation.x = Math.PI / 2;               // (x, y) của shape -> (x, z) của trạm
    plate.position.y = F.mouth;
    funnel.add(plate);
    const lip = new THREE.Mesh(new THREE.TorusGeometry(F.rMouth, 0.004, 8, 64), M.steel);
    lip.rotation.x = Math.PI / 2;
    lip.position.set(F.x, F.mouth, F.z);
    funnel.add(lip);
    // 4 góc vuông quanh lỗ tròn: khối va chạm ẩn xoay 45° tiếp tuyến miệng phễu (vật không kẹt ở góc)
    for (const [ax, az] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const ang = Math.atan2(az, ax), rc = F.rMouth + 0.03;      // nhỏ, không nhô ra ngoài vách nghiêng (không thành "kệ")
      const c = solid(0.08, 0.012, 0.06, { x: F.x + Math.cos(ang) * rc, y: F.mouth - 0.006, z: F.z + Math.sin(ang) * rc });
      c.rotation.y = -ang + Math.PI / 2;
      funnel.add(c);
    }
    // vách nghiêng sau / trước (từ mép vách khay chụm xuống mép miệng phễu) + vách trái đứng
    const sh = top - F.mouth;
    for (const [zTop, zBot] of [[TR.z1 + 0.006, F.z - F.rMouth], [TR.z2 - 0.006, F.z + F.rMouth]]) {
      const len = Math.hypot(sh, zTop - zBot);
      const w = phys(box(xR - xL, len, 0.008, funnelMat, { x: (xL + xR) / 2, y: (top + F.mouth) / 2, z: (zTop + zBot) / 2 }));
      w.rotation.x = Math.atan2(zTop - zBot, sh);
      w.userData.friction = 0.04;
      funnel.add(w);
    }
    funnel.add(phys(box(0.008, sh, TR.z2 - TR.z1, funnelMat, { x: xL - 0.004, y: (top + F.mouth) / 2, z: TRAY_CZ })));
    funnel.add(box(xR - xL + 0.02, 0.012, 0.012, M.steel, { x: (xL + xR) / 2, y: top, z: TR.z1 + 0.006 }));
    funnel.add(box(xR - xL + 0.02, 0.012, 0.012, M.steel, { x: (xL + xR) / 2, y: top, z: TR.z2 - 0.006 }));
  }
  const PL = Math.hypot(F.rMouth - F.rNeck, F.mouth - F.neck);    // chiều dài cánh
  const NP = 16, wTop = (2 * Math.PI * F.rMouth) / NP * 1.18;
  const petals = [];
  for (let i = 0; i < NP; i++) {
    const phi = (i / NP) * Math.PI * 2;
    const hinge = new THREE.Group();
    const r = F.rMouth - (i % 2) * 0.003;                       // so le để các cánh chồng mép không nhấp nháy
    hinge.position.set(F.x + r * Math.cos(phi), F.mouth, F.z + r * Math.sin(phi));
    hinge.rotation.y = -phi;
    const petal = new THREE.Group();
    const pm = phys(box(0.004, PL, wTop, funnelMat, { y: -PL / 2 }), 'kin');
    pm.userData.friction = 0.04;                                  // inox bóng: vật trượt xuống dễ
    petal.add(pm);
    hinge.add(petal);
    funnel.add(hinge);
    petals.push(petal);
  }
  // giá đỡ + 2 xy-lanh nhỏ kéo các cánh loe ra + motor rung
  funnel.add(box(0.02, 0.02, 0.2, M.steel, { x: F.x - F.rMouth - 0.03, y: F.mouth - 0.02, z: F.z }));
  funnel.add(box(D.W / 2 + F.x - F.rMouth - 0.07, 0.02, 0.02, M.steel, { x: (F.x - F.rMouth - 0.04 - D.W / 2 + 0.05) / 2, y: F.mouth - 0.02, z: F.z }));
  const vib = cyl(0.025, 0.025, 0.05, M.trim, { x: F.x - F.rMouth - 0.05, y: F.mouth - 0.06, z: F.z });
  vib.rotation.z = Math.PI / 2;
  funnel.add(vib);
  for (const sz of [-1, 1]) {
    const c = cyl(0.008, 0.008, 0.12, M.trim, { x: F.x, y: F.mouth - 0.12, z: F.z + sz * (F.rMouth + 0.03) });
    c.rotation.x = sz * 0.35;
    funnel.add(c);
  }
  // Dưới cổ phễu: ống mica ngắn (vật rơi không nảy ra ngoài) + MÁNG TRƯỢT nghiêng về phía +X:
  // chai rơi đứng chạm máng sẽ đổ xuôi theo chiều băng -> nằm dọc băng (không kẹt chéo giữa 2 vách).
  const acrylic = new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.16,
    depthWrite: false, side: THREE.DoubleSide });
  const SL = { xa: F.x - 0.17, ya: 0.605, xb: -0.42, yb: 0.56 };   // chỗ vật rơi thấp hơn cổ phễu > chai dài nhất (31 cm)
  const tubeY1 = SL.ya + 0.02, tubeH = F.neck - tubeY1, tubeY = tubeY1 + tubeH / 2, dw = 0.27;
  for (const sz of [-1, 1]) funnel.add(phys(box(dw, tubeH, 0.006, acrylic, { x: F.x, y: tubeY, z: B.z + sz * (B.w / 2 - 0.004) })));
  funnel.add(phys(box(0.006, tubeH, B.w, acrylic, { x: F.x - dw / 2, y: tubeY, z: B.z })));
  for (const sz of [-1, 1]) for (const sx of [-1, 1]) funnel.add(box(0.012, tubeH, 0.012, M.steel, { x: F.x + sx * dw / 2, y: tubeY, z: B.z + sz * (B.w / 2 - 0.004) }));
  {
    const len = Math.hypot(SL.xb - SL.xa, SL.yb - SL.ya), ang = Math.atan2(SL.yb - SL.ya, SL.xb - SL.xa);
    const mx = (SL.xa + SL.xb) / 2, my = (SL.ya + SL.yb) / 2;
    const slide = phys(box(len, 0.008, B.w - 0.01, M.steel, { x: mx, y: my, z: B.z }));
    slide.rotation.z = ang;
    slide.userData.friction = 0.05;
    slide.name = 'dropSlide';
    funnel.add(slide);
    for (const sz of [-1, 1]) {
      const w = phys(box(len, 0.1, 0.006, acrylic, { x: mx, y: my + 0.05, z: B.z + sz * (B.w / 2 - 0.004) }));
      w.rotation.z = ang;
      funnel.add(w);
    }
    for (const x of [SL.xa + 0.03, SL.xb - 0.03]) {            // chân đỡ máng
      const y = SL.ya + (x - SL.xa) / (SL.xb - SL.xa) * (SL.yb - SL.ya);
      funnel.add(box(0.012, y - B.y - 0.01, 0.012, M.steel, { x, y: (y + B.y + 0.01) / 2, z: B.z + B.w / 2 + 0.01 }));
    }
  }
  g.add(funnel);
  const funnelState = { r: F.rNeck, petals };
  function setFunnel(rBottom) {
    const a = Math.asin(THREE.MathUtils.clamp((F.rMouth - rBottom) / PL, 0, 0.99));
    petals.forEach((p) => { p.rotation.z = -a; });
    funnelState.r = rBottom;
  }
  setFunnel(F.rNeck);

  // ================================================================ GIÀN XY + TAY GẮP 2 NGÓN
  const railZ = [TR.z1 - 0.03, D.FRONT - D.T - 0.025];
  for (const z of railZ) add(box(1.22, 0.03, 0.03, M.steel, { x: 0.15, y: G.y, z }));
  for (const z of railZ) for (const x of [-0.45, 0.75]) add(box(0.03, D.TOP - 0.03 - G.y, 0.03, M.trim, { x, y: (D.TOP - 0.03 + G.y) / 2, z }));
  const bridge = new THREE.Group();
  bridge.name = 'gantryBridge';
  bridge.position.set(G.park, G.y, 0);
  bridge.add(box(0.05, 0.035, railZ[1] - railZ[0] + 0.06, new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.4, metalness: 0.4 }),
    { y: 0.03, z: (railZ[0] + railZ[1]) / 2 }));
  const head = new THREE.Group();
  head.name = 'gantryHead';
  head.position.z = TRAY_CZ;
  head.add(box(0.08, 0.06, 0.07, M.trim));
  head.add(cyl(0.022, 0.022, 0.12, M.steel, { y: -0.08 }));          // xy-lanh ngoài (cố định)
  bridge.add(head);
  const hub = new THREE.Group();
  hub.name = 'gripperHub';
  head.add(hub);
  const rod = cyl(0.012, 0.012, 1, M.steel);
  head.add(rod);
  hub.add(cyl(0.03, 0.03, 0.03, M.trim, { y: 0.095 }));
  const fingerMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.45, metalness: 0.2 });
  const fingers = [-1, 1].map((sz) => {
    const f = new THREE.Group();
    f.add(box(0.17, 0.08, 0.012, fingerMat, { y: 0.04 }));
    f.add(box(0.03, 0.03, 0.03, M.trim, { y: 0.095 }));
    hub.add(f);
    return { g: f, sz };
  });
  const bars = [-1, 1].map((sx) => { const b = box(0.02, 0.012, 1, M.trim, { x: sx * 0.07, y: 0.105 }); hub.add(b); return b; });
  g.add(bridge);
  const grip = {
    bridge, head, hub,
    /** đáy ngón tay ở độ cao y (tọa độ trạm) */
    setBottom(y) {
      const local = y - G.y;
      hub.position.y = local;
      const top = -0.14, len = Math.max(0.01, top - local - 0.11);
      rod.scale.y = len;
      rod.position.y = top - len / 2;
      grip.bottom = y;
    },
    /** khoảng cách 2 ngón (m) */
    setSpread(s) {
      fingers.forEach(({ g: f, sz }) => { f.position.z = sz * s / 2; });
      bars.forEach((b) => { b.scale.z = s; });
      grip.spread = s;
    },
  };
  grip.setBottom(G.y - 0.22);
  grip.setSpread(0.16);

  // ================================================================ BĂNG CHUYỀN
  const tex = beltTexture();
  const beltLen = B.x2 - B.x1;
  const beltMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
  const surface = add(box(beltLen, 0.02, B.w, [M.trim, M.trim, beltMat, M.trim, M.trim, M.trim],
    { x: (B.x1 + B.x2) / 2, y: B.y - 0.01, z: B.z }));
  add(solid(beltLen, 0.1, B.w + 0.02, { x: (B.x1 + B.x2) / 2, y: B.y - 0.05, z: B.z }));
  surface.name = 'beltSurface';
  const guardMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.3, metalness: 0.7 });
  const guard = (x1, x2, sz) => add(phys(box(x2 - x1, 0.08, 0.01, guardMat, { x: (x1 + x2) / 2, y: B.y + 0.04, z: B.z + sz * (B.w / 2 + 0.005) })));
  // thành chắn: phía thanh gạt (+Z) chừa khe ở chỗ thanh gạt; phía thùng (-Z) chỉ có ở đoạn trước thùng
  // (miệng 3 thùng nằm sát mép băng, bằng mặt băng -> vật bị gạt rơi thẳng vào thùng)
  const P = B.pushers, gap = 0.08;
  for (const [a, b] of [[B.x1, P.bottle - gap], [P.bottle + gap, P.can - gap], [P.can + gap, B.x2]]) guard(a, b, 1);
  guard(B.x1, BN.bottle[0] - 0.005, -1);
  add(phys(box(0.01, 0.06, B.w, guardMat, { x: B.x1 - 0.005, y: B.y + 0.03, z: B.z })));      // chắn đầu băng
  add(phys(box(0.01, 0.08, B.w, guardMat, { x: B.x2 + 0.005, y: B.y + 0.04, z: B.z })));      // chắn cuối băng
  // tấm gạt chéo cuối băng: vật không bị gạt (loại 'khác') trượt theo tấm vào thùng 'khác' (physics.js: vùng lái vật)
  {
    const xa = B.endX - 0.12, xb = B.x2 - 0.01, za = B.z + B.w / 2, zb = B.z - B.w / 2 + 0.03;
    const len = Math.hypot(xb - xa, za - zb);
    const d = add(box(len, 0.08, 0.01, guardMat, { x: (xa + xb) / 2, y: B.y + 0.045, z: (za + zb) / 2 }));
    d.rotation.y = Math.atan2(za - zb, xb - xa);
    d.name = 'beltDiverter';
  }
  const rollers = [B.x1, B.x2].map((x) => {
    const r = cyl(0.022, 0.022, B.w + 0.01, M.steel, { x, y: B.y - 0.022, z: B.z, seg: 20 });
    r.rotation.x = Math.PI / 2;
    return add(r);
  });
  for (const [x, sides] of [[B.x1 + 0.06, [-1, 1]], [-0.25, [-1, 1]], [0.44, [1]], [B.x2 - 0.04, [1]]]) for (const sz of sides) {
    add(box(0.025, B.y - 0.04 - D.PLINTH, 0.025, M.trim, { x, y: (B.y - 0.04 + D.PLINTH) / 2, z: B.z + sz * (B.w / 2 + 0.012) }));
  }
  add(box(0.1, 0.09, 0.1, M.trim, { x: B.x1 + 0.04, y: B.y - 0.1, z: B.z + B.w / 2 + 0.07 }));     // motor băng
  rigs.belt = cameraRig('beltCamera', CAMS.belt);
  add(rigs.belt.cam, rigs.belt.light, rigs.belt.light.target);
  add(box(0.02, 0.29, 0.02, M.steel, { x: B.camX, y: B.y + 0.14, z: B.z - B.w / 2 - 0.04 }));
  add(box(0.02, 0.02, B.w / 2 + 0.05, M.steel, { x: B.camX, y: B.y + 0.285, z: B.z - B.w / 4 - 0.02 }));
  add(box(0.006, 0.002, B.w, emissive(0xff3b30, 0.6), { x: B.camX, y: B.y + 0.001, z: B.z }));     // vạch vị trí camera

  // ---- Thanh gạt (xy-lanh khí nén, phía +Z, đẩy vật sang -Z rơi thẳng vào thùng sát mép băng) ----
  const pushers = {};
  for (const [kind, x, color, text] of [['bottle', P.bottle, 0x0ea5e9, 'GẠT CHAI'], ['can', P.can, 0x94a3b8, 'GẠT LON']]) {
    const base = new THREE.Group();
    base.position.set(x, B.y + 0.035, B.z + B.w / 2 + 0.015);
    const cylBody = cyl(0.022, 0.022, 0.1, M.steel, { z: 0.07 });
    cylBody.rotation.x = Math.PI / 2;
    base.add(cylBody);
    base.add(box(0.06, 0.06, 0.015, M.trim, { z: 0.115 }));
    const push = new THREE.Group();
    push.add(phys(box(0.13, 0.06, 0.014, new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.3 })), 'kin'));
    const rodP = cyl(0.008, 0.008, 1, M.steel, { z: 0.06 });
    rodP.rotation.x = Math.PI / 2;
    rodP.scale.y = 0.12;
    push.add(rodP);
    base.add(push);
    base.add(plane(0.12, 0.03, texMat(labelTexture(text, { bg: kind === 'bottle' ? '#0369a1' : '#475569', size: 90, w: 512, h: 128 }), { emissive: 0.3 }),
      { y: 0.11, z: 0.1 }));
    base.add(box(0.012, 0.09, 0.012, M.trim, { y: 0.06, z: 0.1 }));
    g.add(base);
    pushers[kind] = { base, push };
  }

  // ================================================================ XE THÙNG CHỨA (chai | lon | khác)
  const cart = new THREE.Group();
  cart.name = 'storageBin';
  const binColors = { bottle: 0x0369a1, can: 0x475569, other: 0x7c2d12 };
  const fills = {};
  const binLabel = { bottle: 'CHAI NHỰA', can: 'LON', other: 'KHÁC' };
  for (const kind of ['bottle', 'can', 'other']) {
    const [x1, x2] = BN[kind];
    const z2 = BN.z2;
    const w = x2 - x1, d = z2 - BN.z1, h = BN.y2 - BN.y1, cx = (x1 + x2) / 2, czb = (BN.z1 + z2) / 2, t = 0.01;
    const mat = new THREE.MeshStandardMaterial({ color: binColors[kind], roughness: 0.6 });
    cart.add(phys(box(w, t, d, mat, { x: cx, y: BN.y1 + t / 2, z: czb }), 'kin'));
    cart.add(phys(box(t, h, d, mat, { x: x1 + t / 2, y: BN.y1 + h / 2, z: czb }), 'kin'));
    cart.add(phys(box(t, h, d, mat, { x: x2 - t / 2, y: BN.y1 + h / 2, z: czb }), 'kin'));
    cart.add(phys(box(w, h, t, mat, { x: cx, y: BN.y1 + h / 2, z: BN.z1 + t / 2 }), 'kin'));
    cart.add(phys(box(w, h, t, mat, { x: cx, y: BN.y1 + h / 2, z: z2 - t / 2 }), 'kin'));
    const fill = rbox(w - 0.03, 1, d - 0.03, 0.01, new THREE.MeshStandardMaterial({
      color: kind === 'bottle' ? 0x9ad0ec : kind === 'can' ? 0xc0c7cf : 0x8b7d6b, roughness: 0.5, metalness: kind === 'can' ? 0.6 : 0.1,
    }), { x: cx, y: BN.y1, z: czb });
    fill.scale.y = 0.0001;
    fill.userData.base = { y1: BN.y1 + t, h: h - 0.06 };
    cart.add(fill);
    fills[kind] = fill;
    const l = plane(Math.min(0.24, w - 0.04), 0.05, texMat(labelTexture(binLabel[kind], { bg: '#ffffff', fg: '#0f172a', size: 96, w: 512, h: 110 })),
      { x: cx, y: BN.y2 - 0.08, z: BN.z1 - 0.001 });
    l.rotation.y = Math.PI;
    cart.add(l);
  }
  cart.add(box(BN.other[1] - BN.bottle[0] + 0.02, 0.02, BN.z2 - BN.z1 + 0.02, M.trim,
    { x: (BN.other[1] + BN.bottle[0]) / 2, y: BN.y1 - 0.01, z: (BN.z1 + BN.z2) / 2 }));
  // nhãn mặt trước thùng (phía băng chuyền, nhìn thấy khi cắt vách)
  for (const kind of ['bottle', 'can', 'other']) {
    const [x1, x2] = BN[kind];
    cart.add(plane(Math.min(0.22, x2 - x1 - 0.06), 0.045, texMat(labelTexture(binLabel[kind], { bg: '#ffffff', fg: '#0f172a', size: 96, w: 512, h: 110 })),
      { x: (x1 + x2) / 2, y: BN.y2 - 0.06, z: BN.z2 + 0.001 }));
  }
  for (const x of [BN.bottle[0] + 0.04, BN.other[1] - 0.04]) for (const z of [BN.z1 + 0.04, BN.z2 - 0.04]) {
    const wheel = cyl(0.025, 0.025, 0.02, M.rubber, { x, y: BN.y1 - 0.035, z, seg: 16 });
    wheel.rotation.z = Math.PI / 2;
    cart.add(wheel);
  }
  // Vách mica chắn cao hơn miệng thùng (giữa các thùng, 2 đầu, mặt sau): vật bị thanh gạt đẩy mạnh / lăn không
  // văng qua thùng bên cạnh hay rơi ra ngoài xe thùng. Đi theo xe thùng khi kéo ra.
  {
    const acr = new THREE.MeshStandardMaterial({ color: 0xdbeafe, roughness: 0.15, transparent: true, opacity: 0.22, depthWrite: false });
    const hh = 0.16, yc = BN.y2 + hh / 2, d = BN.z2 - BN.z1;
    for (const x of [BN.bottle[0], BN.bottle[1], BN.can[1], BN.other[1]]) {
      cart.add(phys(box(0.008, hh, d, acr, { x, y: yc, z: (BN.z1 + BN.z2) / 2 }), 'kin'));
    }
    cart.add(phys(box(BN.other[1] - BN.bottle[0], hh + 0.1, 0.008, acr, { x: (BN.other[1] + BN.bottle[0]) / 2, y: yc + 0.05, z: BN.z1 + 0.004 }), 'kin'));
  }
  // Tấm đỡ ẩn theo mức đầy (rác cũ đã nén): vật mới nằm lên trên lớp rác, không lọt xuống đáy
  const floors = {};
  for (const kind of ['bottle', 'can', 'other']) {
    const [x1, x2] = BN[kind];
    const f = phys(box(x2 - x1 - 0.022, 0.012, BN.z2 - BN.z1 - 0.022, M.trim, { x: (x1 + x2) / 2, y: BN.y1 + 0.016, z: (BN.z1 + BN.z2) / 2 }), 'kin');
    f.visible = false; f.castShadow = false;
    f.userData.y0 = BN.y1 + 0.016;
    cart.add(f);
    floors[kind] = f;
  }
  const pull = box(0.3, 0.03, 0.025, M.trim, { x: 0.28, y: BN.y2 - 0.16, z: BN.z1 - 0.02 });
  pull.name = 'binHandle';
  cart.add(pull);
  g.add(cart);

  // ---- Vách trước (khối va chạm ẩn, chừa ô cửa cho khay ra vào): rác không lăn ra ngoài trạm ----
  {
    const z = D.FRONT - D.T - 0.01, o = D.DOOR, hwS = D.W / 2 - 0.03;
    add(solid(hwS + o.x1, D.TOP - D.PLINTH, 0.02, { x: (-hwS + o.x1) / 2, y: (D.TOP + D.PLINTH) / 2, z }));
    add(solid(hwS - o.x2, D.TOP - D.PLINTH, 0.02, { x: (hwS + o.x2) / 2, y: (D.TOP + D.PLINTH) / 2, z }));
    add(solid(o.x2 - o.x1, o.y1 - D.PLINTH, 0.02, { y: (o.y1 + D.PLINTH) / 2, z }));
    add(solid(o.x2 - o.x1, D.TOP - o.y2, 0.02, { y: (D.TOP + o.y2) / 2, z }));
  }

  // ---- Tủ điện điều khiển (phía sau, trên cao) ----
  const cab = new THREE.Group();
  cab.add(rbox(0.5, 0.55, 0.22, 0.01, new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.5, metalness: 0.4 }), { x: 0.3, y: 1.85, z: -0.5 }));
  for (let i = 0; i < 6; i++) cab.add(box(0.3, 0.008, 0.004, M.trim, { x: 0.3, y: 1.68 + i * 0.03, z: -0.388 }));
  cab.add(box(0.04, 0.012, 0.004, emissive(0x22c55e, 1.2), { x: 0.48, y: 2.06, z: -0.388 }));
  add(cab);

  // ---- Đèn trong trạm (thấy cơ cấu khi bật cắt vách) ----
  for (const [x, y, z] of [[0.25, 2.2, 0.3], [-0.2, 1.05, 0.1], [0.3, 0.75, -0.3]]) {
    const l = new THREE.PointLight(0xfff7e6, 0.8, 2.4, 2);
    l.position.set(x, y, z);
    g.add(l);
  }

  g.traverse((o) => { if (o.isMesh && !o.material.transparent) { o.castShadow = true; o.receiveShadow = true; } });
  liner.castShadow = liner.receiveShadow = false;

  return {
    group: g, rigs,
    drawer, tray, gate, inner: trayInner,
    funnel: { group: funnel, set: setFunnel, state: funnelState },
    grip, belt: { tex, surface, rollers }, pushers, cart, fills, floors,
  };
}

/** Mức đầy từng thùng (bins = {bottle, can, other} số vật, capacity = sức chứa cả trạm) */
export function setBinLevels(fills, bins, capacity, floors) {
  const share = { bottle: 0.45, can: 0.45, other: 0.1 };
  for (const k of Object.keys(fills)) {
    const f = fills[k], b = f.userData.base;
    const ratio = Math.min(1, (bins?.[k] || 0) / Math.max(1, capacity * share[k]));
    const h = Math.max(0.0001, ratio * b.h);
    f.scale.y = h;
    f.position.y = b.y1 + h / 2;
    // tấm đỡ va chạm nằm trên mặt lớp rác nén (vật còn hiện nằm lên trên)
    if (floors?.[k]) floors[k].position.y = Math.max(floors[k].userData.y0, b.y1 + h + 0.006);
  }
}
