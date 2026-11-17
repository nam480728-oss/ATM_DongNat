// Zoom mượt bằng con lăn / touchpad: zoom về đúng điểm dưới con trỏ, có quán tính.
// Thay cho zoom mặc định của OrbitControls (nhảy từng nấc, luôn zoom về tâm).
import * as THREE from 'three';

export function setupSmoothZoom(ctx, { min = 0.12, max = 9, speed = 0.0016, smooth = 11 } = {}) {
  const { camera, controls, renderer, scene } = ctx;
  const dom = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const anchor = new THREE.Vector3();
  let pending = 0; // log(tỉ lệ khoảng cách) còn lại phải áp dụng

  // Điểm neo: bề mặt dưới con trỏ (nếu có), không thì điểm trên tia cách camera bằng khoảng tới target
  function pickAnchor(e) {
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(scene.children, true);
    const hit = hits.find((h) => h.object.visible && h.object.isMesh && !h.object.userData.noZoomPick
      && (h.object.material.opacity ?? 1) > 0.3);
    const dist = camera.position.distanceTo(controls.target);
    if (hit && hit.distance < 30) anchor.copy(hit.point);
    else anchor.copy(ray.ray.origin).addScaledVector(ray.ray.direction, dist);
  }

  // Bắt sự kiện ở pha capture để OrbitControls không nhận wheel (vẫn giữ pinch-zoom trên cảm ứng)
  dom.parentElement.addEventListener('wheel', (e) => {
    if (e.target !== dom) return;
    e.preventDefault();
    e.stopPropagation();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 32;        // theo dòng
    else if (e.deltaMode === 2) dy *= 600;  // theo trang
    dy = THREE.MathUtils.clamp(dy, -240, 240);
    pickAnchor(e);
    pending += dy * speed * (e.ctrlKey ? 2.5 : 1); // ctrl = pinch trên touchpad
    pending = THREE.MathUtils.clamp(pending, -2.5, 2.5);
    window.gsap.killTweensOf(camera.position);
    window.gsap.killTweensOf(controls.target);
  }, { capture: true, passive: false });

  const off = new THREE.Vector3();
  ctx.onFrame.push((dt) => {
    if (Math.abs(pending) < 1e-4) { pending = 0; return; }
    const step = pending * (1 - Math.exp(-smooth * dt));
    pending -= step;
    let s = Math.exp(step);
    // giới hạn khoảng cách camera -> target
    const d = camera.position.distanceTo(controls.target);
    const nd = THREE.MathUtils.clamp(d * s, min, max);
    if (Math.abs(nd - d) < 1e-6) { pending = 0; return; }
    s = nd / d;
    // phép vị tự quanh điểm neo: điểm dưới con trỏ đứng yên trên màn hình
    off.copy(camera.position).sub(anchor).multiplyScalar(s);
    camera.position.copy(anchor).add(off);
    off.copy(controls.target).sub(anchor).multiplyScalar(s);
    controls.target.copy(anchor).add(off);
    if (camera.position.y < 0.08) camera.position.y = 0.08;
    controls.update();
  });

  return { stop() { pending = 0; } };
}
