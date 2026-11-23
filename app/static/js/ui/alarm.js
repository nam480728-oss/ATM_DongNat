// Cảnh báo rác lạ ở khoang nạp: loa hú (Web Audio) + đèn xoay đỏ trên nóc + viền đỏ quanh cửa nhấp nháy
// + khung đỏ quanh đúng vật lạ trong khoang + băng rôn đỏ trên trang mô phỏng.
import * as THREE from 'three';

const ALARM_SECONDS = 5;   // trùng app/config.py ALARM_SECONDS

export function setupAlarm(ctx, bridge) {
  const p = ctx.parts;
  const T = ctx.trash;
  const st = { on: false, muted: false };
  ctx.alarm = st;

  // ---- băng rôn đỏ ----
  const el = document.createElement('div');
  el.className = 'alarm-banner';
  el.setAttribute('role', 'alert');
  el.hidden = true;
  el.innerHTML = `<span class="ab-ic">⚠</span>
    <div><b>CÓ RÁC KHÔNG PHẢI CHAI / LON!</b><small>Cửa đã bung hé – mở cửa, rút khay, lấy vật khoanh đỏ ra (bỏ vào thùng rác mini 2 bên), đẩy khay vào rồi đóng cửa để quét lại</small></div>
    <button type="button" class="ab-mute" aria-label="Tắt tiếng loa">🔊</button>`;
  document.body.appendChild(el);
  const vignette = document.createElement('div');
  vignette.className = 'alarm-vignette';
  document.body.appendChild(vignette);
  el.querySelector('.ab-mute').addEventListener('click', () => {
    st.muted = !st.muted;
    el.querySelector('.ab-mute').textContent = st.muted ? '🔇' : '🔊';
    if (st.muted) stopSiren();
  });

  // ---- loa hú ----
  let ac = null, siren = null;
  const unlock = () => { if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { /* không có âm thanh */ } } };
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  function startSiren() {
    if (st.muted || !ac || siren) return;
    if (ac.state === 'suspended') ac.resume();
    const osc = ac.createOscillator(), gain = ac.createGain();
    osc.type = 'sawtooth';
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(ac.destination);
    const t0 = ac.currentTime;
    for (let i = 0; i < ALARM_SECONDS / 0.36; i++) {
      osc.frequency.setValueAtTime(i % 2 ? 640 : 960, t0 + i * 0.36);
    }
    gain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.05);
    gain.gain.setValueAtTime(0.09, t0 + ALARM_SECONDS - 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ALARM_SECONDS);
    osc.start(t0);
    osc.stop(t0 + ALARM_SECONDS + 0.05);
    siren = { osc, gain };
    osc.onended = () => { siren = null; };
  }
  function stopSiren() {
    if (!siren) return;
    try { siren.gain.gain.cancelScheduledValues(0); siren.osc.stop(); } catch (_) { /* đã dừng */ }
    siren = null;
  }

  // ---- khung đỏ quanh vật lạ ----
  const markers = new Map();
  const markMat = new THREE.LineBasicMaterial({ color: 0xff2424, transparent: true, depthTest: false });
  function clearMarkers() {
    markers.forEach((m, it) => { it.remove(m); m.geometry.dispose(); });
    markers.clear();
  }
  const iou = (a, b) => {
    const ix = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
    const iy = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
    const i = ix * iy, u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i;
    return u > 0 ? i / u : 0;
  };
  ctx.onScanResult = (d) => {
    clearMarkers();
    if (d.decision !== 'reject' || d.scan_failed) return;
    const rig = ctx.scanRigs?.tray;
    for (const b of d.boxes.filter((x) => !x.valid)) {
      let best = null, bv = 0;
      for (const it of T.tray) {
        const v = iou(rig.projectBox(it), b.bbox);
        if (v > bv) { bv = v; best = it; }
      }
      if (!best || bv < 0.1 || markers.has(best)) continue;
      const s = best.userData.size;
      const m = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(s.x + 0.02, s.y + 0.02, s.z + 0.02)), markMat);
      m.renderOrder = 10;
      best.add(m);
      markers.set(best, m);
    }
  };

  function set(on) {
    if (on === st.on) return;
    st.on = on;
    el.hidden = !on;
    vignette.classList.toggle('on', on);
    if (on) startSiren(); else { stopSiren(); clearMarkers(); }
  }
  bridge.on('alarm', ({ on }) => { set(!!on); return {}; });
  bridge.onState((s) => set(!!s.alarm));

  const frameMat = p.doorFrameMat;
  ctx.onFrame.push((dt, t) => {
    const flash = st.on ? (Math.sin(t * 12) > 0 ? 1 : 0.08) : 0;
    p.beacons.forEach(({ dome, light }, i) => {
      const f = st.on ? (Math.sin(t * 12 + i * Math.PI) > 0 ? 1 : 0.08) : 0;
      dome.material.emissiveIntensity = st.on ? 3.2 * f : 0.05;
      light.intensity = 3.5 * f;
    });
    frameMat.emissiveIntensity = 2.6 * flash;
    markMat.opacity = st.on ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 10)) : 0;
    // vật đã được lấy ra khỏi khoang -> bỏ khung
    markers.forEach((m, it) => { if (!T.tray.includes(it)) { it.remove(m); m.geometry.dispose(); markers.delete(it); } });
  });
  return st;
}
