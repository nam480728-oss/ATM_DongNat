// Máy in nhiệt ngay dưới màn hình trạm: lệnh 'print_voucher' của server -> phiếu voucher (QR + mã + mệnh giá + hạn)
// đùn ra khỏi khe in. Bấm vào phiếu để cầm (vào Ví voucher dạng "phiếu giấy", nhân vật cầm trên tay),
// mang sang quầy thu ngân PEACE Mart bấm "Quét" là thanh toán.
import * as THREE from 'three';
import { D } from './dims.js';
import { toast } from '../ui/toast.js';

const PW = 0.075, PH = 0.13;          // khổ phiếu (m) – giấy in nhiệt 58 mm

function paperTexture(v) {
  const c = document.createElement('canvas'); c.width = 300; c.height = 520;
  const g = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const draw = (qr) => {
    g.fillStyle = '#fbfaf7'; g.fillRect(0, 0, 300, 520);
    g.fillStyle = '#111'; g.textAlign = 'center';
    g.font = '800 30px "Be Vietnam Pro", Arial'; g.fillText('♻ PEACE', 150, 44);
    g.font = '600 18px "Be Vietnam Pro", Arial'; g.fillText('VOUCHER TÁI CHẾ', 150, 70);
    g.setLineDash([6, 5]); g.beginPath(); g.moveTo(16, 86); g.lineTo(284, 86); g.stroke(); g.setLineDash([]);
    g.font = '800 46px "Be Vietnam Pro", Arial'; g.fillText(Number(v.amount).toLocaleString('vi-VN') + 'đ', 150, 138);
    if (qr) g.drawImage(qr, 60, 156, 180, 180); else { g.strokeRect(60, 156, 180, 180); }
    g.font = '800 26px Consolas, monospace'; g.fillText(v.code, 150, 372);
    g.font = '500 17px "Be Vietnam Pro", Arial';
    g.fillText(`Hạn dùng: ${new Date(String(v.expires_at).replace(' ', 'T')).toLocaleDateString('vi-VN')}`, 150, 404);
    g.fillText(`Trạm ${v.station || ''}`, 150, 430);
    g.fillText('Dùng 1 lần · cửa hàng liên kết', 150, 456);
    g.fillStyle = '#666'; g.font = '500 14px "Be Vietnam Pro", Arial';
    g.fillText(new Date().toLocaleString('vi-VN'), 150, 492);
    tex.needsUpdate = true;
  };
  draw(null);
  if (v.qr_svg) {
    const img = new Image();
    img.onload = () => draw(img);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(v.qr_svg);
  }
  return tex;
}

export function setupPrinter(ctx, bridge) {
  const S = D.SCREEN, F = D.FRONT;
  const root = ctx.station.root;
  // ---- khe in (dưới bảng màn hình)
  const slotY = S.y - 0.205;
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.022), new THREE.MeshStandardMaterial({ color: 0x1f2933, roughness: 0.5 }));
  housing.position.set(S.x, slotY, F + 0.011);
  const gap = new THREE.Mesh(new THREE.PlaneGeometry(0.095, 0.004), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  gap.position.set(S.x, slotY - 0.004, F + 0.0225);
  const lc = document.createElement('canvas'); lc.width = 256; lc.height = 40;
  const lg = lc.getContext('2d'); lg.fillStyle = '#1f2933'; lg.fillRect(0, 0, 256, 40);
  lg.fillStyle = '#fde68a'; lg.font = '700 22px "Be Vietnam Pro", Arial'; lg.textAlign = 'center'; lg.fillText('🖨 PHIẾU VOUCHER', 128, 28);
  const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.016), new THREE.MeshStandardMaterial({ map: lt, roughness: 0.6 }));
  label.position.set(S.x, slotY + 0.008, F + 0.0225);
  root.add(housing, gap, label);

  let paper = null;
  function removePaper() { if (!paper) return; root.remove(paper.mesh); paper.mesh.geometry.dispose(); paper.mesh.material.map.dispose(); paper.mesh.material.dispose(); paper = null; }

  bridge.on('print_voucher', async ({ voucher }) => {
    removePaper();
    const geo = new THREE.PlaneGeometry(PW, PH);
    geo.translate(0, -PH / 2, 0);                 // gốc ở mép trên -> đùn xuống từ khe
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: paperTexture(voucher), roughness: 0.85, side: THREE.DoubleSide }));
    mesh.position.set(S.x, slotY - 0.004, F + 0.026);
    mesh.rotation.x = -0.12;                      // giấy hơi cong ra ngoài
    mesh.scale.y = 0.02;
    mesh.castShadow = true;
    mesh.userData.action = 'voucherPaper';
    mesh.userData.hint = `Cầm phiếu voucher ${voucher.code}`;
    paper = { mesh, voucher };
    mesh.userData.onClick = () => take();
    root.add(mesh);
    (ctx.extraPickables ||= []).push(mesh);
    // tiếng máy in + giấy đùn ra
    try {
      const a = new AudioContext(), o = a.createOscillator(), gn = a.createGain();
      o.type = 'sawtooth'; o.frequency.value = 180; gn.gain.value = 0.02;
      o.connect(gn).connect(a.destination); o.start(); o.stop(a.currentTime + 1.2);
    } catch (_) { /* trình duyệt chặn âm thanh */ }
    await window.gsap.to(mesh.scale, { y: 1, duration: 1.3, ease: 'none' }).then();
    toast('Phiếu voucher đã in – bấm vào phiếu ở khe in để cầm', 'info');
    return {};
  });

  function take() {
    if (!paper) return;
    const { mesh, voucher } = paper;
    const i = ctx.extraPickables.indexOf(mesh);
    if (i >= 0) ctx.extraPickables.splice(i, 1);
    // phiếu bay về phía người cầm rồi biến mất (vào tay / ví)
    const target = root.worldToLocal(ctx.camera.position.clone().lerp(mesh.getWorldPosition(new THREE.Vector3()), 0.6));
    window.gsap.to(mesh.position, { x: target.x, y: target.y - 0.1, z: target.z, duration: 0.45, ease: 'power2.in', onComplete: removePaper });
    ctx.shop?.add({ code: voucher.code, amount: voucher.amount, expires_at: voucher.expires_at, status: 'active' }, { paper: true });
    toast(`Đã cầm phiếu voucher ${voucher.code} (${Number(voucher.amount).toLocaleString('vi-VN')}đ) – sang PEACE Mart bấm Quét ở quầy`, 'success');
  }
  ctx.printer = { take, get paper() { return paper; } };
  return ctx.printer;
}
