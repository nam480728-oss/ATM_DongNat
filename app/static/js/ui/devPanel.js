// Panel Dev (ẩn, bật/tắt bằng phím ~): công cụ thử các kịch bản đặc biệt của bản mô phỏng
import { toast } from './toast.js';

export function mountDevPanel(ctx) {
  const el = document.createElement('aside');
  el.className = 'dev hidden';
  el.setAttribute('aria-label', 'Công cụ Dev');
  el.innerHTML = `
    <div class="dev-head"><b>Công cụ Dev</b><span class="muted">phím ~ để ẩn</span></div>
    <fieldset class="dev-det">
      <legend>Bộ nhận diện</legend>
      <label><input type="radio" name="dev-det" value="yolo"> Model thật (YOLO)</label>
      <label><input type="radio" name="dev-det" value="mock"> Giả lập theo đáp án 3D (demo mượt)</label>
      <small id="dev-det-note" class="muted"></small>
    </fieldset>
    <label><input type="checkbox" id="dev-overlap"> Ép lỗi “vật đè nhau” khi rung</label>
    <label><input type="checkbox" id="dev-fast"> Tua nhanh hoạt ảnh ×3</label>
    <label><input type="checkbox" id="dev-autocam" checked> Tự đưa camera vào trong khi xử lý</label>
    <button id="dev-full" class="mini">Ép kho đầy</button>
    <button id="dev-snap" class="mini ghost">Xem ảnh camera quét gần nhất</button>
    <a href="/admin" target="_blank" rel="noopener" class="mini ghost link">Mở trang Admin ↗</a>
    <div id="dev-snapview" class="snapview hidden"><canvas width="640" height="480"></canvas></div>`;
  document.body.appendChild(el);

  window.addEventListener('keydown', (e) => {
    if (e.key === '`' || e.key === '~') el.classList.toggle('hidden');
  });
  // Đổi model thật <-> giả lập (lần đầu bật model thật mất vài giây để nạp)
  const radios = [...el.querySelectorAll('input[name="dev-det"]')];
  const note = el.querySelector('#dev-det-note');
  let busy = false;
  const showKind = (kind) => radios.forEach((r) => { r.checked = r.value === kind; });
  ctx.bridge.onState((s) => {
    if (!busy) showKind(s.detector_kind);
    radios.forEach((r) => { r.disabled = busy || !!s.processing; });
    note.textContent = s.processing ? 'Đổi được khi máy rảnh' : '';
  });
  radios.forEach((r) => r.addEventListener('change', async () => {
    busy = true;
    radios.forEach((x) => { x.disabled = true; });
    note.textContent = r.value === 'yolo' ? 'Đang nạp model…' : 'Đang đổi…';
    try {
      const res = await fetch('/api/dev/detector', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: r.value }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) toast(r.value === 'yolo' ? 'Đang dùng model thật (YOLO)' : 'Đang dùng giả lập theo đáp án 3D', 'info');
      else toast(`Không đổi được: ${j.error || res.status}`, 'error');
    } finally {
      busy = false;
      const s = ctx.serverState || {};
      showKind(s.detector_kind);
      radios.forEach((x) => { x.disabled = !!s.processing; });
      note.textContent = '';
    }
  }));

  el.querySelector('#dev-overlap').addEventListener('change', (e) => { ctx.trash.forceOverlap = e.target.checked; });
  el.querySelector('#dev-fast').addEventListener('change', (e) => { window.gsap.globalTimeline.timeScale(e.target.checked ? 3 : 1); });
  el.querySelector('#dev-autocam').addEventListener('change', (e) => ctx.processView.setAuto(e.target.checked));
  el.querySelector('#dev-full').addEventListener('click', async () => {
    const r = await fetch('/api/dev/fill-storage', { method: 'POST' });
    toast(r.ok ? 'Đã ép kho đầy – vào trang Admin để làm trống' : 'Không thực hiện được', r.ok ? 'warning' : 'error');
  });
  el.querySelector('#dev-snap').addEventListener('click', () => {
    const cap = ctx.lastCapture;
    const box = el.querySelector('#dev-snapview');
    if (!cap) { toast('Chưa có ảnh quét nào', 'info'); return; }
    box.classList.toggle('hidden');
    const c = box.querySelector('canvas');
    const g = c.getContext('2d');
    const img = new Image();
    img.onload = () => {
      c.width = img.width; c.height = img.height;   // ảnh quét 1280x960 (canvas co theo CSS)
      g.drawImage(img, 0, 0);
      g.lineWidth = 4; g.font = 'bold 26px sans-serif';
      for (const h of cap.hints) {
        const [x1, y1, x2, y2] = h.bbox;
        g.strokeStyle = h.overlapped ? '#f59e0b' : '#22c55e';
        g.strokeRect(x1, y1, x2 - x1, y2 - y1);
        g.fillStyle = g.strokeStyle;
        g.fillText(h.label, x1 + 4, y1 + 18);
      }
    };
    img.src = cap.image;
  });
}
