// Màn xác nhận: sau khi camera quét xong, hiện ảnh nhận diện (khung từng vật) + kết quả + nút OK.
// Máy đứng chờ ở trạng thái WAITING_CONFIRM; bấm OK -> server mới nghiêng mặt phẳng (đổ vào thùng / trả lại).
const COLORS = {
  bottle: { stroke: '#22c55e', fill: '#15803d', name: 'Chai nhựa' },
  can: { stroke: '#38bdf8', fill: '#0369a1', name: 'Lon nhôm' },
  other: { stroke: '#ef4444', fill: '#b91c1c', name: 'Rác' },
  unknown: { stroke: '#facc15', fill: '#a16207', name: 'Vật lạ' },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function mountConfirmDialog(ctx) {
  const bridge = ctx.bridge;
  const el = document.createElement('div');
  el.className = 'confirm-wrap';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-labelledby', 'cf-title');
  el.hidden = true;
  document.body.appendChild(el);
  let shownImage = null;
  let sending = false;

  function colorOf(b) {
    if (b.source === 'background') return COLORS.unknown;
    return COLORS[b.group] || COLORS.other;
  }

  function draw(canvas, d, img) {
    const g = canvas.getContext('2d');
    canvas.width = d.width; canvas.height = d.height;
    g.drawImage(img, 0, 0, d.width, d.height);
    const lw = Math.max(2, Math.round(d.width / 220));
    g.font = `700 ${Math.max(13, Math.round(d.width / 38))}px "Be Vietnam Pro", Arial`;
    g.textBaseline = 'bottom';
    d.boxes.forEach((b, i) => {
      const [x1, y1, x2, y2] = b.bbox;
      const c = colorOf(b);
      g.lineWidth = lw;
      g.strokeStyle = c.stroke;
      g.setLineDash(b.source === 'background' ? [8, 6] : []);
      g.strokeRect(x1, y1, x2 - x1, y2 - y1);
      g.setLineDash([]);
      const text = `${i + 1}. ${c.name}${b.source === 'background' ? '' : ` ${Math.round(b.confidence * 100)}%`}`;
      const tw = g.measureText(text).width + 10, th = Math.max(18, Math.round(d.width / 30));
      const ty = y1 - th < 0 ? y1 + th : y1;
      g.fillStyle = c.fill;
      g.fillRect(x1, ty - th, tw, th);
      g.fillStyle = '#fff';
      g.fillText(text, x1 + 5, ty - 3);
    });
  }

  function render(d) {
    const accept = d.decision === 'accept';
    const tone = accept ? 'ok' : d.decision === 'empty' ? 'empty' : 'bad';
    const head = accept ? 'Hợp lệ – sẽ đổ vào thùng phân loại'
      : d.decision === 'empty' ? 'Không thấy vật nào'
        : d.scan_failed ? 'Rác vẫn đè nhau – sẽ trả lại' : 'Có vật không hợp lệ – sẽ trả lại';
    const chips = [
      ['bottle', d.bottles], ['can', d.cans], ['other', d.others], ['unknown', d.unknown],
    ].filter(([, n]) => n > 0).map(([k, n]) => `<span class="cf-chip" style="--c:${COLORS[k].stroke}">${COLORS[k].name}: <b>${n}</b></span>`).join('')
      || '<span class="cf-chip">0 vật</span>';
    el.innerHTML = `
      <div class="confirm-box ${tone}">
        <header>
          <small>${d.kind === 'slot' ? 'Lỗ bỏ từng chai/lon' : 'Khay nạp'} · Camera buồng quét · nhận diện: ${esc(d.detector)}</small>
          <h2 id="cf-title">${head}</h2>
        </header>
        <div class="cf-img"><canvas aria-label="Ảnh camera buồng quét với khung nhận diện"></canvas></div>
        <div class="cf-sum">
          <div class="cf-chips">${chips}</div>
          ${accept && d.amount > 0 ? `<div class="cf-amount">${esc(d.amount_text)}</div>` : ''}
        </div>
        <p class="cf-msg">${esc(d.message)}</p>
        <button class="cf-ok" type="button">OK</button>
      </div>`;
    const canvas = el.querySelector('canvas');
    const img = new Image();
    img.onload = () => draw(canvas, d, img);
    img.src = d.image;
    const ok = el.querySelector('.cf-ok');
    ok.addEventListener('click', async () => {
      if (sending) return;
      sending = true;
      ok.disabled = true;
      ok.textContent = 'Đang xử lý…';
      const res = await bridge.ui('confirm');
      sending = false;
      if (!res?.ok) { ok.disabled = false; ok.textContent = 'OK'; }
    });
    el.hidden = false;
    requestAnimationFrame(() => { el.classList.add('show'); ok.focus(); });
  }

  function hide() {
    if (el.hidden) return;
    el.classList.remove('show');
    shownImage = null;
    setTimeout(() => { if (!shownImage) el.hidden = true; }, 250);
  }

  const show = (d) => {
    if (!d || d.image === shownImage) return;
    shownImage = d.image;
    render(d);
  };
  bridge.socket.on('confirm:request', show);
  bridge.onState((s) => {
    if (s.state === 'WAITING_CONFIRM' && s.confirm) show(s.confirm);
    else hide();
  });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.querySelector('.cf-ok')?.click(); });
}
