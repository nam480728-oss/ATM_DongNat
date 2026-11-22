// Khởi tạo scene 3D: renderer, camera, điều khiển xoay/zoom, ánh sáng, bối cảnh, trạm
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildLights, buildWorld } from './world.js';
import { buildStation } from './station/body.js';
import { loadFonts } from './station/textures.js';
import { VIEWS, mountViewButtons } from './ui/viewButtons.js';
import { createBridge } from './sim/hardwareBridge.js';
import { setupMechanics } from './station/mechanics.js';
import { toast } from './ui/toast.js';
import { setupScreenEmbed } from './station/screenEmbed.js';
import { buildInterior } from './station/interior.js';
import { setupTrash } from './items/trashManager.js';
import { mountHandTray } from './ui/handTray.js';
import { mountCutawayButton, setupCutaway } from './ui/cutaway.js';
import { setupProcessView } from './sim/processView.js';
import { mountDevPanel } from './ui/devPanel.js';
import { infoTexture } from './station/textures.js';
import { setupSlot } from './items/slotFeeder.js';
import { setupLaser } from './items/laserScan.js';
import { setupRear } from './station/rearMechanics.js';
import { setupSmoothZoom } from './ui/smoothZoom.js';
import { mountConfirmDialog } from './ui/confirmDialog.js';

export const ctx = { THREE };
window.ATM = ctx; // tiện debug trên console

async function fetchState() {
  try {
    const r = await fetch('/api/state');
    return await r.json();
  } catch (_) {
    return null;
  }
}

async function init() {
  // Hoạt ảnh luôn bám thời gian thực (kể cả khi tab bị giảm FPS) vì back-end chờ cơ cấu báo xong
  window.gsap.ticker.lagSmoothing(0);
  await loadFonts();
  const state = await fetchState();
  ctx.state = state;

  const container = document.getElementById('scene');
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.82;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.03, 100);
  camera.position.set(...VIEWS.overview.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...VIEWS.overview.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.12;
  controls.maxDistance = 9;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.zoomSpeed = 0.9;      // chỉ còn dùng cho pinch trên cảm ứng (con lăn: smoothZoom)
  controls.rotateSpeed = 0.8;
  controls.addEventListener('change', () => {
    // Không cho đi xuyên xuống đất / chạy quá xa
    const t = controls.target;
    t.x = THREE.MathUtils.clamp(t.x, -3, 3);
    t.y = THREE.MathUtils.clamp(t.y, 0.1, 2.2);
    t.z = THREE.MathUtils.clamp(t.z, -1.5, 3);
    if (camera.position.y < 0.08) camera.position.y = 0.08;
  });
  controls.update();

  buildWorld(scene);
  buildLights(scene, renderer);

  const station = buildStation({ prices: state?.prices });
  scene.add(station.root);

  Object.assign(ctx, { renderer, scene, camera, controls, station, parts: station.parts });

  mountViewButtons(document.getElementById('views'), camera, controls);

  ctx.onFrame = []; // các module khác đăng ký hàm chạy mỗi frame
  const bridge = createBridge(ctx);
  ctx.bridge = bridge;
  setupMechanics(ctx, bridge);
  bridge.onMessage((m) => toast(m.text, m.level));
  setupScreenEmbed(ctx);

  // Cơ cấu bên trong + rác + chế độ cắt lớp
  const interior = buildInterior();
  station.root.add(interior.group);
  ctx.interior = interior;
  setupRear(ctx, bridge, interior);
  setupTrash(ctx, bridge, interior);
  setupSlot(ctx, bridge, interior);
  setupLaser(ctx, interior);
  mountHandTray(document.getElementById('hand'), ctx);
  setupCutaway(ctx);
  mountCutawayButton(document.getElementById('views'), ctx);
  setupProcessView(ctx, bridge);
  mountDevPanel(ctx);
  ctx.smoothZoom = setupSmoothZoom(ctx);
  mountConfirmDialog(ctx);

  // Admin đổi giá -> vẽ lại tấm hướng dẫn trên thân máy
  let lastPrices = JSON.stringify(state?.prices);
  bridge.onState((s) => {
    const p = JSON.stringify(s.prices);
    if (p === lastPrices) return;
    lastPrices = p;
    const mat = ctx.parts.infoPanel.material;
    mat.map?.dispose();
    mat.map = infoTexture(s.prices);
    mat.needsUpdate = true;
  });

  const onResize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  };
  window.addEventListener('resize', onResize);

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    controls.update();
    for (const fn of ctx.onFrame) fn(dt, clock.elapsedTime);
    renderer.render(scene, camera);
  });

  document.getElementById('loading').classList.add('hidden');
}

init().catch((e) => {
  console.error(e);
  const el = document.getElementById('loading');
  el.textContent = 'Lỗi khởi tạo 3D: ' + e.message;
  el.classList.add('error');
});
