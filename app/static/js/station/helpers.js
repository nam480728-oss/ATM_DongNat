import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function box(w, h, d, mat, { x = 0, y = 0, z = 0, name } = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}

export function rbox(w, h, d, r, mat, { x = 0, y = 0, z = 0, seg = 3, name } = {}) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, seg, r), mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}

export function plane(w, h, mat, { x = 0, y = 0, z = 0, name } = {}) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}

export function cyl(rTop, rBottom, h, mat, { x = 0, y = 0, z = 0, seg = 32, name } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, seg), mat);
  m.position.set(x, y, z);
  if (name) m.name = name;
  return m;
}

export function texMat(texture, { emissive = 0, roughness = 0.5, transparent = false } = {}) {
  const m = new THREE.MeshStandardMaterial({ map: texture, roughness, transparent });
  if (emissive) {
    m.emissive = new THREE.Color(0xffffff);
    m.emissiveMap = texture;
    m.emissiveIntensity = emissive;
  }
  return m;
}

/** Hộp hở 1 mặt (mặt +Z hở) – dùng làm lòng hốc / thân ngăn kéo. */
export function openBox(w, h, d, t, mat, { openTop = false } = {}) {
  const g = new THREE.Group();
  g.add(box(w, t, d, mat, { y: t / 2, z: -d / 2 }));                       // đáy
  if (!openTop) g.add(box(w, t, d, mat, { y: h - t / 2, z: -d / 2 }));     // nóc
  g.add(box(t, h, d, mat, { x: -w / 2 + t / 2, y: h / 2, z: -d / 2 }));    // trái
  g.add(box(t, h, d, mat, { x: w / 2 - t / 2, y: h / 2, z: -d / 2 }));     // phải
  g.add(box(w, h, t, mat, { y: h / 2, z: -d + t / 2 }));                   // hậu
  return g;
}

export function enableShadows(obj) {
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
}
