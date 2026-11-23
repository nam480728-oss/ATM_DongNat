// Màn hình cảm ứng (nghiêng 10°) bên phải cửa khoang nạp. Không còn nút TÍNH TIỀN: đóng cửa là máy tự quét.
import * as THREE from 'three';
import { D } from './dims.js';
import { M } from './materials.js';
import { plane, rbox, texMat } from './helpers.js';
import { labelTexture, screenPlaceholderTexture } from './textures.js';

export const SCREEN_SIZE = { w: 0.222, h: 0.139 }; // màn 10.1" 16:10

export function buildPanel() {
  const S = D.SCREEN;
  // Đế bảng thao tác
  const plate = new THREE.Group();
  plate.add(rbox(0.34, 0.30, 0.012, 0.012, M.trim, { x: S.x, y: S.y - 0.03, z: D.FRONT + 0.006 }));
  plate.add(plane(0.26, 0.032, texMat(labelTexture('MÀN HÌNH CẢM ỨNG', { bg: '#1f2933', size: 76, w: 1024, h: 130 })),
    { x: S.x, y: S.y - 0.145, z: D.FRONT + 0.0125 }));

  const mount = new THREE.Group();
  mount.name = 'screenMount';
  mount.position.set(S.x, S.y, D.FRONT + 0.012);
  mount.rotation.x = THREE.MathUtils.degToRad(-S.tilt);
  mount.add(rbox(S.w, S.h, 0.04, 0.012, M.rubber, { z: 0.02 }));
  const screen = plane(SCREEN_SIZE.w, SCREEN_SIZE.h,
    texMat(screenPlaceholderTexture(), { emissive: 0.9, roughness: 0.2 }), { z: 0.0405 });
  screen.name = 'screenSurface';
  mount.add(screen);
  const cam = new THREE.Mesh(new THREE.CircleGeometry(0.004, 16), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.1 }));
  cam.position.set(0, S.h / 2 - 0.012, 0.0406);
  mount.add(cam);
  return { plate, mount, screen };
}
