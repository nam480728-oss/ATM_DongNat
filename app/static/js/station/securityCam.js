// Camera giám sát gắn ngay trên màn hình trạm, nhìn thẳng vào người đứng dùng trạm.
//  * Chụp ảnh khi server báo sự cố (lệnh capture camera='security'): kèm chữ OSD (mã trạm, giờ, REC).
//  * Tự phát hiện bị che: mỗi giây đo độ sáng ảnh nhỏ, tối liên tục >= 5 giây -> cảm biến camera_blocked
//    (gửi kèm ảnh rõ cuối cùng trước khi bị che).
//  * Va đập: bấm dồn dập vào thân trạm (>= 5 lần / 2 giây) = cảm biến rung báo va đập (g).
//  * Người dùng 3D đứng trước trạm khi có phiên (hoặc khi có người phá) để camera có người mà chụp.
// Panel Dev có nút giả lập: đá vào trạm, cạy cửa, che camera.
import * as THREE from 'three';
import { D } from './dims.js';
import { makePerson } from '../city/people.js';
import { toast } from '../ui/toast.js';

export const PERSON_LAYER = 2;
const BLOCK_SEC = 5;          // tối liên tục bấy nhiêu giây = bị che
const DARK = 0.07;            // độ sáng trung bình (0..1) dưới mức này = tối

