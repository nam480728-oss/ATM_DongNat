// Chế độ đồ họa (tối ưu độ mượt): Tự động | Cao | Vừa | Thấp.
//  Cao : hậu kỳ đủ (GTAO + bloom + SMAA), kính khúc xạ, bóng 2048, độ phân giải tới 2x, đủ người.
//  Vừa : bỏ GTAO (lượt hậu kỳ nặng nhất), chai nhựa trong suốt thường (bỏ lượt vẽ khúc xạ), bóng 1024,
//        độ phân giải tối đa 1.25x, 70% người.
//  Thấp: tắt hậu kỳ, bóng 1024 cứng, 1x, 40% người, người không đổ bóng.
// Tự động: bắt đầu ở Cao, đo FPS; thấp hơn 45 FPS liên tục thì hạ 1 bậc (chỉ hạ, không tăng lại để khỏi chập chờn).
import * as THREE from 'three';
import { toast } from './toast.js';

const KEY = 'peace.quality';
const LEVELS = ['low', 'medium', 'high'];
const NAMES = { auto: 'Tự động', high: 'Cao', medium: 'Vừa', low: 'Thấp' };

export function setupQuality(ctx) {
  const { renderer, fx, sun } = ctx;
  let mode = 'auto';
  try { mode = localStorage.getItem(KEY) || 'auto'; } catch (_) { /* không có localStorage */ }
  if (!NAMES[mode]) mode = 'auto';
  let level = mode === 'auto' ? 'high' : mode;

  // vật liệu khúc xạ (transmission) gốc -> bản thường khi chất lượng thấp
  const physical = [];
  function collectPhysical() {
    ctx.scene.traverse((o) => {
      const ms = o.isMesh ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) if (m.isMeshPhysicalMaterial && m.userData.tx0 === undefined && m.transmission > 0) {
        m.userData.tx0 = m.transmission; m.userData.op0 = m.opacity; physical.push(m);
      }
    });
  }

  function apply(lv, announce = false) {
    level = lv;
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(lv === 'high' ? Math.min(dpr, 2) : lv === 'medium' ? Math.min(dpr, 1.25) : 1);
    const el = renderer.domElement.parentElement;
    ctx.onResize?.(el.clientWidth, el.clientHeight);
    fx.enabled = lv !== 'low';
    fx.setAO?.(lv === 'high');
    const size = lv === 'high' ? 2048 : 1024;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose(); sun.shadow.map = null;
    }
    renderer.shadowMap.type = lv === 'low' ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    renderer.shadowMap.needsUpdate = true;
    enforce(true);
    ctx.street?.crowd.setDensity(lv === 'high' ? 1 : lv === 'medium' ? 0.7 : 0.4);
    ctx.street?.crowd.setShadows(lv !== 'low');
    sel.value = mode;
    note.textContent = mode === 'auto' ? `(${NAMES[lv]})` : '';
    if (announce) toast(`Đồ họa tự hạ xuống mức ${NAMES[lv]} cho mượt hơn`, 'info');
  }
  /** kính / chai nhựa mới sinh ra cũng theo chế độ hiện tại */
  function enforce(all = false) {
    const before = physical.length;
    collectPhysical();
    for (const m of all ? physical : physical.slice(before)) {
      const on = level === 'high';
      m.transmission = on ? m.userData.tx0 : 0;
      m.opacity = on ? m.userData.op0 : Math.min(m.userData.op0, 0.45);
      m.transparent = true;
      m.needsUpdate = true;
    }
  }

  // ---- giao diện: ô chọn ở thanh trên
  const wrap = document.createElement('label');
  wrap.className = 'quality-pick';
  wrap.title = 'Chất lượng đồ họa – chọn Thấp nếu máy giật';
  wrap.innerHTML = `<span>Đồ họa</span><select aria-label="Chất lượng đồ họa">
    ${Object.entries(NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><small></small>`;
  const sel = wrap.querySelector('select');
  const note = wrap.querySelector('small');
  document.querySelector('.topbar')?.insertBefore(wrap, document.querySelector('.topbar .hint'));
  sel.addEventListener('change', () => {
    mode = sel.value;
    try { localStorage.setItem(KEY, mode); } catch (_) { /* bỏ qua */ }
    samples.length = 0; settleUntil = performance.now() + 3000;
    apply(mode === 'auto' ? 'high' : mode);
  });

  // ---- đo FPS (bỏ qua lúc tab ẩn / mới đổi chế độ)
  const samples = [];
  let settleUntil = performance.now() + 4000;
  let low = 0, tick = 0;
  ctx.fps = 0;
  ctx.onFrame.push((dt) => {
    if (level === 'low' && ++tick % 90 === 0) enforce();
    if (document.hidden || dt <= 0 || dt > 0.2) return;   // cửa sổ bị che: trình duyệt hãm ~1 FPS -> bỏ qua
    samples.push(dt);
    if (samples.length < 60) return;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    samples.length = 0;
    ctx.fps = Math.round(1 / avg);
    if (mode !== 'auto' || performance.now() < settleUntil) return;
    low = ctx.fps < 45 ? low + 1 : 0;
    const i = LEVELS.indexOf(level);
    if (low >= 3 && i > 0) { low = 0; settleUntil = performance.now() + 3000; apply(LEVELS[i - 1], true); }
  });

  apply(level);
  return { apply, get level() { return level; }, get mode() { return mode; }, refresh: collectPhysical };
}
