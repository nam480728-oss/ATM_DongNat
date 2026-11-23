// Lỗ từ thiện: đút 1 chai/lon vào lỗ (không cần đăng nhập, không tính tiền). Ống bên trong CHÚC XUỐNG nên vật
// tự trượt xuống miệng phễu rồi rơi xuống băng chuyền (vật lý thật). Cuối ống có cảm biến hồng ngoại -> báo 'slot_item';
// back-end chờ camera băng chuyền thấy vật rồi bật thanh gạt đúng loại.
import * as THREE from 'three';
import { createItem, ITEM_TYPES } from './itemFactory.js';
import { D } from '../station/dims.js';
import { SLOT_FLAP_OPEN, slotPath } from '../station/slot.js';
import { COLORS } from '../station/materials.js';
import { toast } from '../ui/toast.js';

const gsap = () => window.gsap;
const MAX_CROSS = D.SLOT.r * 2 - 0.006; // tiết diện tối đa lọt lỗ

export function setupSlot(ctx, bridge, interior) {
  const T = ctx.trash;
  const P = ctx.physics;
  const p = ctx.parts;
  const S = D.SLOT;
  const st = { open: false, busy: false };
  ctx.slot = st;
  const ledMat = p.slotLed.material;
  const green = new THREE.Color(0x22c55e), red = new THREE.Color(COLORS.red);

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
  bridge.onState((s) => { if (!!s.slot_open !== st.open && !st.busy) setGate(!!s.slot_open); });
  bridge.socket.on('slot:result', () => { st.busy = false; });

  function closedReason() {
    const s = ctx.serverState || {};
    if (s.sorter?.running) return 'Máy đang phân loại mẻ khác, chờ chút rồi bỏ tiếp';
    if (s.sorter?.belt_busy) return 'Đang xử lý vật trước, chờ chút rồi bỏ tiếp';
    if (s.station?.is_full) return 'Trạm đã đầy, không nhận thêm';
    if (s.maintenance) return 'Trạm đang thu gom / bảo trì';
    if (s.detector_error) return 'Bộ nhận diện chưa sẵn sàng';
    return 'Lỗ từ thiện đang đóng';
  }
  const shakeFlap = () => gsap().fromTo(p.slotFront.position, { x: S.x }, { x: S.x + 0.002, duration: 0.05, yoyo: true, repeat: 3 });

  T.insertSlot = function insertSlot(itemOrType) {
    if (st.busy) { toast('Đang xử lý vật trước, chờ chút rồi bỏ tiếp', 'warning'); return false; }
    if (!st.open) { shakeFlap(); toast(closedReason(), 'warning'); return false; }
    const fromHand = typeof itemOrType !== 'string';
    const item = fromHand ? itemOrType : createItem(itemOrType);
    const sz = item.userData.size;
    if (Math.max(sz.y, sz.z) > MAX_CROSS) {
      shakeFlap();
      toast(`${ITEM_TYPES[item.userData.type].name} quá to, không lọt lỗ Ø11 cm`, 'warning');
      if (!fromHand) T.hand.push(item);
      T.notify();
      return false;
    }
    const i = T.hand.indexOf(item);
    if (i >= 0) T.hand.splice(i, 1);
    st.busy = true;
    T.notify();

    const g = interior.group;
    const { a, b, dir } = slotPath();
    g.add(item);
    // trục dài của vật nằm dọc theo ống (đút đầu vào trước)
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
    item.quaternion.copy(q);
    item.position.set(S.x, S.y + 0.02, D.FRONT + 0.3);
    item.userData.onClick = null;
    const end = b.clone();                         // tâm vật ra tới miệng ống = ngay trên lòng phễu
    gsap().timeline()
      .to(item.position, { x: a.x, y: a.y, z: a.z, duration: 0.45, ease: 'power2.out' })        // tay đút vào lỗ
      .to(item.position, { x: end.x, y: end.y, z: end.z, duration: 0.55, ease: 'power2.in' })    // trượt xuống ống dốc
      .then(() => {
        // ra khỏi miệng ống: rơi vào phễu nón -> lọt xuống băng chuyền (vật lý thật)
        P.addItem(item, { linvel: { x: dir.x * 0.8, y: dir.y * 0.8, z: dir.z * 0.8 } });
        T.intoFunnel(item);                         // server: camera băng chuyền canh vật rơi xuống (kẹt -> mở dần phễu)
        T.notify();
        const report = () => bridge.socket.emit('slot_item', {}, (res) => { if (!res?.ok) setTimeout(report, 1500); });
        report();
      });
    return true;
  };

  p.slotFront.userData.action = 'slot';
  p.slotFront.userData.hint = () => (T.hand.length
    ? `Bỏ vào lỗ từ thiện: ${ITEM_TYPES[T.hand[0].userData.type].name}` : 'Lỗ từ thiện – bỏ chai/lon, không tính tiền');
  p.slotFront.userData.onClick = () => {
    if (T.hand.length) T.insertSlot(T.hand[0]);
    else { T.setTarget('slot'); toast('Chọn chai / lon ở bảng bên trái để bỏ vào lỗ từ thiện', 'info'); }
  };
  (ctx.extraPickables ||= []).push(p.slotFront);
  return st;
}
