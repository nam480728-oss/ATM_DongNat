// Các góc nhìn nhanh: camera bay mượt tới vị trí đặt sẵn
import { D } from '../station/dims.js';

export const VIEWS = {
  overview: { label: 'Toàn cảnh', pos: [1.75, 1.55, 3.1], target: [0, 1.0, 0] },
  panel:    { label: 'Bảng thao tác', pos: [D.SCREEN.x + 0.03, 1.53, D.FRONT + 0.56], target: [D.SCREEN.x, 1.42, D.FRONT] },
  door:     { label: 'Cửa nạp', pos: [0.35, 1.40, D.FRONT + 1.45], target: [0, 1.0, D.FRONT] },
  ret:      { label: 'Ngăn trả rác', pos: [0.35, 0.95, D.FRONT + 1.40], target: [0, 0.28, D.FRONT] },
  back:     { label: 'Mặt sau', pos: [-0.75, 1.15, -D.FRONT - 1.75], target: [0, 0.42, -D.FRONT] },
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

export function mountViewButtons(container, camera, controls) {
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
    });
    buttons[key] = b;
    container.appendChild(b);
  }
  buttons.overview.classList.add('active');
  // Người dùng tự xoay thì bỏ trạng thái "đang chọn"
  controls.addEventListener('start', () => Object.values(buttons).forEach((x) => x.classList.remove('active')));
  return buttons;
}
