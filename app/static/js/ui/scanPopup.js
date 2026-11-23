// Vẽ ảnh nhận diện của camera (khung từng vật). Ảnh quét tính tiền hiện trong bảng "Khu phân loại" ở góc
// (ui/sorterHud.js) – không còn popup che giữa màn hình.
export const COLORS = {
  bottle: { stroke: '#22c55e', fill: '#15803d', name: 'Chai nhựa' },
  can: { stroke: '#38bdf8', fill: '#0369a1', name: 'Lon' },
  other: { stroke: '#ef4444', fill: '#b91c1c', name: 'Rác lạ' },
  unknown: { stroke: '#facc15', fill: '#a16207', name: 'Vật lạ' },
};
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const boxColor = (b) => (b.source === 'background' ? COLORS.unknown : COLORS[b.group] || COLORS.other);

/** Vẽ ảnh + khung đánh số lên canvas */
export function drawBoxes(canvas, d, img, { numbered = true, order = false } = {}) {
  const g = canvas.getContext('2d');
  canvas.width = d.width; canvas.height = d.height;
  g.drawImage(img, 0, 0, d.width, d.height);
  const lw = Math.max(2, Math.round(d.width / 240));
  g.font = `700 ${Math.max(12, Math.round(d.width / 40))}px "Be Vietnam Pro", Arial`;
  g.textBaseline = 'bottom';
  d.boxes.forEach((b, i) => {
    const [x1, y1, x2, y2] = b.bbox;
    const c = order ? { stroke: '#f59e0b', fill: '#b45309', name: b.label_vi } : boxColor(b);
    g.lineWidth = lw;
    g.strokeStyle = c.stroke;
    g.setLineDash(b.source === 'background' ? [8, 6] : []);
    g.strokeRect(x1, y1, x2 - x1, y2 - y1);
    g.setLineDash([]);
    const conf = b.source === 'background' ? '' : ` ${Math.round(b.confidence * 100)}%`;
    const text = order ? `${i + 1}` : `${numbered ? `${i + 1}. ` : ''}${c.name}${conf}`;
    const tw = g.measureText(text).width + 10, th = Math.max(16, Math.round(d.width / 32));
    const ty = y1 - th < 0 ? y1 + th : y1;
    g.fillStyle = c.fill;
    g.fillRect(x1, ty - th, tw, th);
    g.fillStyle = '#fff';
    g.fillText(text, x1 + 5, ty - 3);
  });
}
