// Texture vẽ bằng canvas (bảng hiệu, tấm hướng dẫn, nhãn, gạch lát...)
import * as THREE from 'three';

export const FONT = '"Be Vietnam Pro", "Segoe UI", Arial, sans-serif';

export async function loadFonts() {
  try {
    await Promise.all([
      document.fonts.load(`800 64px "Be Vietnam Pro"`),
      document.fonts.load(`600 32px "Be Vietnam Pro"`),
      document.fonts.load(`400 24px "Be Vietnam Pro"`),
    ]);
  } catch (_) { /* dùng font dự phòng */ }
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  return t;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// Logo tái chế: 3 mũi tên đuổi nhau
export function drawRecycle(g, cx, cy, size, color) {
  g.save();
  g.translate(cx, cy);
  g.strokeStyle = color; g.fillStyle = color;
  g.lineWidth = size * 0.13; g.lineCap = 'round';
  const R = size * 0.36;
  for (let i = 0; i < 3; i++) {
    g.save();
    g.rotate((i * 2 * Math.PI) / 3);
    const a0 = -Math.PI / 2 + 0.38, a1 = -Math.PI / 2 + 1.62;
    g.beginPath(); g.arc(0, 0, R, a0, a1); g.stroke();
    // đầu mũi tên
    const ex = Math.cos(a1) * R, ey = Math.sin(a1) * R;
    const ang = a1 + Math.PI / 2;
    const s = size * 0.17;
    g.beginPath();
    g.moveTo(ex + Math.cos(ang) * s, ey + Math.sin(ang) * s);
    g.lineTo(ex + Math.cos(ang + 2.3) * s, ey + Math.sin(ang + 2.3) * s);
    g.lineTo(ex + Math.cos(ang - 2.3) * s, ey + Math.sin(ang - 2.3) * s);
    g.closePath(); g.fill();
    g.restore();
  }
  g.restore();
}

function drawBottle(g, x, y, s, color) {
  g.save(); g.translate(x, y); g.fillStyle = color;
  roundRect(g, -0.16 * s, -0.10 * s, 0.32 * s, 0.6 * s, 0.07 * s); g.fill();
  g.beginPath();
  g.moveTo(-0.16 * s, -0.08 * s); g.quadraticCurveTo(-0.16 * s, -0.28 * s, -0.06 * s, -0.36 * s);
  g.lineTo(0.06 * s, -0.36 * s); g.quadraticCurveTo(0.16 * s, -0.28 * s, 0.16 * s, -0.08 * s); g.fill();
  g.fillRect(-0.07 * s, -0.48 * s, 0.14 * s, 0.13 * s);
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(-0.16 * s, 0.1 * s, 0.32 * s, 0.14 * s);
  g.restore();
}

function drawCan(g, x, y, s, color) {
  g.save(); g.translate(x, y); g.fillStyle = color;
  roundRect(g, -0.18 * s, -0.36 * s, 0.36 * s, 0.72 * s, 0.05 * s); g.fill();
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillRect(-0.18 * s, -0.30 * s, 0.36 * s, 0.03 * s);
  g.fillRect(-0.18 * s, 0.27 * s, 0.36 * s, 0.03 * s);
  g.restore();
}

export function signTexture() {
  const [c, g] = canvas(2048, 400);
  const grad = g.createLinearGradient(0, 0, 0, 400);
  grad.addColorStop(0, '#22c55e'); grad.addColorStop(1, '#15803d');
  g.fillStyle = grad; g.fillRect(0, 0, 2048, 400);
  drawRecycle(g, 230, 200, 300, '#ffffff');
  g.fillStyle = '#ffffff';
  g.font = `800 190px ${FONT}`; g.textBaseline = 'middle';
  g.fillText('ATM ĐỒNG NÁT', 420, 175);
  g.font = `500 64px ${FONT}`; g.fillStyle = 'rgba(255,255,255,.9)';
  g.fillText('Đổi nhựa & kim loại lấy tiền', 430, 320);
  return toTexture(c);
}

export function infoTexture(prices = { bottle: 200, can: 300 }) {
  // tỉ lệ = tấm hướng dẫn 34 × 26 cm
  const [c, g] = canvas(1024, 784);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 784);
  g.fillStyle = '#16a34a'; g.fillRect(0, 0, 1024, 116);
  g.fillStyle = '#fff'; g.font = `800 60px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('CHỈ NHẬN', 512, 62);

  const fmt = (n) => n.toLocaleString('vi-VN') + 'đ';
  drawBottle(g, 270, 270, 220, '#38bdf8');
  drawCan(g, 754, 270, 220, '#94a3b8');
  for (const [x, name, price] of [[270, 'Nhựa', prices.bottle], [754, 'Kim loại', prices.can]]) {
    g.fillStyle = '#0f172a'; g.font = `700 46px ${FONT}`;
    g.fillText(name, x, 430);
    g.fillStyle = '#16a34a'; g.font = `800 70px ${FONT}`;
    g.fillText(fmt(price), x, 502);
  }
  g.strokeStyle = '#e2e8f0'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(60, 562); g.lineTo(964, 562); g.stroke();
  g.fillStyle = '#b91c1c'; g.font = `700 40px ${FONT}`;
  g.fillText('✕ KHÔNG NHẬN', 512, 610);
  g.fillStyle = '#334155'; g.font = `500 32px ${FONT}`;
  g.fillText('Hộp giấy, túi nilon, thủy tinh, hộp xốp…', 512, 662);
  g.fillStyle = '#64748b'; g.font = `400 28px ${FONT}`;
  g.fillText('Có vật lạ trong khay → trả lại toàn bộ rác', 512, 718);
  return toTexture(c);
}

/** Nhãn cạnh lỗ bỏ chai */
export function slotLabelTexture() {
  const [c, g] = canvas(640, 320);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 640, 320);
  g.fillStyle = '#16a34a'; roundRect(g, 0, 0, 640, 320, 36); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `800 74px ${FONT}`; g.fillText('BỎ TỪNG', 320, 78);
  g.fillText('MÓN', 320, 160);
  g.font = `500 40px ${FONT}`; g.fillStyle = '#dcfce7';
  g.fillText('◀ nằm ngang, không cần', 320, 236);
  g.fillText('mở cửa', 320, 284);
  return toTexture(c);
}

/** Nhãn cửa sau */
export function rearLabelTexture() {
  const [c, g] = canvas(1024, 256);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#16a34a'; g.fillRect(0, 0, 1024, 18); g.fillRect(0, 238, 1024, 18);
  drawRecycle(g, 120, 128, 150, '#16a34a');
  g.fillStyle = '#0f172a'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.font = `800 66px ${FONT}`; g.fillText('CỬA THU GOM', 230, 98);
  g.font = `500 40px ${FONT}`; g.fillStyle = '#b45309';
  g.fillText('Chỉ dành cho nhân viên', 230, 168);
  return toTexture(c);
}

export function labelTexture(text, { bg = '#1f2933', fg = '#ffffff', w = 1024, h = 160, size = 84, weight = 700 } = {}) {
  const [c, g] = canvas(w, h);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `${weight} ${size}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  return toTexture(c);
}