export function setupSecurityCam(ctx, bridge) {
  const { renderer, scene, station } = ctx;
  const S = D.SCREEN;
  const F = D.FRONT;

  // ---------------------------------------------------------------- phần cứng: hộp camera + đèn REC + nhãn
  const housing = new THREE.Group();
  housing.position.set(S.x, S.y + 0.2, F + 0.012);
  const black = new THREE.MeshStandardMaterial({ color: 0x0b0f14, roughness: 0.35, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.05, 0.035), black);
  body.position.z = 0.0175;
  housing.add(body);
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.012, 20),
    new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.05, metalness: 0.9 }));
  lens.rotation.x = Math.PI / 2; lens.position.set(0, 0, 0.041);
  housing.add(lens);
  const recMat = new THREE.MeshStandardMaterial({ color: 0xef4444, emissive: 0xef4444, emissiveIntensity: 1.5 });
  const rec = new THREE.Mesh(new THREE.SphereGeometry(0.004, 8, 6), recMat);
  rec.position.set(0.038, 0.012, 0.036);
  housing.add(rec);
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.fillStyle = '#fde047'; g.fillRect(0, 0, 512, 96);
  g.fillStyle = '#111'; g.font = '800 40px "Be Vietnam Pro", Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('● KHU VỰC CÓ CAMERA', 256, 50);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sticker = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.028), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
  sticker.position.set(0, -0.04, 0.001);
  housing.add(sticker);
  housing.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  station.root.add(housing);

  // bàn tay che ống kính (giả lập)
  const skin = new THREE.MeshStandardMaterial({ color: 0xe0ac69, roughness: 0.8 });
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.03), skin);
  hand.position.set(S.x, S.y + 0.2, F + 0.088);
  hand.visible = false;
  station.root.add(hand);
  // nhìn từ ống kính, lòng bàn tay áp sát = gần như đen (không có ánh sáng lọt vào) -> tấm đen chỉ camera giám sát thấy
  const palm = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
  palm.rotation.y = Math.PI;
  palm.position.set(0, 0, -0.02);        // nhô trước mặt hộp bàn tay 5 mm (không chồng mặt)
  palm.layers.set(3);
  hand.add(palm);

  // ---------------------------------------------------------------- camera ảo
  const cam = new THREE.PerspectiveCamera(72, 4 / 3, 0.005, 40);
  station.root.add(cam);
  cam.position.set(S.x, S.y + 0.2, F + 0.06);
  station.root.updateMatrixWorld(true);
  cam.lookAt(new THREE.Vector3(-0.3, 1.2, F + 1.25).applyMatrix4(station.root.matrixWorld));   // ngang ngực người đứng trước khay
  cam.layers.enable(PERSON_LAYER);
  cam.layers.enable(3);
  const W = 640, Hh = 480;
  const rt = new THREE.WebGLRenderTarget(W, Hh, { colorSpace: THREE.SRGBColorSpace, samples: 4 });
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const small = new THREE.WebGLRenderTarget(32, 24, { colorSpace: THREE.SRGBColorSpace });
  small.texture.colorSpace = THREE.SRGBColorSpace;
  const px = new Uint8Array(W * Hh * 4), spx = new Uint8Array(32 * 24 * 4);
  const out = document.createElement('canvas'); out.width = W; out.height = Hh;
  const o2d = out.getContext('2d');
  let before = null;           // ảnh rõ gần nhất (Uint8 pixels đã lật) cho trường hợp bị che

  function renderTo(target, buf, w, h) {
    const prev = renderer.getRenderTarget();
    const draw = () => { renderer.setRenderTarget(target); renderer.render(scene, cam); renderer.readRenderTargetPixels(target, 0, 0, w, h, buf); };
    try {
      if (ctx.cutaway?.withOpaque) ctx.cutaway.withOpaque(draw); else draw();
    } finally { renderer.setRenderTarget(prev); }
  }
  function toImage(pixels, label) {
    const img = o2d.createImageData(W, Hh);
    const row = W * 4;
    for (let y = 0; y < Hh; y++) img.data.set(pixels.subarray((Hh - 1 - y) * row, (Hh - y) * row), y * row);
    o2d.putImageData(img, 0, 0);
    // chữ OSD như camera an ninh thật
    const st = ctx.serverState?.station || {};
    o2d.fillStyle = 'rgba(0,0,0,.45)'; o2d.fillRect(0, 0, W, 34); o2d.fillRect(0, Hh - 30, W, 30);
    o2d.font = 'bold 18px Consolas, monospace'; o2d.fillStyle = '#fff'; o2d.textBaseline = 'middle';
    o2d.fillText(`CAM GIÁM SÁT · ${st.code || ''} · Trạm ${st.id || ''}`, 12, 17);
    o2d.textAlign = 'right';
    o2d.fillText(new Date().toLocaleString('vi-VN'), W - 12, 17);
    o2d.textAlign = 'left';
    o2d.fillStyle = '#ef4444'; o2d.beginPath(); o2d.arc(20, Hh - 15, 6, 0, 7); o2d.fill();
    o2d.fillStyle = '#fff'; o2d.fillText(`REC  ${label || ''}`, 34, Hh - 15);
    return out.toDataURL('image/jpeg', 0.82);
  }
  function snapshot(label) {
    const show = person.visible;
    person.visible = !ctx.player;            // có nhân vật điều khiển thì camera chụp chính nhân vật đó
    station.root.updateMatrixWorld(true);
    renderTo(rt, px, W, Hh);
    person.visible = show;
    return toImage(px, label);
  }
  function brightness() {
    renderTo(small, spx, 32, 24);
    let s = 0;
    for (let i = 0; i < spx.length; i += 4) s += 0.2126 * spx[i] + 0.7152 * spx[i + 1] + 0.0722 * spx[i + 2];
    return s / (32 * 24 * 255);
  }

  // ---------------------------------------------------------------- người đứng dùng trạm
  const person = makePerson({ shirt: 0xf97316, shorts: 0x1e3a8a });
  // đứng lệch trái (trước lỗ từ thiện) để không che cửa khay khi nhìn từ góc toàn cảnh, mặt hướng vào màn hình
  person.position.set(-0.42, 0, F + 0.58);
  person.rotation.y = Math.PI - 0.5;
  person.traverse((o) => o.layers.set(PERSON_LAYER));
  person.visible = false;
  station.root.add(person);
  // người trước máy: nhân vật người chơi (nếu có) hoặc người 3D dựng sẵn
  const who = () => (ctx.player ? ctx.player.body : person);
  const J = new Proxy({}, { get: (_, k) => who().userData.joints[k] });
  let actingUntil = 0;
  const camPos = new THREE.Vector3(), pPos = new THREE.Vector3();

  // ---------------------------------------------------------------- hành vi phá phách (giả lập) + cảm biến
  const shell = station.shell;
  function shake(power = 1) {
    const gs = window.gsap;
    gs.fromTo(shell.position, { x: 0 }, { x: 0.012 * power, duration: 0.05, yoyo: true, repeat: 7, ease: 'sine.inOut', onComplete: () => { shell.position.x = 0; } });
    gs.fromTo(ctx.camera.position, { y: ctx.camera.position.y }, { y: ctx.camera.position.y + 0.01 * power, duration: 0.04, yoyo: true, repeat: 5 });
  }
  function act(ms = 6000) {
    actingUntil = performance.now() + ms;
    if (ctx.player) ctx.player.standAtStation(); else person.visible = true;
  }

  const sensor = (name, value) => new Promise((res) => bridge.socket.emit('security', { name, value }, res));
  const sec = {
    cam, housing, person, snapshot, brightness,
    /** đá / đập vào trạm */
    async kick(g = 3.6) {
      act();
      const gs = window.gsap;
      await gs.to(J.legR.rotation, { x: -1.1, duration: 0.18, ease: 'power2.out' });
      shake(g / 2.5);
      gs.to(J.legR.rotation, { x: 0, duration: 0.3, delay: 0.05 });
      return sensor('impact', g);
    },
    /** cạy cửa / khay khi máy khóa (cảm biến khóa: lực kéo bất thường) */
    async pry(times = 3) {
      act(8000);
      const gs = window.gsap;
      for (let i = 0; i < times; i++) {
        await gs.to([J.armL.rotation, J.armR.rotation], { x: -1.25, duration: 0.2 });
        gs.fromTo(ctx.parts.door.rotation, { y: 0 }, { y: -0.025, duration: 0.06, yoyo: true, repeat: 3 });
        await gs.to([J.armL.rotation, J.armR.rotation], { x: -0.9, duration: 0.25 });
        await sensor('tamper', 1);
      }
      gs.to([J.armL.rotation, J.armR.rotation], { x: 0, duration: 0.3 });
    },
    /** che / bỏ che ống kính */
    cover(on) {
      if (on && !hand.visible) { person.visible = !ctx.player; if (ctx.player) ctx.player.standAtStation(); station.root.updateMatrixWorld(true); renderTo(rt, px, W, Hh); before = px.slice(); }
      hand.visible = on;
      if (on) act(1e9); else actingUntil = performance.now() + 2000;
      window.gsap.to(J.armR.rotation, { x: on ? -2.6 : 0, z: on ? 0.25 : 0, duration: 0.4 });
    },
    get covered() { return hand.visible; },
    /** đang diễn hoạt cảnh phá phách (module nhân vật không ghi đè tay / chân) */
    get acting() { return performance.now() < actingUntil || hand.visible; },
    tamperAttempt: () => sensor('tamper', 1),
  };
  ctx.security = sec;

  // bấm dồn dập vào vỏ trạm = va đập
  const dom = renderer.domElement;
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const hits = [];
  let down = null;
  dom.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  dom.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
    const r = dom.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, ctx.camera);
    const hit = ray.intersectObject(shell, true)[0];
    if (!hit || ctx.pick?.(e)) return;               // bấm vào cửa / màn hình... là thao tác bình thường
    const now = performance.now();
    hits.push(now);
    while (hits.length && now - hits[0] > 2000) hits.shift();
    shake(0.25 + hits.length * 0.08);
    if (hits.length >= 5) {
      hits.length = 0;
      sensor('impact', 2.6 + Math.random());
      act();
    }
  });

  // ---------------------------------------------------------------- vòng lặp: người đứng trước trạm + phát hiện che camera
  let darkSince = 0, reported = false, acc = 0, beforeAcc = 0;
  ctx.onFrame.push((dt) => {
    const s = ctx.serverState || {};
    const want = !ctx.player && (!!s.user || performance.now() < actingUntil || hand.visible);
    if (want !== person.visible) person.visible = want;
    // ẩn khỏi camera chính khi đứng sát (không che khi thao tác màn hình / khay)
    who().getWorldPosition(pPos); camPos.copy(ctx.camera.position);
    const near = Math.hypot(camPos.x - pPos.x, camPos.z - pPos.z) < 2.6 && camPos.z > pPos.z - 0.6;
    if (near && !ctx.player?.walking) ctx.camera.layers.disable(PERSON_LAYER); else ctx.camera.layers.enable(PERSON_LAYER);
    // REC nhấp nháy
    recMat.emissiveIntensity = (performance.now() / 600) % 2 < 1.4 ? 1.6 : 0.2;

    acc += dt; beforeAcc += dt;
    if (acc < 1) return;
    const step = acc; acc = 0;
    // chỉ đo độ sáng khi có thể bị che (đỡ tốn 1 lượt vẽ mỗi giây khi không ai đứng trước máy)
    if (!hand.visible && !darkSince) {
      const someone = ctx.player ? Math.hypot(pPos.x, pPos.z - F) < 3 : person.visible;
      if (beforeAcc > 5 && someone) { beforeAcc = 0; renderTo(rt, px, W, Hh); before = px.slice(); }
      return;
    }
    const b = brightness();
    const now = performance.now();       // đếm theo đồng hồ thật (tab bị hãm FPS vẫn đúng 5 giây)
    if (b < DARK) {
      darkSince ||= now - step * 1000;
      const sec = (now - darkSince) / 1000;
      if (sec >= BLOCK_SEC && !reported) { reported = true; sensor('camera_blocked', Math.round(sec)); }
    } else {
      if (reported) sensor('camera_blocked', 0);
      darkSince = 0; reported = false;
    }
  });

  // ---------------------------------------------------------------- lệnh chụp từ server (bọc lệnh capture có sẵn)
  const inner = bridge.handler('capture');
  bridge.on('capture', async (args = {}) => {
    if (args.camera !== 'security') return inner(args);
    const label = hand.visible ? 'CAMERA BỊ CHE' : 'SỰ CỐ';
    const image = snapshot(label);
    const data = { image };
    if (hand.visible && before) data.before = toImage(before, 'ẢNH TRƯỚC KHI BỊ CHE');
    ctx.lastCapture.security = { image, hints: [] };
    return data;
  });

  // cảnh báo trên trang mô phỏng
  bridge.onEvent('security', (ev) => toast(`Đã gửi sự cố cho admin: ${ev.detail}`, 'info'));
  return sec;
}
