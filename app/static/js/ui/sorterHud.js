// Bảng "Khu phân loại" góc dưới phải (thay popup ảnh quét giữa màn hình):
//   ảnh quét tính tiền (khung nhận diện + kết luận), trạng thái máy, ảnh camera khay + thứ tự lùa vào phễu,
//   ảnh camera băng chuyền + phép tính hẹn giờ thanh gạt (thời gian = quãng đường / tốc độ băng).
import { D } from '../station/dims.js';
import { COLORS, drawBoxes, esc } from './scanPopup.js';
const KIND = { bottle: 'thùng CHAI (thanh gạt 1)', can: 'thùng LON (thanh gạt 2)', other: 'thùng KHÁC (tấm gạt cuối băng)' };
const BY = { belt: 'camera băng chuyền', sorter: 'theo camera khay', none: 'không nhận ra' };

function stateText(s) {
  const so = s.sorter || {}, fu = s.funnel || {};
  if (fu.jam) return 'Phễu bị kẹt – đã báo nhân viên (bấm “Gỡ kẹt” để mô phỏng nhân viên gỡ)';
  if (fu.open > 0) return `Camera băng chuyền chưa thấy vật rơi xuống → mở dần phễu ${Math.round(fu.open * 100)}%`;
  if (so.belt_busy && !so.running) return 'Vật từ lỗ từ thiện đang qua băng chuyền';
  switch (so.state) {
    case 'start': return 'Bắt đầu phân loại trên khay';
    case 'scan': return `Camera khay quét (vòng ${so.round || 1})`;
    case 'vibrate': return 'Vật chồng nhau → rung khay tản ra';
    case 'pick': return `Tay gắp lùa vật ${so.current || ''}/${so.total || ''} vào phễu`;
    case 'sweep': return 'Gạt vật còn sót vào phễu';
    case 'error': return `Lỗi: ${so.error || ''}`;
    default: return 'Đã phân loại xong';
  }
}

export function mountSorterHud(ctx) {
  const bridge = ctx.bridge;
  const el = document.createElement('aside');
  el.className = 'sorter-hud';
  el.hidden = true;
  el.setAttribute('aria-label', 'Khu phân loại');
  el.innerHTML = `
    <header><b>Camera & khu phân loại</b><span class="sh-prog"></span><button type="button" class="sh-min" aria-label="Thu gọn">–</button></header>
    <section class="sh-scan" hidden>
      <div class="sh-scan-head"><b class="sh-scan-title"></b><small class="sh-scan-det"></small></div>
      <canvas class="sh-scan-img" aria-label="Ảnh camera khay với khung nhận diện"></canvas>
      <div class="sh-chips"></div>
      <p class="sh-scan-msg"></p>
    </section>
    <p class="sh-state"></p>
    <button type="button" class="sh-jam mini" hidden>Gỡ kẹt phễu</button>
    <div class="sh-cams">
      <figure><canvas class="sh-tray"></canvas><figcaption>Camera khay · số = thứ tự lùa vào phễu (giữa trước, rồi gần phễu nhất)</figcaption></figure>
      <figure><img class="sh-belt" alt="Ảnh camera băng chuyền"><figcaption class="sh-calc">Camera băng chuyền</figcaption></figure>
    </div>
    <ol class="sh-log"></ol>`;
  document.body.appendChild(el);
  el.querySelector('.sh-min').addEventListener('click', () => el.classList.toggle('min'));
  el.querySelector('.sh-jam').addEventListener('click', () => ctx.trash?.clearJam());
  const log = [];
  let hideTimer = null;
  let holdUntil = 0;                 // giữ bảng hiện ít nhất tới lúc này (vừa có ảnh quét mới)

  // ---- Ảnh quét tính tiền (trước đây là popup giữa màn hình)
  const scan = el.querySelector('.sh-scan');
  bridge.socket.on('scan:result', (d) => {
    const tone = d.decision === 'accept' ? 'ok' : d.decision === 'empty' ? 'info' : 'bad';
    scan.className = `sh-scan ${tone}`;
    scan.querySelector('.sh-scan-title').textContent = d.decision === 'accept' ? `Quét khay · hợp lệ +${d.amount_text}`
      : d.decision === 'empty' ? 'Quét khay · khay trống'
        : d.scan_failed ? 'Quét khay · rác chồng nhau' : '⚠ Quét khay · có rác không phải chai / lon';
    scan.querySelector('.sh-scan-det').textContent = d.detector ? `nhận diện: ${d.detector}` : '';
    scan.querySelector('.sh-chips').innerHTML = [['bottle', d.bottles], ['can', d.cans], ['other', d.others], ['unknown', d.unknown]]
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `<span class="sh-chip" style="--c:${COLORS[k].stroke}">${COLORS[k].name}: <b>${n}</b></span>`).join('');
    scan.querySelector('.sh-scan-msg').textContent = d.message || '';
    const img = new Image();
    img.onload = () => drawBoxes(scan.querySelector('canvas'), d, img);
    img.src = d.image;
    scan.hidden = false;
    el.classList.remove('min');
    clearTimeout(hideTimer); hideTimer = null;
    holdUntil = Date.now() + 8000;
    el.hidden = false;
    ctx.onScanResult?.(d);
  });

  bridge.socket.on('sorter:scan', (d) => {
    const img = new Image();
    img.onload = () => drawBoxes(el.querySelector('.sh-tray'), d, img, { order: true });
    img.src = d.image;
  });
  bridge.socket.on('belt:frame', (d) => {
    const belt = el.querySelector('.sh-belt');
    belt.src = d.image;
    const target = D.BELT.pushers[d.kind] ?? D.BELT.endX;
    const dist = (target - D.BELT.camX).toFixed(2);
    const conf = d.confidence != null ? ` ${Math.round(d.confidence * 100)}%` : '';
    el.querySelector('.sh-calc').innerHTML = `<b>${esc(d.label_vi)}${conf}</b> (${BY[d.by]}) → ${KIND[d.kind]}<br>
      hẹn giờ: ${dist} m ÷ ${D.BELT.speed} m/s = <b>${d.delay.toFixed(2)} s</b>`;
    log.unshift(`${d.source === 'slot' ? '♥ ' : ''}${esc(d.label_vi)} → ${d.kind === 'bottle' ? 'chai' : d.kind === 'can' ? 'lon' : 'khác'} sau ${d.delay.toFixed(2)} s`);
    log.length = Math.min(log.length, 5);
    el.querySelector('.sh-log').innerHTML = log.map((x) => `<li>${x}</li>`).join('');
  });

  bridge.onState((s) => {
    const so = s.sorter || {};
    const active = so.running || so.belt_busy;
    el.querySelector('.sh-state').textContent = stateText(s);
    el.querySelector('.sh-state').classList.toggle('err', so.state === 'error' || !!s.funnel?.jam);
    el.querySelector('.sh-jam').hidden = !s.funnel?.jam;
    el.querySelector('.sh-prog').textContent = so.running && so.total ? `${so.done}/${so.total} vật` : '';
    if (active || so.state === 'error' || s.funnel?.jam || s.state === 'ALARM' || Date.now() < holdUntil) {
      clearTimeout(hideTimer); hideTimer = null;
      el.hidden = false;
    } else if (!el.hidden && !hideTimer) {
      hideTimer = setTimeout(() => { el.hidden = true; hideTimer = null; }, 7000);
    }
  });
}