export function sideDecalTexture() {
  const [c, g] = canvas(1024, 1024);
  g.clearRect(0, 0, 1024, 1024);
  drawRecycle(g, 512, 430, 620, '#16a34a');
  g.fillStyle = '#166534'; g.font = `800 92px ${FONT}`; g.textAlign = 'center';
  g.fillText('TÁI CHẾ', 512, 860);
  g.font = `500 52px ${FONT}`; g.fillStyle = '#15803d';
  g.fillText('vì môi trường xanh', 512, 940);
  return toTexture(c);
}

// Gạch lát vỉa hè (lục giác/chữ nhật lệch hàng)
export function pavingTexture() {
  const [c, g] = canvas(1024, 1024);
  g.fillStyle = '#8f8a82'; g.fillRect(0, 0, 1024, 1024);
  const rows = 8, cols = 4, bh = 1024 / rows, bw = 1024 / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw / 2;
    for (let k = -1; k < cols + 1; k++) {
      const x = k * bw + off, y = r * bh;
      const v = 168 + Math.floor(Math.random() * 26);
      g.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
      g.fillRect(x + 5, y + 5, bw - 10, bh - 10);
      // vân bề mặt
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
        g.fillRect(x + 5 + Math.random() * (bw - 14), y + 5 + Math.random() * (bh - 14), 3, 3);
      }
    }
  }
  return toTexture(c, { repeat: [10, 10] });
}

export function asphaltTexture() {
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#3b3f44'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6000; i++) {
    const v = 40 + Math.random() * 50;
    g.fillStyle = `rgba(${v},${v},${v + 4},0.6)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  return toTexture(c, { repeat: [20, 3] });
}

export function wallTexture() {
  const [c, g] = canvas(1024, 512);
  g.fillStyle = '#e9e2d4'; g.fillRect(0, 0, 1024, 512);
  for (let i = 0; i < 3000; i++) {
    g.fillStyle = `rgba(120,100,70,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * 1024, Math.random() * 512, 4, 4);
  }
  g.fillStyle = '#cfc6b4'; g.fillRect(0, 470, 1024, 42); // chân tường
  return toTexture(c, { repeat: [3, 1] });
}

export function skyTexture() {
  const [c, g] = canvas(16, 512);
  const grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#5aa7e6'); grad.addColorStop(0.55, '#a9d4f5'); grad.addColorStop(1, '#eef6fb');
  g.fillStyle = grad; g.fillRect(0, 0, 16, 512);
  const t = toTexture(c);
  t.mapping = THREE.EquirectangularReflectionMapping;
  return t;
}

export function screenPlaceholderTexture() {
  const [c, g] = canvas(1024, 640);
  const grad = g.createLinearGradient(0, 0, 1024, 640);
  grad.addColorStop(0, '#052e16'); grad.addColorStop(1, '#14532d');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 640);
  drawRecycle(g, 512, 250, 260, '#4ade80');
  g.fillStyle = '#fff'; g.font = `700 64px ${FONT}`; g.textAlign = 'center';
  g.fillText('ATM Đồng Nát', 512, 470);
  g.font = `400 34px ${FONT}`; g.fillStyle = '#bbf7d0';
  g.fillText('Chạm để bắt đầu', 512, 540);
  return toTexture(c);
}
