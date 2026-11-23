// Dàn dựng góc nhìn khi máy làm việc (tắt được ở panel Dev):
//   quét khay -> nhìn vào khay (bật cắt vách); có rác lạ -> nhìn cửa đang bung hé;
//   phân loại -> nhìn phễu + tay gắp + băng chuyền; xong -> về màn hình.
import { flyTo } from '../ui/viewButtons.js';

const INTAKE_VIEW = { pos: [1.05, 1.85, 1.55], target: [0, 1.2, 0.35] };
const SORTER_VIEW = { pos: [-1.95, 1.95, 1.65], target: [-0.2, 0.95, 0.3] };

export function setupProcessView(ctx, bridge) {
  let auto = true;
  ctx.processView = { setAuto(v) { auto = v; }, get auto() { return auto; } };
  let prev = {};
  let slotCut = false;
  bridge.onState((s) => {
    const intake = s.processing;
    const sorting = !!s.sorter?.running;
    const wasIntake = prev.processing, wasSorting = !!prev.sorter?.running;
    const alarmNow = s.state === 'ALARM' && prev.state !== 'ALARM';
    prev = s;
    // điều khiển nhân vật đang đi lại (không đứng dùng trạm): không giật camera đi chỗ khác
    if (!auto || (ctx.player && !ctx.player.atStation)) return;
    if (intake && !wasIntake) {
      ctx.cutaway.set(true);
      flyTo(ctx.camera, ctx.controls, INTAKE_VIEW, 1.1);
    } else if (alarmNow) {
      ctx.cutaway.set(false);
      flyTo(ctx.camera, ctx.controls, 'door', 1.0);
    } else if (sorting && !wasSorting && s.state !== 'ALARM') {
      ctx.cutaway.set(true);
      setTimeout(() => flyTo(ctx.camera, ctx.controls, SORTER_VIEW, 1.4), 900);
    } else if (!sorting && wasSorting && !s.processing && s.state !== 'ALARM') {
      setTimeout(() => {
        if (ctx.serverState?.sorter?.running || ctx.serverState?.processing) return;
        ctx.cutaway.set(false);
        flyTo(ctx.camera, ctx.controls, ctx.serverState?.user ? 'panel' : 'overview', 1.2);
      }, 1200);
    }
    // Vật bỏ qua lỗ từ thiện: chỉ bật cắt vách để nhìn băng chuyền, không kéo camera đi
    const slot = !!s.sorter?.belt_busy;
    if (slot && !slotCut && !ctx.cutaway.on) { slotCut = true; ctx.cutaway.set(true); }
    if (slotCut && !slot) {
      slotCut = false;
      setTimeout(() => { if (!ctx.serverState?.sorter?.running && !ctx.serverState?.processing) ctx.cutaway.set(false); }, 1500);
    }
  });
}
