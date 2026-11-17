// Dàn dựng góc nhìn khi máy xử lý: tự bật cắt lớp + đưa camera vào nhìn buồng quét,
// xong thì đưa về bảng thao tác để xem kết quả.
import { flyTo } from '../ui/viewButtons.js';

const INSIDE_VIEW = { pos: [0.95, 1.05, 1.25], target: [0, 0.6, 0.05] };

export function setupProcessView(ctx, bridge) {
  let wasProcessing = false;
  let auto = true;
  ctx.processView = { setAuto(v) { auto = v; }, get auto() { return auto; } };

  let slotCut = false;
  bridge.onState((s) => {
    // Vật bỏ qua lỗ: chỉ bật cắt lớp để nhìn vào trong, không kéo camera đi
    const slot = s.state === 'PROCESSING_SLOT';
    if (auto && slot && !slotCut && !ctx.cutaway.on) { slotCut = true; ctx.cutaway.set(true); }
    if (slotCut && !slot) {
      slotCut = false;
      setTimeout(() => { if (!ctx.serverState?.processing) ctx.cutaway.set(false); }, 1600);
    }
    const proc = s.processing && !slot;
    if (!auto) { wasProcessing = proc; return; }
    if (proc && !wasProcessing) {
      ctx.cutaway.set(true);
      flyTo(ctx.camera, ctx.controls, INSIDE_VIEW, 1.2);
    }
    if (!proc && wasProcessing) {
      const rejected = s.last_result && s.last_result.status !== 'accepted' && s.last_result.status !== 'empty';
      setTimeout(() => {
        ctx.cutaway.set(false);
        flyTo(ctx.camera, ctx.controls, 'panel', 1.2);
      }, rejected ? 1500 : 900);
    }
    wasProcessing = proc;
  });
}
