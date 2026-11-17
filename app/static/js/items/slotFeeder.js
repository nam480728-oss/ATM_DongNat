// Lỗ bỏ từng chai/lon: người dùng đưa 1 vật vào lỗ (không cần mở cửa), vật trượt theo ống xuống mặt phẳng quét.
// Cuối máng có cảm biến hồng ngoại -> báo 'slot_item' cho back-end; back-end quét + nghiêng như quy trình khay.
import * as THREE from 'three';
import { createItem, ITEM_TYPES } from './itemFactory.js';
import { D } from '../station/dims.js';
import { PLATE } from '../station/interior.js';
import { SLOT_FLAP_OPEN, SLOT_OUTLET_Y } from '../station/slot.js';
import { COLORS } from '../station/materials.js';
import { toast } from '../ui/toast.js';

const gsap = () => window.gsap;
const MAX_CROSS = D.SLOT.r * 2 - 0.006; // tiết diện tối đa lọt lỗ

export function setupSlot(ctx, bridge, interior) {
  const T = ctx.trash;
  const p = ctx.parts;
  const plate = interior.plate;
  const S = D.SLOT;
  const st = { open: false, busy: false, sawProcessing: false };
  ctx.slot = st;
  const ledMat = p.slotLed.material;
  const green = new THREE.Color(0x22c55e), red = new THREE.Color(COLORS.red);

  // ------------------------------------------------------------ nắp servo + đèn
  function setGate(open) {
    st.open = open;
    ledMat.color.copy(open ? green : red);
    ledMat.emissive.copy(ledMat.color);
    return new Promise((res) => {
      gsap().to(p.slotFlap.rotation, { x: open ? SLOT_FLAP_OPEN : 0, duration: 0.35, ease: 'power2.inOut', overwrite: true, onComplete: res });
    });
  }
  // (ack không được mang đối tượng tween – socket.io sẽ đệ quy vô hạn khi tuần tự hóa)
  bridge.on('slot_gate', async ({ open }) => { await setGate(!!open); });

  bridge.onState((s) => {
    if (!!s.slot_open !== st.open && !st.busy) setGate(!!s.slot_open);
    if (st.busy) {
      if (s.state === 'PROCESSING_SLOT') st.sawProcessing = true;
      else if (st.sawProcessing && !s.processing) { st.busy = false; st.sawProcessing = false; }
    }
  });

  // ------------------------------------------------------------ lý do lỗ đang đóng
  function closedReason() {
    const s = ctx.serverState || {};
    if (s.processing) return 'Máy đang xử lý, vui lòng chờ rồi bỏ tiếp';
    if (s.station?.is_full) return 'Trạm đã đầy, không nhận thêm rác';
    if (s.maintenance) return 'Trạm đang thu gom / bảo trì';
    if (s.sensors && !s.sensors.return_drawer_in) return 'Hãy đóng ngăn trả rác trước khi bỏ vào lỗ';
    if (s.detector_error) return 'Bộ nhận diện chưa sẵn sàng';
    return 'Lỗ bỏ chai đang đóng';
  }

  function shakeFlap() {
    gsap().fromTo(p.slotFront.position, { x: S.x }, { x: S.x + 0.002, duration: 0.05, yoyo: true, repeat: 3 });
  }

  // ------------------------------------------------------------ đưa 1 vật vào lỗ
  T.insertSlot = function insertSlot(itemOrType) {
    if (st.busy || T.plate.length) { toast('Đang kiểm tra vật trước, chờ chút rồi bỏ tiếp', 'warning'); return false; }
    if (!st.open) { shakeFlap(); toast(closedReason(), 'warning'); return false; }
    const fromHand = typeof itemOrType !== 'string';
    const item = fromHand ? itemOrType : createItem(itemOrType);
    const sz = item.userData.size;
    if (Math.max(sz.y, sz.z) > MAX_CROSS) {
      shakeFlap();
      toast(`${ITEM_TYPES[item.userData.type].name} quá to, không lọt lỗ Ø11 cm – hãy bỏ vào khay nạp`, 'warning');
      if (!fromHand) T.hand.push(item);
      T.notify();
      return false;
    }
    const i = T.hand.indexOf(item);
    if (i >= 0) T.hand.splice(i, 1);
    st.busy = true;
    st.sawProcessing = false;
    T.notify();

    // Đường đi trong hệ tọa độ trạm (interior.group không có phép biến đổi)
    const g = interior.group;
    g.add(item);
    item.rotation.set(0, Math.PI / 2, 0);   // trục dài theo chiều sâu (đút nằm ngang vào lỗ)
    item.position.set(S.x, S.y, D.FRONT + 0.32);
    item.userData.onClick = null;

    // điểm đáp trên mặt phẳng quét (sát mép sau, ngay dưới tấm hắt)
    const fx = sz.z, fz = sz.x;
    const lx = THREE.MathUtils.clamp(S.x, -PLATE.w / 2 + fx / 2 + 0.02, PLATE.w / 2 - fx / 2 - 0.02);
    const lz = -PLATE.d / 2 + fz / 2 + 0.02;
    const land = new THREE.Vector3(lx, sz.y / 2, lz).add(plate.position);

    const tl = gsap().timeline();
    tl.to(item.position, { z: D.FRONT - 0.03, duration: 0.5, ease: 'power2.out' })                 // tay đẩy vào lỗ
      .to(item.position, { z: S.back, duration: 0.55, ease: 'power1.in' })                          // trượt trong ống ngang
      .to(item.rotation, { z: Math.PI / 2, duration: 0.22, ease: 'power1.in' }, '-=0.12')           // lật đứng ở khuỷu
      .to(item.position, { y: SLOT_OUTLET_Y - 0.03 + fz * 0.15, duration: 0.38, ease: 'power2.in' }) // rơi trong ống đứng
      .to(item.position, { x: land.x, y: land.y, z: land.z, duration: 0.45, ease: 'bounce.out' })   // trượt qua tấm hắt
      .to(item.rotation, { z: 0, duration: 0.3, ease: 'power2.out' }, '<');
    tl.then(() => {
      // nằm trên mặt phẳng quét -> thuộc về mặt phẳng (để rung / nghiêng cùng)
      plate.add(item);
      item.position.copy(plate.worldToLocal(item.getWorldPosition(new THREE.Vector3())));
      item.rotation.set(0, Math.PI / 2, 0);
      item.position.y = sz.y / 2;
      item.userData.fp = { fx, fz, h: sz.y };
      item.userData.top = sz.y;
      item.userData.stacked = false;
      item.userData.overlapped = false;
      T.plate = [item];
      T.notify();
      // cảm biến hồng ngoại cuối máng
      bridge.socket.emit('slot_item', {}, async (res) => {
        if (res?.ok) return;
        // back-end không nhận (vừa bận) -> trả vật ra ngăn dưới
        toast('Máy đang bận, vật đã được trả về ngăn dưới', 'warning');
        await bridge.run('tilt_plate', { target: 'return' });
        st.busy = false;
      });
    });
    return true;
  };

  // Bấm vào lỗ trên trạm: đút vật đầu tiên đang cầm
  p.slotFront.userData.action = 'slot';
  p.slotFront.userData.hint = () => (T.hand.length
    ? `Bỏ vào lỗ: ${ITEM_TYPES[T.hand[0].userData.type].name}` : 'Lỗ bỏ từng chai/lon (chọn rác ở bảng bên trái)');
  p.slotFront.userData.onClick = () => {
    if (T.hand.length) T.insertSlot(T.hand[0]);
    else { T.setTarget('slot'); toast('Chọn chai/lon ở bảng bên trái để bỏ vào lỗ', 'info'); }
  };
  (ctx.extraPickables ||= []).push(p.slotFront);
  return st;
}
