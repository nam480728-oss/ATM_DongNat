// Kích thước thật của trạm (đơn vị: mét). Gốc tọa độ = tâm đáy trạm, mặt trước hướng +Z.
export const D = {
  W: 0.90,          // rộng
  DEPTH: 0.75,      // sâu
  PLINTH: 0.05,     // bệ
  TOP: 1.85,        // đỉnh thân máy
  T: 0.02,          // độ dày tấm vỏ
  get FRONT() { return this.DEPTH / 2; },

  // Cửa nạp (85–120 cm), mở ngang, bản lề trái
  DOOR: { x1: -0.30, x2: 0.30, y1: 0.85, y2: 1.20 },
  // Khay nạp: rộng 55 × sâu 45 × cao 10 cm, kéo ra tối đa 35 cm
  TRAY: { w: 0.55, d: 0.45, h: 0.10, y: 0.87, travel: 0.35 },
  // Ngăn trả rác ở đáy (10–40 cm)
  RETURN: { x1: -0.30, x2: 0.30, y1: 0.10, y2: 0.40, depth: 0.45, travel: 0.35 },
  // Bảng thao tác góc trên phải
  SCREEN: { x: 0.215, y: 1.475, w: 0.30, h: 0.22, tilt: 10 },
  PAY: { x: 0.215, y: 1.295, r: 0.042 },
  // Lỗ bỏ từng chai/lon Ø11 cm: phía trên cửa, cùng hàng với nút TÍNH TIỀN
  SLOT: { x: -0.215, y: 1.295, r: 0.055, back: -0.275 },
  // Tấm hướng dẫn góc trên trái (phía trên lỗ bỏ chai)
  INFO: { x: -0.215, y: 1.51, w: 0.34, h: 0.26 },
  // Cửa sau (nhân viên thu gom) – mở ra là thấy thùng chứa
  REAR: { x1: -0.36, x2: 0.36, y1: 0.07, y2: 0.53, binTravel: 0.30 },
  // Bảng hiệu
  SIGN: { y1: 1.66, y2: 1.84 },
  // Thanh đèn trạng thái
  STATUS: { y: 0.70, w: 0.60, h: 0.025 },
};
