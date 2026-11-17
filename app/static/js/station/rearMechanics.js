// Cửa sau + thùng chứa (thao tác của nhân viên thu gom): mở cửa sau, kéo thùng ra đổ, đẩy vào, đóng cửa.
// Cảm biến: rear_door_closed, storage_bin_in. Back-end tự reset bộ đếm kho khi thùng được đẩy vào lại.
import { D } from './dims.js';
import { REAR_OPEN_ANGLE } from './rearDoor.js';
import { setStorageLevel } from './interior.js';
import { toast } from '../ui/toast.js';

const gsap = () => window.gsap;

export function setupRear(ctx, bridge, interior) {
  const door = ctx.parts.rearDoor;
  const bin = interior.bin;
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
      if (S().processing) { toast('Máy đang xử lý, chờ xong rồi mới mở cửa sau', 'warning'); return false; }
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
      gsap().to(bin.position, {
        z: -D.REAR.binTravel, duration: 1.1, ease: 'power2.out',
        onComplete: () => {
          st.moving.bin = false;
          // mô phỏng nhân viên đổ rác trong thùng
          const fill = interior.fill;
          if (fill.scale.y > 0.001) {
            st.emptiedLocal = true;
            gsap().to(fill.scale, {
              y: 0.0001, duration: 0.9, delay: 0.4, ease: 'power2.in',
              onUpdate: () => { fill.position.y = interior.fillBaseY + fill.scale.y / 2 + 0.008; },
              onComplete: () => toast('Đã đổ thùng chứa – đẩy thùng vào và đóng cửa sau', 'info'),
            });
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
  bin.userData.hint = () => (st.binOut ? 'Đẩy thùng chứa vào' : 'Kéo thùng chứa ra để đổ');
  bin.userData.onClick = () => st.toggleBin();
  (ctx.extraPickables ||= []).push(door, bin);

  // Mức đầy thùng: đã đổ cục bộ thì giữ trống tới khi back-end reset
  ctx.storageLevel = (s) => {
    if (!s?.station) return;
    if (st.emptiedLocal) {
      if (s.station.storage_count === 0) st.emptiedLocal = false;
      else return;
    }
    setStorageLevel(interior.fill, s.station.storage_count / s.station.storage_capacity);
  };
  return st;
}
