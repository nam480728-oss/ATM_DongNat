// Bối cảnh vỉa hè / sân: nền gạch, bó vỉa, mặt đường, tường, cây xanh, đèn đường, ghế
import * as THREE from 'three';
import { asphaltTexture, pavingTexture, skyTexture, wallTexture } from './station/textures.js';

function mesh(geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

function tree(x, z, scale = 1) {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: 0x6b4f3a, roughness: 0.95 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x3f8f3a, roughness: 0.85, flatShading: true });
  const leaf2 = new THREE.MeshStandardMaterial({ color: 0x2f7a32, roughness: 0.85, flatShading: true });
  g.add(mesh(new THREE.CylinderGeometry(0.07, 0.11, 2.2, 10), bark, 0, 1.1, 0));
  const blobs = [[0, 2.6, 0, 0.9], [0.55, 2.35, 0.2, 0.6], [-0.5, 2.4, -0.15, 0.65], [0.1, 3.05, -0.2, 0.6], [-0.2, 2.3, 0.45, 0.55]];
  blobs.forEach(([bx, by, bz, r], i) => g.add(mesh(new THREE.IcosahedronGeometry(r, 1), i % 2 ? leaf2 : leaf, bx, by, bz)));
  // bồn gốc cây
  const curb = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.9 });
  g.add(mesh(new THREE.BoxGeometry(1.2, 0.12, 0.08), curb, 0, 0.06, 0.56));
  g.add(mesh(new THREE.BoxGeometry(1.2, 0.12, 0.08), curb, 0, 0.06, -0.56));
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.12, 1.2), curb, 0.56, 0.06, 0));
  g.add(mesh(new THREE.BoxGeometry(0.08, 0.12, 1.2), curb, -0.56, 0.06, 0));
  g.add(mesh(new THREE.BoxGeometry(1.04, 0.08, 1.04), new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 }), 0, 0.04, 0));
  g.position.set(x, 0, z);
  g.scale.setScalar(scale);
  return g;
}

function planter(x, z) {
  const g = new THREE.Group();
  const pot = new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.8 });
  const bush = new THREE.MeshStandardMaterial({ color: 0x4d9a45, roughness: 0.9, flatShading: true });
  g.add(mesh(new THREE.BoxGeometry(1.4, 0.45, 0.45), pot, 0, 0.225, 0));
  for (let i = 0; i < 5; i++) {
    g.add(mesh(new THREE.IcosahedronGeometry(0.22 + Math.random() * 0.06, 1), bush, -0.56 + i * 0.28, 0.55, (Math.random() - 0.5) * 0.1));
  }
  g.position.set(x, 0, z);
  return g;
}

function bench(x, z, rotY = 0) {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0xa16207, roughness: 0.7 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.5, metalness: 0.6 });
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.BoxGeometry(1.5, 0.03, 0.11), wood, 0, 0.45, -0.13 + i * 0.13));
  for (let i = 0; i < 2; i++) {
    const b = mesh(new THREE.BoxGeometry(1.5, 0.1, 0.03), wood, 0, 0.62 + i * 0.13, -0.24);
    b.rotation.x = -0.15; g.add(b);
  }
  for (const sx of [-0.65, 0.65]) {
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.45, 0.42), iron, sx, 0.225, -0.02));
    g.add(mesh(new THREE.BoxGeometry(0.05, 0.4, 0.04), iron, sx, 0.7, -0.25));
  }
  g.position.set(x, 0, z); g.rotation.y = rotY;
  return g;
}

function streetLamp(x, z) {
  const g = new THREE.Group();
  const iron = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.5, metalness: 0.7 });
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.08, 4, 12), iron, 0, 2, 0));
  const arm = mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), iron, 0, 3.95, 0.35);
  arm.rotation.x = Math.PI / 2; g.add(arm);
  g.add(mesh(new THREE.BoxGeometry(0.25, 0.08, 0.4), iron, 0, 3.92, 0.7));
  g.position.set(x, 0, z);
  return g;
}

export function buildWorld(scene) {
  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xdbeaf5, 14, 38);

  // Vỉa hè lát gạch
  const pave = pavingTexture();
  pave.repeat.set(40 / 2.4, 6.5 / 2.4); // 1 ô texture = 2,4 m (gạch 60 × 30 cm)
  const paving = new THREE.MeshStandardMaterial({ map: pave, roughness: 0.92 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 6.5), paving);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, 0, 0.45);
  ground.receiveShadow = true;
  scene.add(ground);

  // Bó vỉa + lòng đường
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xb8b4ac, roughness: 0.85 });
  scene.add(mesh(new THREE.BoxGeometry(40, 0.15, 0.25), curbMat, 0, -0.075 + 0.0, 3.82));
  const road = new THREE.Mesh(new THREE.PlaneGeometry(40, 9), new THREE.MeshStandardMaterial({ map: asphaltTexture(), roughness: 0.95 }));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, -0.15, 8.45);
  road.receiveShadow = true;
  scene.add(road);
  // vạch kẻ đường
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.7 });
  for (let x = -19; x < 20; x += 3) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.12), lineMat);
    l.rotation.x = -Math.PI / 2; l.position.set(x, -0.148, 8.4);
    scene.add(l);
  }

  // Tường phía sau
  const wall = new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 });
  scene.add(mesh(new THREE.BoxGeometry(40, 3.2, 0.3), wall, 0, 1.6, -2.95));
  const capMat = new THREE.MeshStandardMaterial({ color: 0x9a8f7c, roughness: 0.8 });
  scene.add(mesh(new THREE.BoxGeometry(40, 0.12, 0.4), capMat, 0, 3.26, -2.95));

  scene.add(tree(-2.6, 2.6), tree(3.0, 2.6, 0.95), tree(-9, 2.6, 1.1), tree(9.5, 2.6));
  scene.add(planter(-2.2, -2.45), planter(2.4, -2.45));
  scene.add(bench(-4.6, -1.9));
  scene.add(streetLamp(6.2, 3.4));
}

export function buildLights(scene, renderer) {
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x8a7d6a, 0.55));

  const sun = new THREE.DirectionalLight(0xfff3df, 2.4);
  sun.position.set(-4, 7, 5);
  sun.target.position.set(0, 0.8, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const s = sun.shadow.camera;
  s.left = -4; s.right = 4; s.top = 4; s.bottom = -3; s.near = 1; s.far = 20;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);
  return { sun };
}
