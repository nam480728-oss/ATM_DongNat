// Kích thước thật của trạm (đơn vị: mét). Gốc tọa độ = tâm đáy trạm, mặt trước hướng +Z.
// Trạm cỡ 1 nhà vệ sinh công cộng gọn (1,6 × 1,4 × 2,4 m), 2 thùng rác mini gắn 2 bên hông.
export const D = {
  W: 1.60,          // rộng thân trạm
  DEPTH: 1.40,      // sâu
  PLINTH: 0.06,     // bệ
  TOP: 2.40,        // đỉnh thân máy
  T: 0.025,         // độ dày tấm vỏ
  get FRONT() { return this.DEPTH / 2; },

  // Cửa khoang nạp: ngang ngực người lớn (110–148 cm), mở ngang, bản lề trái
  DOOR: { x1: -0.38, x2: 0.38, y1: 1.10, y2: 1.48 },
  // Khay ngăn kéo (cũng là khay rung + khay phân loại): mặt khay ở y, rút ra phía trước travel mét
  // Khay là hộp KÍN 2 bên + mặt sau (cao tới mép trên ô cửa): rút ra thì mặt sau khay bịt kín ô cửa, không thò tay vào máy được.
  // Vách trái là cửa lật (bản lề ở mặt khay): chỉ lật xuống khi khay đã vào hẳn + cửa khóa -> mép khay khớp miệng phễu.
  TRAY: { x: 0, y: 1.20, z1: 0.15, z2: 0.655, w: 0.74, wall: 0.27, travel: 0.40 },
  // Màn hình cảm ứng (bên phải cửa)
  SCREEN: { x: 0.60, y: 1.40, w: 0.30, h: 0.22, tilt: 10 },
  // Lỗ từ thiện Ø11 cm (bên trái cửa): ống chúc xuống đổ thẳng vào miệng phễu -> cùng đường xuống băng chuyền
  SLOT: { x: -0.64, y: 1.34, r: 0.055, outlet: [-0.555, 1.245, 0.44] },
  // Tấm hướng dẫn (phía trên lỗ từ thiện)
  INFO: { x: -0.58, y: 1.68, w: 0.34, h: 0.26 },
  // Cửa sau (nhân viên thu gom) – mở ra là thấy xe thùng chứa (chai | lon | khác)
  REAR: { x1: -0.24, x2: 0.77, y1: 0.08, y2: 0.72, binTravel: 0.62 },
  // Bảng hiệu
  SIGN: { y1: 2.06, y2: 2.34 },
  // Thanh đèn trạng thái (dưới cửa)
  STATUS: { y: 1.03, w: 0.76, h: 0.025 },

  // ---- Bên trong ----
  // Phễu hình nón ngay mép trái khay: miệng cố định, thân nón gồm các cánh loe rộng được (chai nằm ngang lật xuống)
  // Phễu hình nón sát mép trái khay (mép miệng chạm mép khay, có vách che kín khe): miệng cố định, thân nón gồm các cánh.
  // Bình thường cổ hẹp; chỉ khi camera băng chuyền 10 s không thấy vật mới rơi xuống (kẹt) thì cánh loe dần tới rNeckOpen.
  FUNNEL: { x: -0.545, z: 0.405, mouth: 1.185, rMouth: 0.16, neck: 0.92, rNeck: 0.05, rNeckOpen: 0.13 },
  // Giàn XY của tay gắp (ray phía trên khay), vị trí đỗ khi camera khay chụp
  GANTRY: { y: 1.72, park: 0.62 },
  // Camera khay (nhìn thẳng xuống)
  CAM_Y: 1.98,
  // Băng chuyền chạy theo +X dưới phễu (cổ phễu cao hơn băng 40 cm > chai dài nhất -> vật rơi hẳn xuống băng) (PHẢI trùng app/config.py: BELT_SPEED, BELT_CAMERA_X, BELT_PUSHERS, BELT_END_X)
  // endX = tấm gạt chéo cuối băng (vật 'khác' trượt theo tấm gạt vào thùng 'khác')
  BELT: { y: 0.52, z: 0.405, w: 0.24, x1: -0.72, x2: 0.76, speed: 0.30, camX: -0.30,
    pushers: { bottle: 0.0, can: 0.32 }, endX: 0.62 },
  // Xe thùng chứa ngay cạnh băng chuyền: miệng 3 thùng bằng mặt băng, sát mép băng -> thanh gạt đẩy thẳng vào thùng
  BINS: { y1: 0.09, y2: 0.515, z1: -0.62, z2: 0.282,
    bottle: [-0.16, 0.16], can: [0.16, 0.48], other: [0.48, 0.775] },

  // ---- 2 thùng rác mini ÂM vào 2 vách hông (mặt ngoài phẳng với vỏ): w = sâu vào trong, d = rộng theo Z ----
  PUBLIC: { w: 0.26, d: 0.32, h: 0.44, y: 0.62, z: -0.05, flapH: 0.12 },
};

/** Tâm X của thùng mini bên 'left' | 'right' (âm trong vách hông) */
export const publicX = (side) => (side === 'left' ? -1 : 1) * (D.W / 2 - D.PUBLIC.w / 2 - 0.004);
