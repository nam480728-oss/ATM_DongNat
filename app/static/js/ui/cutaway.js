// Chế độ cắt lớp: vỏ trạm trong suốt dần để xem cơ cấu bên trong
const gsap = () => window.gsap;

export function setupCutaway(ctx) {
  const targets = [];
  const collect = (obj) => obj.traverse((o) => {
    if (!o.isMesh) return;
    // vật liệu riêng để không ảnh hưởng các bộ phận dùng chung vật liệu
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    targets.push(o);
  });
  collect(ctx.station.shell);
  ['feedCavityLiner', 'returnCavity', 'sign', 'infoPanel', 'rearDoor', 'slotFront', 'slotLabel'].forEach((n) => {
    const o = ctx.station.root.getObjectByName(n);
    if (o) collect(o);
  });

  const mats = () => targets.flatMap((o) => (Array.isArray(o.material) ? o.material : [o.material]));
  const state = { on: false, value: 1 };

  function apply() {
    const v = state.value;
    for (const m of mats()) {
      m.transparent = v < 0.999;
      m.opacity = v;
      m.depthWrite = v > 0.5;
      m.needsUpdate = true;
    }
    for (const o of targets) o.castShadow = v > 0.5;
  }

  ctx.cutaway = {
    get on() { return state.on; },
    set(on) {
      if (on === state.on) return;
      state.on = on;
      gsap().to(state, { value: on ? 0.13 : 1, duration: 0.9, ease: 'power2.inOut', onUpdate: apply });
      ctx.cutawayListeners?.forEach((fn) => fn(on));
    },
    toggle() { this.set(!state.on); },
    /** Chạy fn khi vỏ trạm tạm thời đục hoàn toàn (camera buồng quét chụp như máy thật, không bị chế độ cắt lớp
     *  làm lọt sáng / đổi bóng -> ảnh nền và ảnh quét luôn giống nhau). */
    withOpaque(fn) {
      const v = state.value;
      if (v >= 0.999) return fn();
      state.value = 1; apply();
      try { return fn(); } finally { state.value = v; apply(); }
    },
  };
  return ctx.cutaway;
}

export function mountCutawayButton(container, ctx) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'view-btn cut-btn';
  b.textContent = 'Cắt lớp';
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', () => ctx.cutaway.toggle());
  (ctx.cutawayListeners ||= []).push((on) => {
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
  });
  container.appendChild(b);
}
