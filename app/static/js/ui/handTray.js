// Bảng "Rác trong tay bạn" (chỉ có ở bản mô phỏng): lấy rác mới, xem rác đang cầm, bỏ vào khay
import { ITEM_TYPES } from '../items/itemFactory.js';

const ICON = {
  bottle_500: '🧴', bottle_1500: '🧴', bottle_flat: '🧴', can_tall: '🥫', can_short: '🥫',
  milk_carton: '🥛', plastic_bag: '🛍️', cup_straw: '🥤', glass_bottle: '🍾', foam_box: '📦', paper_ball: '📄',
};

export function mountHandTray(el, ctx) {
  const T = ctx.trash;
  const valid = Object.entries(ITEM_TYPES).filter(([, v]) => v.valid);
  const other = Object.entries(ITEM_TYPES).filter(([, v]) => !v.valid);
  const btn = ([k, v]) => `<button class="item-btn ${v.valid ? '' : 'bad'}" draggable="true" data-type="${k}" title="Bấm hoặc kéo thả vào khay">
      <span class="ic">${ICON[k]}</span><span>${v.name}</span></button>`;

  el.innerHTML = `
    <div class="hand-head">
      <h2>Rác trong tay bạn</h2>
      <button class="collapse" aria-label="Thu gọn">–</button>
    </div>
    <div class="hand-body">
      <div class="target" role="radiogroup" aria-label="Bỏ rác vào đâu">
        <button class="tg" data-target="tray" role="radio">Khay nạp</button>
        <button class="tg" data-target="slot" role="radio">Lỗ bỏ chai ⌀11</button>
      </div>
      <p class="hand-tip" id="hand-tip"></p>
      <h3>Chai nhựa / lon nhôm</h3>
      <div class="item-grid">${valid.map(btn).join('')}</div>
      <h3>Rác khác (không hợp lệ)</h3>
      <div class="item-grid">${other.map(btn).join('')}</div>
      <div class="holding">
        <h3>Đang cầm <span id="hold-count">0</span></h3>
        <div id="hold-list" class="hold-list"></div>
        <div class="hold-actions">
          <button id="take-return" class="mini">Lấy hết ở ngăn trả rác</button>
          <button id="discard" class="mini ghost">Bỏ vào thùng rác thường</button>
        </div>
      </div>
      <div class="tray-info">Trong khay: <b id="tray-count">0</b> vật</div>
    </div>`;

  el.querySelector('.collapse').addEventListener('click', () => el.classList.toggle('collapsed'));
  el.addEventListener('click', (e) => {
    const tg = e.target.closest('[data-target]');
    if (tg) { T.setTarget(tg.dataset.target); return; }
    const b = e.target.closest('.item-btn');
    if (b) { T.drop(b.dataset.type); ctx.bridge.ui('activity'); return; }
    const h = e.target.closest('.hold-chip');
    if (h) {
      const it = T.hand.find((x) => String(x.userData.id) === h.dataset.id);
      if (it) T.drop(it);
    }
  });
  el.addEventListener('dragstart', (e) => {
    const b = e.target.closest('.item-btn');
    if (b) e.dataTransfer.setData('text/atm-item', b.dataset.type);
    const h = e.target.closest('.hold-chip');
    if (h) e.dataTransfer.setData('text/atm-hand', h.dataset.id);
  });
  el.querySelector('#take-return').addEventListener('click', () => T.takeAllFromReturn());
  el.querySelector('#discard').addEventListener('click', () => T.discardHand());

  const TIPS = {
    tray: 'Mở cửa, kéo khay ra rồi bấm (hoặc kéo thả) để bỏ rác vào khay. Bấm vào rác trong khay để lấy ra.',
    slot: 'Bấm để đút từng vật qua lỗ tròn phía trên cửa – không cần mở cửa. Chưa chọn tên thì chỉ phân loại, không tính tiền.',
  };
  const render = () => {
    el.querySelectorAll('[data-target]').forEach((b) => {
      const on = b.dataset.target === T.target;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    el.querySelector('#hand-tip').textContent = TIPS[T.target];
    el.querySelector('#hold-count').textContent = T.hand.length;
    el.querySelector('#tray-count').textContent = T.tray.length;
    el.querySelector('#hold-list').innerHTML = T.hand.length
      ? T.hand.map((it) => {
        const t = ITEM_TYPES[it.userData.type];
        return `<button class="hold-chip ${t.valid ? '' : 'bad'}" draggable="true" data-id="${it.userData.id}" title="Bấm để bỏ vào ${T.target === 'slot' ? 'lỗ bỏ chai' : 'khay'}">${ICON[it.userData.type]} ${t.name}</button>`;
      }).join('')
      : '<span class="none">Chưa cầm gì</span>';
    el.querySelector('#take-return').disabled = !T.ret.length;
    el.querySelector('#discard').disabled = !T.hand.length;
  };
  T.listeners.push(render);
  render();
}
