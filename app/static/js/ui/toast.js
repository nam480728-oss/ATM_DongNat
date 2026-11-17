// Thông báo nổi trên trang mô phỏng (bản sao thông báo của màn hình trạm, để đọc được khi đứng xa)
let root;

export function toast(text, level = 'info', ms = 3800) {
  if (!root) {
    root = document.createElement('div');
    root.className = 'toasts';
    root.setAttribute('role', 'status');
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
  }
  // Không lặp lại thông báo đang hiển thị
  for (const el of root.children) if (el.dataset.text === text) return;
  const el = document.createElement('div');
  el.className = `toast toast-${level}`;
  el.dataset.text = text;
  el.textContent = text;
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
