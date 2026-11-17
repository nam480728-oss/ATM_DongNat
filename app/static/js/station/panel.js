// Bảng thao tác góc trên phải: màn hình cảm ứng (nghiêng 10°) + nút TÍNH TIỀN
import * as THREE from 'three';
import { D } from './dims.js';
import { M, emissive, COLORS } from './materials.js';
import { box, cyl, plane, rbox, texMat } from './helpers.js';
import { labelTexture, screenPlaceholderTexture } from './textures.js';

export const SCREEN_SIZE = { w: 0.222, h: 0.139 }; // màn 10.1" 16:10

export function buildPanel() {
  const S = D.SCREEN;
  // Đế bảng thao tác (tấm nền tối bao cả màn hình và nút)
  const plate = rbox(0.34, 0.40, 0.012, 0.012, M.trim, { x: S.x, y: (S.y + D.PAY.y) / 2 - 0.01, z: D.FRONT + 0.006 });

  // Màn hình
  const mount = new THREE.Group();
  mount.name = 'screenMount';
  mount.position.set(S.x, S.y, D.FRONT + 0.012);
  mount.rotation.x = THREE.MathUtils.degToRad(-S.tilt);
  const housing = rbox(S.w, S.h, 0.04, 0.012, M.rubber, { z: 0.02 });
  mount.add(housing);
  const screen = plane(SCREEN_SIZE.w, SCREEN_SIZE.h,
    texMat(screenPlaceholderTexture(), { emissive: 0.9, roughness: 0.2 }), { z: 0.0405 });
  screen.name = 'screenSurface';
  mount.add(screen);
  // Camera nhỏ phía trên màn hình (chi tiết thật)
  const cam = new THREE.Mesh(new THREE.CircleGeometry(0.004, 16), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.1 }));
  cam.position.set(0, S.h / 2 - 0.012, 0.0406);
  mount.add(cam);

  // Nút TÍNH TIỀN
  const P = D.PAY;
  const pay = new THREE.Group();
  pay.name = 'payButton';
  pay.position.set(P.x, P.y, D.FRONT + 0.012);
  const bezel = cyl(P.r + 0.016, P.r + 0.018, 0.014, M.steel, { z: 0.007, seg: 48 });
  bezel.rotation.x = Math.PI / 2;
  pay.add(bezel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(P.r + 0.006, 0.0035, 12, 64), emissive(COLORS.greenLight, 0.2));
  ring.name = 'payRing';
  ring.position.z = 0.0145;
  pay.add(ring);
  const cap = new THREE.Group();
  cap.name = 'payCap';
  const capBody = cyl(P.r, P.r, 0.016, new THREE.MeshPhysicalMaterial({
    color: COLORS.green, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1,
  }), { z: 0.016, seg: 48 });
  capBody.rotation.x = Math.PI / 2;
  cap.add(capBody);
  const capTop = plane(P.r * 1.5, P.r * 0.55,
    texMat(labelTexture('TÍNH TIỀN', { bg: '#16a34a', size: 120, weight: 800, w: 768, h: 256 })), { z: 0.0242 });
  capTop.material.transparent = false;
  cap.add(capTop);
  pay.add(cap);

  const payLabel = plane(0.15, 0.022, texMat(labelTexture('ĐÓNG CỬA RỒI BẤM', { bg: '#1f2933', size: 76, w: 1024, h: 150 })),
    { x: P.x, y: P.y - 0.078, z: D.FRONT + 0.0125 });

  return { plate, mount, screen, pay, cap, ring, payLabel };
}
