// Tối ưu vẽ cơ cấu bên trong trạm (hơn 170 mesh):
//  * Vỏ trạm kín + đục: phần dưới ô cửa khoang nạp (băng chuyền, thanh gạt, xe thùng, tủ điện...) không thể thấy từ ngoài
//    -> ẩn đi, chỉ hiện khi bật cắt vách / mở cửa sau / camera ở trong thân máy / camera buồng quét chụp.
//  * Bóng đổ của cơ cấu bên trong chỉ có ý nghĩa khi vỏ trong suốt (cắt vách); vỏ đục thì nắng không lọt vào
//    -> tắt đổ bóng (bớt cả trăm lệnh vẽ trong lượt bóng đổ).
// Rác (vật lý) không nằm trong danh sách này nên luôn hiện / đổ bóng bình thường.
import * as THREE from 'three';
import { D } from './dims.js';

export function setupInteriorCull(ctx) {
  const box = new THREE.Box3();
  const low = [], casters = [];
  ctx.interior.group.updateWorldMatrix(true, true);
  ctx.interior.group.traverse((o) => {
    if (!o.isMesh) return;
    if (o.castShadow) casters.push(o);
    box.setFromObject(o);
    if (box.max.y < D.DOOR.y1 - 0.05) low.push(o);
  });
  let showLow = true, shadows = true, forced = 0;
  const setLow = (v) => { if (v !== showLow) { showLow = v; for (const o of low) o.visible = v; } };
  const setShadows = (v) => { if (v !== shadows) { shadows = v; for (const o of casters) o.castShadow = v; } };

  const cam = ctx.camera.position;
  ctx.onFrame.push(() => {
    if (forced) return;
    const cut = !!ctx.cutaway?.on || (ctx.cutaway?.value ?? 1) < 0.999;
    const inside = Math.abs(cam.x) < D.W / 2 + 0.05 && Math.abs(cam.z) < D.DEPTH / 2 + 0.05 && cam.y < D.TOP;
    const rearOpen = ctx.rear?.open || ctx.rear?.binOut || ctx.rear?.moving?.door || ctx.rear?.moving?.bin;
    setLow(cut || inside || rearOpen);
    setShadows(cut || rearOpen);
  });

  /** Chạy fn khi mọi cơ cấu đều hiện (camera buồng quét / camera giám sát chụp ảnh) */
  ctx.interiorCull = {
    withAll(fn) {
      forced++;
      const prev = showLow;
      setLow(true);
      try { return fn(); } finally { forced--; setLow(prev); }
    },
    stats: () => ({ low: low.length, casters: casters.length, showLow, shadows }),
  };
  return ctx.interiorCull;
}
