// Các góc nhìn nhanh: camera bay mượt tới vị trí đặt sẵn
import { D } from '../station/dims.js';

export const VIEWS = {
  overview: { label: 'Toàn cảnh', pos: [2.75, 2.05, 4.7], target: [0, 1.15, 0] },
  panel:    { label: 'Màn hình', pos: [D.SCREEN.x + 0.03, 1.48, D.FRONT + 0.56], target: [D.SCREEN.x, 1.38, D.FRONT] },
  door:     { label: 'Khay nạp', pos: [0.35, 1.55, D.FRONT + 1.5], target: [0, 1.25, D.FRONT] },
  sorter:   { label: 'Phân loại', pos: [-1.95, 1.95, 1.65], target: [-0.2, 0.95, 0.3], cut: true },
  belt:     { label: 'Băng chuyền', pos: [1.3, 1.25, 1.5], target: [-0.1, 0.6, 0.3], cut: true },
  back:     { label: 'Mặt sau', pos: [-0.9, 1.35, -D.FRONT - 2.1], target: [0.25, 0.5, -D.FRONT] },
};

export function flyTo(camera, controls, view, duration = 1.1) {
  const v = typeof view === 'string' ? VIEWS[view] : view;
  const gsap = window.gsap;
  window.ATM?.smoothZoom?.stop();
  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(controls.target);
  gsap.to(camera.position, { x: v.pos[0], y: v.pos[1], z: v.pos[2], duration, ease: 'power2.inOut' });
  gsap.to(controls.target, {
    x: v.target[0], y: v.target[1], z: v.target[2], duration, ease: 'power2.inOut',
    onUpdate: () => controls.update(),
  });
}

export function mountViewButtons(container, camera, controls, ctx) {
  const buttons = {};
  for (const [key, v] of Object.entries(VIEWS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'view-btn';
    b.textContent = v.label;
    b.addEventListener('click', () => {
      Object.values(buttons).forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      flyTo(camera, controls, key);
      if (v.cut) ctx?.cutaway?.set(true);        // nhìn cơ cấu bên trong -> bật cắt vách
      else if (ctx?.cutaway?.on && key !== 'overview') ctx.cutaway.set(false);
    });
    buttons[key] = b;
    container.appendChild(b);
  }
  buttons.overview.classList.add('active');
  // Người dùng tự xoay thì bỏ trạng thái "đang chọn"
  controls.addEventListener('start', () => Object.values(buttons).forEach((x) => x.classList.remove('active')));
  return buttons;
}
