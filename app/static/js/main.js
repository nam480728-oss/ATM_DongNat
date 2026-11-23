// Khởi tạo scene 3D: renderer, camera, điều khiển xoay/zoom, ánh sáng, khung phố ven biển (3 trạm, cửa hàng, người),
// trạm đang dùng (đủ cơ cấu + vật lý), camera giám sát, chế độ đồ họa
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildLights } from './world.js';
import { buildStreet, setupStations } from './city/street.js';
import { setupShop } from './city/shop.js';
import { setupSecurityCam } from './station/securityCam.js';
import { setupQuality } from './ui/quality.js';
import { setupInteriorCull } from './station/interiorCull.js';
import { setupPlayer } from './player/player.js';
import { setupTraffic } from './city/traffic.js';
import { setupNpcs } from './city/npcs.js';
import { setupLitter } from './city/litter.js';
import { setupMinimap } from './ui/minimap.js';
import { setupPrinter } from './station/printer.js';
import { skyTexture } from './station/textures.js';
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
import { setupAlarm } from './ui/alarm.js';
import { mountSorterHud } from './ui/sorterHud.js';
import { setupPhysics } from './sim/physics.js';
import { loadHdri, setupPostFx } from './postfx.js';

export const ctx = { THREE };
window.ATM = ctx; // tiện debug trên console

async function fetchState() {
  try {
    const r = await fetch('/api/state?station=' + (window.STATION_ID || 1));
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
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.78;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(40, container.clientWidth / container.clientHeight, 0.03, 240);
  camera.position.set(...VIEWS.overview.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(...VIEWS.overview.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.12;
  controls.maxDistance = 16;
  controls.maxPolarAngle = Math.PI / 2 - 0.02;
  controls.zoomSpeed = 0.9;      // chỉ còn dùng cho pinch trên cảm ứng (con lăn: smoothZoom)
  controls.rotateSpeed = 0.8;
  controls.addEventListener('change', () => {
    // Không cho đi xuyên xuống đất / chạy quá xa
    const t = controls.target;
    // vùng đi lại: dọc phố giữa 3 trạm, sang được cửa hàng đối diện, nhìn ra bãi biển
    t.x = THREE.MathUtils.clamp(t.x, -70, 70);
    t.y = THREE.MathUtils.clamp(t.y, -0.5, 4);
    t.z = THREE.MathUtils.clamp(t.z, -26, 24);
    if (camera.position.y < 0.08) camera.position.y = 0.08;
  });
  controls.update();

  scene.background = skyTexture();
  scene.fog = new THREE.Fog(0xdbeaf5, 35, 150);
  const { sun } = buildLights(scene);
  const hdri = loadHdri(renderer, scene, '/static/vendor/hdri/sky_1k.hdr');

  const station = buildStation({ prices: state?.prices });
  scene.add(station.root);

  Object.assign(ctx, { renderer, scene, camera, controls, station, parts: station.parts, sun });
  ctx.street = buildStreet(ctx);

  mountViewButtons(document.getElementById('views'), camera, controls, ctx);

  ctx.onFrame = []; // các module khác đăng ký hàm chạy mỗi frame
  const bridge = createBridge(ctx);
  ctx.bridge = bridge;

  // Cơ cấu bên trong + vật lý (Rapier) + rác + chế độ cắt vách
  const interior = buildInterior();
  station.root.add(interior.group);
  ctx.interior = interior;
  const physics = await setupPhysics(ctx);
  physics.addTagged(interior.group);
  physics.addTagged(station.root);        // cửa kính
  setupMechanics(ctx, bridge);
  bridge.onMessage((m) => toast(m.text, m.level));
  setupScreenEmbed(ctx);
  setupRear(ctx, bridge, interior);
  setupTrash(ctx, bridge, interior);
  setupSlot(ctx, bridge, interior);
  setupSecurityCam(ctx, bridge);
  setupPrinter(ctx, bridge);
  ctx.stations = setupStations(ctx, ctx.street);
  setupShop(ctx);
  setupTraffic(ctx);
  setupNpcs(ctx);
  setupLitter(ctx);
  setupLaser(ctx, interior);
  mountHandTray(document.getElementById('hand'), ctx);
  setupCutaway(ctx);
  setupInteriorCull(ctx);
  mountCutawayButton(document.getElementById('views'), ctx);
  setupProcessView(ctx, bridge);
  mountDevPanel(ctx);
  ctx.smoothZoom = setupSmoothZoom(ctx);
  setupAlarm(ctx, bridge);
  mountSorterHud(ctx);

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

  const fx = setupPostFx(renderer, scene, camera, container);
  ctx.fx = fx;
  await hdri;
  const onResize = () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    fx.resize(w, h);
  };
  ctx.onResize = onResize;
  window.addEventListener('resize', onResize);
  ctx.quality = setupQuality(ctx);
  setupPlayer(ctx);          // nhân vật: WASD, camera sau lưng / trên cao (V), xem tự do (F)
  setupMinimap(ctx);

  // khung phố: sóng biển + người
  ctx.onFrame.push((dt, t) => {
    ctx.street.sea.update(t);
    ctx.street.crowd.update(dt, t, camera.position);
  });

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    controls.update();
    for (const fn of ctx.onFrame) fn(Math.min(dt, 0.5), clock.elapsedTime);
    renderer.info.reset();          // đếm lệnh vẽ của cả khung hình (mọi lượt hậu kỳ) cho panel Dev
    fx.render();
  });

  document.getElementById('loading').classList.add('hidden');
}

init().catch((e) => {
  console.error(e);
  const el = document.getElementById('loading');
  el.textContent = 'Lỗi khởi tạo 3D: ' + e.message;
  el.classList.add('error');
});
