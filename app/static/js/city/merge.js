// Gộp mesh tĩnh theo vật liệu (giảm draw call): cả trăm mesh của 1 trạm "bản sao" / dãy nhà -> vài chục mesh.
// Bỏ qua mesh nhiều vật liệu (mảng material) và mesh trong suốt cần sắp thứ tự -> giữ nguyên, chỉ đóng băng ma trận.
import * as THREE from 'three';

function attrsOf(geo) {
  return ['position', 'normal', 'uv'].filter((k) => geo.attributes[k]);
}

/** Gộp nhiều BufferGeometry (đã áp ma trận) cùng bộ thuộc tính thành 1 geometry không chỉ số. */
export function mergeGeometries(geos) {
  const keys = attrsOf(geos[0]).filter((k) => geos.every((g) => g.attributes[k]));
  const out = new THREE.BufferGeometry();
  for (const k of keys) {
    const size = geos[0].attributes[k].itemSize;
    const total = geos.reduce((n, g) => n + g.attributes[k].count * size, 0);
    const arr = new Float32Array(total);
    let off = 0;
    for (const g of geos) { arr.set(g.attributes[k].array, off); off += g.attributes[k].array.length; }
    out.setAttribute(k, new THREE.BufferAttribute(arr, size));
  }
  out.computeBoundingSphere();
  return out;
}

/**
 * Nướng (bake) toàn bộ mesh trong `root` thành group mới gồm các mesh đã gộp theo vật liệu.
 * opts.swap(material) -> vật liệu thay thế (vd kính khúc xạ -> kính trong suốt thường cho bản sao ở xa).
 * Đèn (PointLight / SpotLight) bị bỏ: bản sao không cần chiếu sáng thật (đỡ tốn shader cho mọi vật liệu).
 */
export function bakeStatic(root, { swap = (m) => m, castShadow = true } = {}) {
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map();
  const keep = [];
  const m4 = new THREE.Matrix4();
  root.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let hidden = false;
    for (let p = o.parent; p && p !== root; p = p.parent) if (!p.visible) hidden = true;
    if (hidden) return;
    m4.multiplyMatrices(inv, o.matrixWorld);
    if (Array.isArray(o.material) || o.material.transparent || o.isInstancedMesh) {
      const c = new THREE.Mesh(o.geometry, Array.isArray(o.material) ? o.material.map(swap) : swap(o.material));
      m4.decompose(c.position, c.quaternion, c.scale);
      c.castShadow = castShadow && o.castShadow; c.receiveShadow = o.receiveShadow;
      keep.push(c);
      return;
    }
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    g.applyMatrix4(m4);
    const mat = swap(o.material);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, geos] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(geos), mat);
    mesh.castShadow = castShadow; mesh.receiveShadow = true;
    out.add(mesh);
    geos.forEach((g) => g.dispose());
  }
  keep.forEach((c) => out.add(c));
  return out;
}

/** Đóng băng ma trận cả cây (vật đứng yên): three.js bỏ qua tính lại ma trận mỗi khung hình. */
export function freeze(obj) {
  obj.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
  obj.updateMatrixWorld(true);
}
