// Cửa sau + xe thùng chứa chai | lon | khác (thao tác của nhân viên thu gom): mở cửa sau, kéo xe ra đổ, đẩy vào, đóng cửa.
// Cảm biến: rear_door_closed, storage_bin_in. Back-end tự reset bộ đếm kho khi thùng được đẩy vào lại.
import { D } from './dims.js';
import { REAR_OPEN_ANGLE } from './rearDoor.js';
import { toast } from '../ui/toast.js';

const gsap = () => window.gsap;

export function setupRear(ctx, bridge, interior) {
  const door = ctx.parts.rearDoor;
  const bin = interior.cart;
  const st = { open: false, binOut: false, moving: { door: false, bin: false }, emptiedLocal: false };
  ctx.rear = st;
  const S = () => ctx.serverState || {};

  const prevSync = bridge.syncSensors;
  bridge.syncSensors = () => {
    prevSync();
    bridge.sensor('rear_door_closed', !st.open && !st.moving.door);
    bridge.sensor('storage_bin_in', !st.binOut && !st.moving.bin);
  };

  st.toggleDoor = function toggleDoor() {
    if (st.moving.door) return false;
    if (!st.open) {
      if (S().processing || S().sorter?.running || S().sorter?.belt_busy) { toast('Máy đang xử lý, chờ xong rồi mới mở cửa sau', 'warning'); return false; }
      st.moving.door = true;
      st.open = true;
      bridge.sensor('rear_door_closed', false);
      gsap().to(door.rotation, { y: REAR_OPEN_ANGLE, duration: 1.0, ease: 'power2.out', onComplete: () => { st.moving.door = false; } });
      return true;
    }
    if (st.binOut || st.moving.bin) { toast('Hãy đẩy thùng chứa vào trước khi đóng cửa sau', 'warning'); return false; }
    st.moving.door = true;
    gsap().to(door.rotation, {
      y: 0, duration: 0.9, ease: 'power2.inOut',
      onComplete: () => { st.moving.door = false; st.open = false; bridge.sensor('rear_door_closed', true); },
    });
    return true;
  };

  st.toggleBin = function toggleBin() {
    if (st.moving.bin) return false;
    if (!st.open || st.moving.door) { toast('Hãy mở cửa sau trước', 'warning'); return false; }
    st.moving.bin = true;
    if (!st.binOut) {
      st.binOut = true;
      bridge.sensor('storage_bin_in', false);
      ctx.trash?.freezeBins();            // rác đang nằm trong thùng đi theo xe
      gsap().to(bin.position, {
        z: -D.REAR.binTravel, duration: 1.1, ease: 'power2.out',
        onComplete: () => {
          st.moving.bin = false;
          // mô phỏng nhân viên đổ rác trong 3 thùng
          const fills = Object.values(interior.fills).filter((f) => f.scale.y > 0.001);
          const loose = ctx.trash?.binnedCount() || 0;
          if (loose) setTimeout(() => ctx.trash.clearBins(), 400);     // đổ cả rác đang nằm trong thùng
          if (fills.length || loose) {
            st.emptiedLocal = true;
            if (!fills.length) toast('Đã đổ xe thùng – đẩy xe vào và đóng cửa sau', 'info');
            fills.forEach((fill, i) => gsap().to(fill.scale, {
              y: 0.0001, duration: 0.9, delay: 0.4, ease: 'power2.in',
              onUpdate: () => { fill.position.y = fill.userData.base.y1 + fill.scale.y / 2 + 0.008; },
              onComplete: i ? undefined : () => toast('Đã đổ xe thùng – đẩy xe vào và đóng cửa sau', 'info'),
            }));
          }
        },
      });
    } else {
      gsap().to(bin.position, {
        z: 0, duration: 1.0, ease: 'power2.inOut',
        onComplete: () => { st.moving.bin = false; st.binOut = false; bridge.sensor('storage_bin_in', true); },
      });
    }
    return true;
  };

  door.userData.action = 'rearDoor';
  door.userData.hint = () => (st.open ? 'Đóng cửa sau' : 'Mở cửa sau (nhân viên thu gom – có chìa)');
  door.userData.onClick = () => st.toggleDoor();
  bin.userData.action = 'bin';
  bin.userData.hint = () => (st.binOut ? 'Đẩy xe thùng chứa vào' : 'Kéo xe thùng chứa (chai | lon | khác) ra để đổ');
  bin.userData.onClick = () => st.toggleBin();
  (ctx.extraPickables ||= []).push(door, bin);

  return st;
}
