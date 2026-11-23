// 2 thùng rác mini ÂM vào 2 vách hông trạm (mặt ngoài phẳng với vỏ): bỏ rác thường (không phải chai/lon).
// Mặt ngoài chỉ lộ: miệng bỏ rác có nắp lật vào trong + mặt hộc (nhãn, đèn mức đầy, tay nắm + ổ khóa cho nhân viên).
import * as THREE from 'three';
import { D, publicX } from './dims.js';
import { M } from './materials.js';
import { box, plane, texMat } from './helpers.js';
import { publicBinTexture } from './textures.js';

export function buildPublicBins() {
  const group = new THREE.Group();
  group.name = 'publicBins';
  const P = D.PUBLIC;
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x3f4851, roughness: 0.6, metalness: 0.4 });
  const faceMat = new THREE.MeshStandardMaterial({ color: 0x5b6774, roughness: 0.35, metalness: 0.6 });
  const tex = publicBinTexture();
  const bins = {};
  for (const side of ['left', 'right']) {
    const sx = side === 'left' ? -1 : 1;
    const g = new THREE.Group();
    g.name = `publicBin_${side}`;
    g.position.set(publicX(side), P.y, P.z);
    const t = 0.006, xo = sx * (P.w / 2 + 0.004);          // xo = mặt ngoài (phẳng với vỏ trạm)
    const onFace = (m, y, z = 0, dx = 0) => { m.position.set(xo + sx * (0.0015 + dx), y, z); m.rotation.y = sx * Math.PI / 2; return m; };
    // hộp chứa nằm trong thân trạm
    g.add(box(P.w, t, P.d, innerMat, { y: t / 2 }));
    g.add(box(P.w, t, P.d, innerMat, { y: P.h - t / 2 }));
    g.add(box(t, P.h, P.d, innerMat, { x: -sx * (P.w / 2 - t / 2), y: P.h / 2 }));
    for (const sz of [-1, 1]) g.add(box(P.w, P.h, t, innerMat, { y: P.h / 2, z: sz * (P.d / 2 - t / 2) }));
    // mặt hộc (phần dưới) phẳng với vỏ
    const faceH = P.h - P.flapH;
    g.add(box(0.012, faceH, P.d, faceMat, { x: xo - sx * 0.006, y: faceH / 2 }));
    g.add(onFace(plane(P.d - 0.07, faceH * 0.62, texMat(tex, { roughness: 0.6 })), faceH * 0.47));
    // đèn mức đầy: 5 vạch
    const leds = [];
    for (let i = 0; i < 5; i++) {
      const m = new THREE.MeshStandardMaterial({ color: 0x1f2937, emissive: 0x000000, roughness: 0.4 });
      g.add(onFace(box(0.034, 0.01, 0.004, m), faceH - 0.03, -0.08 + i * 0.04));
      leds.push(m);
    }
    // tay nắm âm + ổ khóa (nhân viên rút hộc ra đổ)
    g.add(onFace(box(0.12, 0.018, 0.006, M.trim), 0.045));
    const key = new THREE.Mesh(new THREE.CircleGeometry(0.008, 20), M.steel);
    g.add(onFace(key, 0.045, 0.1, 0.001));
    // miệng bỏ rác (phần trên): khung xanh + nắp lật vào trong (bản lề mép trên)
    const my = faceH + P.flapH / 2;
    for (const [w, h, y, z] of [[P.d, 0.016, P.h - 0.008, 0], [P.d, 0.012, faceH + 0.006, 0],
      [0.016, P.flapH, my, -P.d / 2 + 0.008], [0.016, P.flapH, my, P.d / 2 - 0.008]]) {
      g.add(onFace(box(w, h, 0.01, M.green), y, z, -0.004));
    }
    const flap = new THREE.Group();
    flap.position.set(xo - sx * 0.01, P.h - 0.018, 0);
    flap.add(box(0.008, P.flapH - 0.03, P.d - 0.036, M.greenDark, { y: -(P.flapH - 0.03) / 2 }));
    flap.userData.open = -sx * 1.15;                       // góc lật vào trong
    g.add(flap);
    const mouth = new THREE.Object3D();
    mouth.position.set(xo - sx * 0.02, my, 0);
    g.add(mouth);
    // khối rác bên trong
    const fill = box(P.w - 0.02, 1, P.d - 0.02, new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.95 }), { y: 0.01 });
    fill.scale.y = 0.0001;
    g.add(fill);
    g.userData.action = 'public';
    g.userData.side = side;
    group.add(g);
    bins[side] = { group: g, flap, leds, fill, mouth, out: sx };
  }
  return { group, bins };
}

/** Lỗ khoét trên vách hông cho thùng âm (tọa độ z, y) */
export function publicHole() {
  const P = D.PUBLIC, e = 0.004;
  return { z1: P.z - P.d / 2 - e, z2: P.z + P.d / 2 + e, y1: P.y - e, y2: P.y + P.h + e };
}

const GREEN = new THREE.Color(0x22c55e), AMBER = new THREE.Color(0xf59e0b), RED = new THREE.Color(0xef4444), OFF = new THREE.Color(0);

/** Cập nhật đèn + khối rác theo tỉ lệ đầy 0..1 */
export function setPublicLevel(bin, ratio) {
  const r = Math.max(0, Math.min(1, ratio));
  const lit = Math.ceil(r * 5 - 1e-6);
  const c = r >= 0.999 ? RED : r >= 0.6 ? AMBER : GREEN;
  bin.leds.forEach((m, i) => {
    m.emissive.copy(i < lit ? c : OFF);
    m.emissiveIntensity = i < lit ? 1.6 : 0;
  });
  const h = Math.max(0.0001, r * (D.PUBLIC.h - D.PUBLIC.flapH - 0.03));
  bin.fill.scale.y = h;
  bin.fill.position.y = 0.01 + h / 2;
}
