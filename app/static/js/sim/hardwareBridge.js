// Cầu nối "phần cứng ảo" <-> back-end.
// Scene 3D gửi sự kiện cảm biến, nhận lệnh cơ cấu chấp hành (actuator) và báo xong (ack).
export function createBridge(ctx) {
  const socket = window.io({ transports: ['websocket', 'polling'] });
  const handlers = {};
  const stateListeners = [];
  const messageListeners = [];
  const resultListeners = [];

  const bridge = {
    socket,
    /** Đăng ký hàm xử lý lệnh actuator. Hàm có thể async; giá trị trả về gửi kèm ack. */
    on(cmd, fn) { handlers[cmd] = fn; },
    /** Chạy trực tiếp 1 lệnh cơ cấu (dùng cho panel Dev / kiểm thử) */
    run(cmd, args = {}) { return handlers[cmd]?.(args); },
    onState(fn) { stateListeners.push(fn); if (ctx.serverState) fn(ctx.serverState); },
    onMessage(fn) { messageListeners.push(fn); },
    onResult(fn) { resultListeners.push(fn); },
    sensor(name, value) { socket.emit('sensor', { name, value }); },
    pay() { return new Promise((res) => socket.emit('pay_button', {}, res)); },
    ui(action, extra = {}) { return new Promise((res) => socket.emit('ui', { action, ...extra }, res)); },
    /** Gửi toàn bộ trạng thái cảm biến vật lý hiện tại (khi mới kết nối). */
    syncSensors: () => {},
  };

  socket.on('connect', () => {
    socket.emit('join', { role: 'sim' }, (res) => {
      if (res?.state) applyState(res.state);
      bridge.syncSensors();
    });
  });

  function applyState(s) {
    ctx.serverState = s;
    for (const fn of stateListeners) fn(s);
  }
  socket.on('state', applyState);
  socket.on('screen:message', (m) => messageListeners.forEach((fn) => fn(m)));
  socket.on('result', (r) => resultListeners.forEach((fn) => fn(r)));

  socket.on('actuator', async (msg) => {
    const h = handlers[msg.cmd];
    let data = {};
    try {
      data = (h ? await h(msg.args || {}) : {}) || {};
      if (typeof data !== 'object' || data.constructor !== Object) data = {}; // chỉ gửi dữ liệu thuần
    } catch (e) {
      console.error('actuator', msg.cmd, e);
      data = { error: String(e?.message || e) };
    }
    if (msg.cmd !== 'set_led') socket.emit('sim:ack', { id: msg.id, data });
  });

  return bridge;
}
