# PLAN – TRẠM "ATM ĐỒNG NÁT" (Mô phỏng 3D + Back-end Flask)

> Trạng thái: **ĐÃ HOÀN THÀNH G1–G7 + G8 (bổ sung)** (17/11/2026). Toàn bộ kịch bản nghiệm thu ở mục 12 và 14 đã chạy đạt. Hướng dẫn chạy xem `README.md`.
> Ngày lập: 17/11/2026

---

## 0. Tóm tắt các quyết định đã chốt

| # | Hạng mục | Quyết định |
|---|----------|-----------|
| 1 | Công nghệ 3D | **Three.js** (WebGL), chọn theo tiêu chí đẹp nhất. Màn hình cảm ứng trên máy là HTML thật nhúng vào 3D (CSS3DRenderer) |
| 2 | Định hướng | Hiện tại là mô phỏng 3D, sau này làm phần cứng thật ⇒ thao tác phải giống thực tế, back-end có **lớp trừu tượng phần cứng (HAL)** |
| 3 | AI | Giai đoạn này **giả lập kết quả nhận diện**, nhưng thiết kế sẵn interface để cắm model thật |
| 4 | Model | Anh/chị tự train, plan chỉ chuẩn bị chỗ cắm (`YoloDetector`) |
| 5 | Giá | Chai nhựa **200đ**, lon nhôm **300đ**, không phân biệt kích thước |
| 6 | Thanh toán | Mô phỏng: cộng số dư và ghi lịch sử giao dịch |
| 7 | Tài khoản | Tên + số tài khoản. Trùng tên thì hiển thị `Tên (*1234)` |
| 8 | Bảng thao tác | Màn hình cảm ứng (bàn phím ảo) + nút vật lý **TÍNH TIỀN** |
| 9 | Màn hình | Dùng chung 1 màn hình ở góc trên bên phải |
| 10 | Thùng trả rác | Ngăn kéo ở đáy máy, kéo ra như hộc tủ quần áo |
| 11 | Phong cách | Xanh lá và trắng, logo tái chế, tên "ATM Đồng Nát" |
| 12 | Camera | Xoay và zoom tự do quanh trạm |
| 13 | Bên trong máy | Có chế độ cắt lớp/trong suốt để xem toàn bộ quy trình |
| 14 | Thùng trống | Báo "Không phát hiện rác" |
| 15 | Quá tải | Khay nạp cạn và có giới hạn **vật lý**: đổ cao quá miệng khay thì không đẩy khay vào được |
| 16 | Vật đè nhau | Rung lại tối đa 2 lần, vẫn lỗi thì trả cả đống |
| 17 | Ràng buộc | Cửa phải đóng thì nút TÍNH TIỀN mới có hiệu lực (có thông báo). Trạm đầy thì hiện lên màn hình. Không thao tác **2 phút** thì tự đăng xuất |
| 18 | Admin | Có trang quản trị |
| 19 | Ngôn ngữ | Tiếng Việt |

---

## 1. Kiến trúc tổng thể

```
┌───────────────────────── TRÌNH DUYỆT ─────────────────────────┐
│  Scene 3D (Three.js)                                            │
│   ├─ Mô hình trạm (vỏ, cửa, khay nạp, ngăn trả rác, nút)        │
│   ├─ Cơ cấu bên trong (mặt rung, camera, đèn, máng, kho chứa)   │
│   ├─ Camera ảo nhìn từ trên xuống mặt rung → chụp ảnh PNG       │
│   └─ Màn hình cảm ứng = trang HTML thật (CSS3DRenderer)         │
│  Khay "rác trong tay người dùng" (để chọn rác bỏ vào khay nạp) │
└──────────────▲────────────────────────────┬────────────────────┘
               │ Socket.IO (trạng thái,      │ REST + Socket.IO
               │ lệnh cơ cấu chấp hành)      │ (sự kiện cảm biến, ảnh)
┌──────────────┴────────────────────────────▼────────────────────┐
│  BACK-END FLASK (Python)                                        │
│   ├─ StationController: máy trạng thái (nguồn sự thật duy nhất) │
│   ├─ HAL: SimulatedHardware (hiện tại) │ GpioHardware (sau này)  │
│   ├─ Detector: MockDetector (hiện tại) │ YoloDetector (sau này)  │
│   ├─ Services: tính tiền, cắt ảnh rác lỗi (Pillow), timeout     │
│   └─ MySQL atm_db (SQLAlchemy + PyMySQL): users, transactions… │
└─────────────────────────────────────────────────────────────────┘
```

**Nguyên tắc quan trọng để sau này chuyển sang phần cứng:**
- Toàn bộ logic quy trình nằm ở **back-end** (máy trạng thái). Front-end 3D chỉ đóng vai "phần cứng ảo": gửi sự kiện cảm biến (cửa đóng/mở, khay vào/ra, nút bấm) và nhận lệnh cơ cấu (khóa cửa, bật rung, nghiêng mặt phẳng…).
- Khi có phần cứng thật, chỉ thay `SimulatedHardware` bằng `GpioHardware` (Raspberry Pi) và `MockDetector` bằng `YoloDetector`. Máy trạng thái, DB và giao diện màn hình giữ nguyên.
- Giao diện màn hình cảm ứng là một trang web độc lập (`/screen`). Trong bản mô phỏng nó được nhúng vào mô hình 3D, còn trên máy thật thì chạy fullscreen trên màn hình cảm ứng.

---

## 2. Công nghệ

| Lớp | Công nghệ | Lý do |
|-----|-----------|-------|
| 3D | Three.js (ES modules, ghim phiên bản, ví dụ `three@0.160.0`) | Đẹp, nhiều tính năng (đổ bóng, PBR, vật liệu kim loại/kính), cộng đồng lớn |
| Màn hình trong 3D | `CSS3DRenderer` của Three.js | Màn hình là HTML thật, dùng lại được cho phần cứng |
| Hoạt ảnh | GSAP 3 | Chuyển động cơ khí mượt, dễ xâu chuỗi (timeline) |
| Xoay/zoom | `OrbitControls` | Kéo để xoay, cuộn để zoom, có giới hạn góc |
| Mô hình | Dựng bằng code (procedural) từ khối hình học + vật liệu PBR | Không phụ thuộc file Blender, dễ chỉnh kích thước theo thực tế |
| Back-end | Flask 3, Flask-SocketIO, Flask-SQLAlchemy, Pillow | Real-time, ORM đơn giản, cắt ảnh |
| CSDL | **MySQL** (database `atm_db`, quản lý bằng Navicat), driver PyMySQL | Theo môi trường anh/chị đang dùng. Sau này nhiều trạm dùng chung một DB được |
| Build | Không cần Node/Vite. Flask phục vụ file tĩnh, thư viện JS đặt sẵn trong `static/vendor` | Chạy được ngay bằng `python app.py`, cũng chạy được trên Raspberry Pi |

---

## 3. Thiết kế 3D của trạm (kích thước theo tỉ lệ thật)

**Kích thước tổng:** cao 185 cm × rộng 90 cm × sâu 75 cm, đặt trên bệ 5 cm. Hình dáng giống máy bán nước tự động.

### 3.1. Mặt trước (từ trên xuống)

| Vị trí | Thành phần | Chi tiết |
|--------|-----------|---------|
| 165–185 cm | Bảng hiệu | Chữ "ATM ĐỒNG NÁT" + logo tái chế, đèn LED xanh phát sáng |
| 125–160 cm, **góc phải** | **Bảng thao tác** | Màn hình cảm ứng khoảng 10 inch đặt nghiêng 10°. Ngay bên dưới là **nút TÍNH TIỀN** (nút tròn lớn, màu xanh, có viền LED: sáng khi đủ điều kiện bấm, tối khi chưa đủ) |
| 125–160 cm, góc trái | Tấm minh họa | Hình hướng dẫn "Chỉ nhận chai nhựa và lon nhôm", bảng giá 200đ/300đ |
| **85–120 cm (giữa, vừa tầm tay)** | **Cửa nạp rác** | Cửa kính mờ rộng 60 × 35 cm, **mở sang ngang**: bản lề dọc ở cạnh trái, cánh cửa quay ra ngoài khoảng 100° sang trái (không che bảng thao tác bên phải), có nam châm giữ cửa khi mở hết. Tay nắm dọc ở cạnh phải, **khóa điện từ** (đèn đỏ khi khóa, xanh khi mở khóa) |
| Sau cửa nạp | **Khay nạp (thùng rác)** | Rộng 55 × sâu 45 × **cao chỉ 10 cm** (cạn). Chạy trên **ray trượt** và kéo ra tối đa 35 cm, có chặn cuối hành trình nên không rút rời ra được. Có tay cầm phía trước |
| 60–80 cm | Thanh đèn trạng thái | Đèn xanh = sẵn sàng, vàng = đang xử lý, đỏ = lỗi/trạm đầy |
| **10–40 cm (đáy)** | **Ngăn trả rác** | Ngăn kéo rộng 60 cm kiểu hộc tủ quần áo, kéo ra trên ray. Có nhãn "RÁC TRẢ LẠI" và đèn nhấp nháy khi có rác bị trả |

### 3.2. Bên trong (thấy được khi bật chế độ cắt lớp)

```
          [Camera + đèn LED vòng]   ← gắn ở trần buồng quét
                    │
   Khay nạp ──► ┌──────────────────┐
  (nghiêng đổ)  │  MẶT PHẲNG RUNG  │  ← motor rung bên dưới, viền chắn 3 cạnh
                └──────────────────┘
                 nghiêng sau ↙   ↘ nghiêng trước
          ┌──────────────┐     ┌─────────────────┐
          │  KHO CHỨA     │     │ MÁNG TRƯỢT ↓     │
          │ (chai/lon hợp │     │ → NGĂN TRẢ RÁC   │
          │  lệ, phía sau)│     │   (ở đáy máy)    │
          └──────────────┘     └─────────────────┘
```

1. **Cơ cấu đổ của khay nạp:** khay đẩy vào hết hành trình thì cửa khóa lại. Đáy khay lật xuống (hoặc khay nghiêng) để đổ rác xuống mặt phẳng rung.
2. **Mặt phẳng rung:** 70 × 55 cm, nền màu xám đậm tương phản để camera dễ nhận diện. Motor rung đặt bên dưới.
3. **Camera quét:** gắn trên trần buồng, kèm đèn LED vòng. Trong mô phỏng là một camera Three.js riêng nhìn thẳng xuống, render ra ảnh PNG gửi về back-end.
4. **Nghiêng hai chiều:** nghiêng về sau thì rác rơi vào **kho chứa**. Nghiêng về trước thì rác theo **máng trượt** xuống **ngăn trả rác**.
5. **Kho chứa:** thùng lớn phía sau, có cảm biến mức đầy. Mô phỏng sức chứa **300 vật** (cấu hình được).

### 3.3. Vật thể rác (dựng bằng code)

- **Hợp lệ:** chai nhựa (3 kiểu: 500 ml, 1,5 L, chai dẹt), lon nhôm (lon cao, lon lùn), có nhiều màu nhãn khác nhau.
- **Không hợp lệ:** vỏ hộp sữa giấy, túi nilon, cốc nhựa có ống hút, chai thủy tinh, vỏ hộp xốp, giấy vo.

### 3.4. Giao diện ngoài scene 3D (chỉ có ở bản mô phỏng)

- **Thanh "Rác trong tay bạn"** (cạnh trái màn hình web): danh sách vật thể để bấm hoặc kéo thả vào khay nạp. Chỉ thả được khi khay đang kéo ra.
- **Nút góc nhìn nhanh:** Toàn cảnh / Bảng thao tác / Cửa nạp / Ngăn trả rác / Bật-tắt cắt lớp.
- **Panel Dev** (ẩn, bật bằng phím `~`):
  - Ép xảy ra lỗi "vật đè nhau".
  - Ép trạm đầy.
  - Tua nhanh hoạt ảnh.

---

## 4. Quy trình thao tác (giống thực tế)

### 4.1. Trên màn hình cảm ứng

1. **Màn hình chờ:** logo, bảng giá, nút "Bắt đầu".
2. **Chọn người dùng:**
   - Danh sách tên đã lưu (có ô tìm kiếm). Trùng tên thì hiển thị `Tên (*1234)`.
   - Nút "+ Người dùng mới" mở form nhập **Tên** và **Số tài khoản** bằng bàn phím ảo:
     - Bàn phím chữ có gõ Telex tiếng Việt.
     - Bàn phím số cho số tài khoản (6–19 chữ số).
   - Bàn phím máy tính thật cũng dùng được trong bản mô phỏng.
3. Sau khi chọn tên, màn hình hiện: "Xin chào {Tên}. Mời mở cửa và kéo khay ra". Khóa cửa mở, đèn khóa chuyển xanh.

### 4.2. Thao tác vật lý (trong mô phỏng 3D)

4. Bấm (hoặc kéo) tay nắm thì **cửa quay mở sang trái** quanh bản lề dọc.
5. Kéo tay cầm thì **khay nạp trượt ra** theo ray.
6. Bỏ rác vào khay. Các vật nằm trong khay, xếp chồng ngẫu nhiên như đổ thật.
7. **Đẩy khay vào:**
   - Nếu rác **cao quá miệng khay**, khay bị kẹt ở cửa: hoạt ảnh khay khựng lại và màn hình báo "Rác quá nhiều, vui lòng bớt ra".
   - Đây là cơ chế giới hạn vật lý, không phải giới hạn bằng phần mềm.
8. **Đóng cửa.**
9. **Bấm nút TÍNH TIỀN:**
   - Cửa chưa đóng hoặc khay chưa vào hết: màn hình báo "Vui lòng đẩy khay vào và đóng cửa trước khi tính tiền", nút không có tác dụng.
   - Trạm đầy: báo "Trạm đã đầy, vui lòng quay lại sau".

### 4.3. Máy xử lý tự động

```
Khóa cửa → Đổ rác xuống mặt rung → QUÉT SƠ BỘ (đếm số vật)
   ├─ 0 vật  → "Không phát hiện rác" → mở khóa cửa
   ├─ 1 vật  → phân loại ngay (bỏ qua bước rung)
   └─ >1 vật → RUNG (2–3 giây) → QUÉT
                  └─ còn vật đè nhau? → rung lại (tối đa 2 lần) → vẫn lỗi → TRẢ CẢ ĐỐNG
                                                                   ("Không thể quét, vui lòng lấy lại rác")
QUYẾT ĐỊNH:
   ├─ Tất cả là chai/lon → nghiêng về sau → KHO CHỨA
   │     → Tính tiền (chai×200 + lon×300) → "Đã chuyển X đ tới STK ***1234"
   └─ Có ≥1 vật không hợp lệ → nghiêng về trước → NGĂN TRẢ RÁC (trả cả đống)
         → Màn hình hiện ẢNH CẮT của từng vật không hợp lệ
           ("Phát hiện 2 vật không hợp lệ. Vui lòng lấy rác ở ngăn dưới, loại bỏ vật này rồi thử lại")
         → Đèn ngăn trả rác nhấp nháy
Mở khóa cửa → màn hình: "Tiếp tục bỏ rác" | "Kết thúc"
```

10. **Ngăn trả rác:** người dùng kéo ngăn ra, bấm vào rác để lấy về thanh "Rác trong tay", rồi đẩy ngăn vào.
11. **Tự đăng xuất:**
    - Không có thao tác nào trong **2 phút** thì tự về màn hình chờ.
    - 15 giây trước khi đăng xuất, màn hình hiện đếm ngược.
    - Không tính giờ khi máy đang xử lý.
    - Nếu khay nạp hoặc cửa còn mở lúc đăng xuất thì vẫn đăng xuất, và màn hình chờ nhắc đóng cửa.

---

## 5. Máy trạng thái (back-end, `StationController`)

| Trạng thái | Mô tả | Sự kiện cho phép |
|-----------|-------|------------------|
| `IDLE` | Màn hình chờ, cửa khóa | `select_user` |
| `READY` | Đã chọn người dùng, cửa mở khóa | `door_open`, `door_close`, `drawer_out`, `drawer_in`, `press_pay`, `logout` |
| `PROCESSING_TRANSFER` | Khóa cửa, đổ rác xuống mặt rung | (tự chạy) |
| `PROCESSING_PRESCAN` | Quét đếm số vật | (tự chạy) |
| `PROCESSING_VIBRATE` | Rung mặt phẳng | (tự chạy) |
| `PROCESSING_SCAN` | Quét phân loại | (tự chạy) |
| `ACCEPTING` | Nghiêng vào kho, cộng tiền | (tự chạy) |
| `REJECTING` | Nghiêng ra ngăn trả, hiện ảnh cắt | (tự chạy) |
| `RESULT` | Hiện kết quả | `continue`, `logout` |
| `FULL` | Trạm đầy | chỉ admin mới gỡ được |

- **Cảm biến (HAL input):**
  - `door_closed`, `door_locked`
  - `feed_drawer_in`, `feed_drawer_jammed`
  - `return_drawer_in`
  - `pay_button`
  - `storage_level`
- **Cơ cấu chấp hành (HAL output):**
  - `lock_door(bool)`
  - `dump_feed_tray()`
  - `vibrate(seconds)`
  - `capture_image()`
  - `tilt_plate('storage' | 'return')`
  - `set_led(...)`

---

## 6. AI / Nhận diện (thiết kế sẵn để cắm model)

```python
class Detection:  label: str  # 'bottle' | 'can' | 'other'
                  confidence: float
                  bbox: (x1, y1, x2, y2)   # pixel trên ảnh chụp
                  overlapped: bool

class Detector(ABC):
    def detect(self, image: PIL.Image) -> list[Detection]: ...
```

- **`MockDetector` (hiện tại):**
  - Front-end gửi ảnh render từ camera ảo, kèm "đáp án" là bbox đã chiếu từ 3D xuống 2D và loại vật.
  - Mock trả kết quả theo đáp án đó, có thể cộng nhiễu độ tin cậy cho giống thật.
- **`YoloDetector` (sau này):**
  - Load file `.pt` hoặc `.onnx` của anh/chị.
  - Ánh xạ tên lớp của model sang `bottle/can/other` qua file `config.py`.
  - Có ngưỡng confidence: vật dưới ngưỡng bị coi là `other` để an toàn.
- **Cắt ảnh rác không hợp lệ:**
  - Pillow cắt theo bbox, chừa thêm lề 10%.
  - Lưu vào `data/crops/`, gửi URL lên màn hình.
- Chọn detector qua cấu hình `DETECTOR = "mock" | "yolo"`.
- **Ảnh chụp mô phỏng giống ảnh camera thật** (nhìn từ trên xuống, có đèn LED). Có thể xuất các ảnh này ra để làm dữ liệu thử nghiệm.

---

## 7. API & Real-time

**REST**

| Method | Endpoint | Chức năng |
|--------|----------|-----------|
| GET | `/` | Trang mô phỏng 3D |
| GET | `/screen` | Giao diện màn hình cảm ứng (nhúng vào 3D, sau này chạy trên máy thật) |
| GET | `/api/users?q=` | Danh sách / tìm người dùng (hiển thị tên + 4 số cuối nếu trùng) |
| POST | `/api/users` | Tạo người dùng `{name, account_number}` (kiểm tra STK là số, 6–19 ký tự, không trùng STK) |
| POST | `/api/scan` | Gửi ảnh + đáp án mô phỏng, trả về danh sách detection |
| GET | `/admin` | Trang quản trị (đăng nhập bằng mật khẩu đặt trong `.env`) |
| GET | `/api/admin/stats` | Tổng số chai/lon, tiền đã trả, dung lượng kho |
| GET | `/api/admin/transactions` | Lịch sử giao dịch (lọc theo người dùng/ngày) |
| POST | `/api/admin/empty-storage` | Làm trống kho, gỡ trạng thái `FULL` |

**Socket.IO**

- Client gửi lên server: sự kiện cảm biến
  - `sensor:door`, `sensor:feed_drawer`, `sensor:return_drawer`, `sensor:pay_button`
  - `ui:select_user`, `ui:logout`, `ui:activity`
- Server gửi xuống client:
  - `state:changed`
  - `actuator:*`: lệnh cho hoạt ảnh 3D
  - `screen:message`
  - `result`

---

## 8. Cơ sở dữ liệu (MySQL – database `atm_db`, quản lý bằng Navicat)

- **Kết nối:** Flask-SQLAlchemy + driver **PyMySQL**. Chuỗi kết nối đặt trong `.env`:
  `DATABASE_URL=mysql+pymysql://<user>:<password>@localhost:3306/atm_db?charset=utf8mb4`
- **Bảng mã:** `utf8mb4` / `utf8mb4_unicode_ci` để lưu tên tiếng Việt có dấu.
- **Tạo bảng:** file `database/schema.sql` (nội dung bên dưới). Anh/chị mở Navicat → chọn `atm_db` → **Query → New Query** → dán vào → **Run**. App **không** tự tạo bảng, chỉ kiểm tra bảng tồn tại khi khởi động và báo lỗi rõ ràng nếu thiếu.
- **Xóa người dùng:** chỉ xóa mềm (`is_active = 0`) để giữ lịch sử giao dịch.
- **Giá lưu trong bảng `settings`:** admin sửa được. Mỗi giao dịch cũng lưu giá tại thời điểm giao dịch, để đổi giá sau này không làm sai lịch sử.

```sql
-- database/schema.sql  –  chạy trên database atm_db
USE atm_db;
SET NAMES utf8mb4;

-- 1. Người dùng
CREATE TABLE IF NOT EXISTS users (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  name            VARCHAR(100)     NOT NULL,
  account_number  VARCHAR(19)      NOT NULL,
  balance         BIGINT UNSIGNED  NOT NULL DEFAULT 0,      -- tổng tiền đã nhận (VNĐ)
  is_active       TINYINT(1)       NOT NULL DEFAULT 1,      -- 0 = đã xóa (xóa mềm)
  created_at      DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at    DATETIME         NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_account_number (account_number),
  KEY idx_users_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Giao dịch (mỗi lần bấm TÍNH TIỀN = 1 dòng)
CREATE TABLE IF NOT EXISTS transactions (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED     NOT NULL,
  bottles        SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  cans           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  price_bottle   INT UNSIGNED     NOT NULL,                 -- giá tại thời điểm giao dịch
  price_can      INT UNSIGNED     NOT NULL,
  amount         INT UNSIGNED     NOT NULL DEFAULT 0,       -- 0 nếu bị trả rác
  status         ENUM('accepted','rejected','empty','scan_failed') NOT NULL,
  scan_attempts  TINYINT UNSIGNED NOT NULL DEFAULT 1,       -- số lần quét (do rung lại)
  image_path     VARCHAR(255)     NULL,                     -- ảnh quét toàn mặt rung
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tx_user_created (user_id, created_at),
  KEY idx_tx_status (status),
  CONSTRAINT fk_tx_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Vật không hợp lệ trong giao dịch bị trả rác (ảnh cắt hiện lên màn hình)
CREATE TABLE IF NOT EXISTS rejected_items (
  id              BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  transaction_id  BIGINT UNSIGNED  NOT NULL,
  label           VARCHAR(50)      NOT NULL,                -- tên lớp model trả về
  confidence      DECIMAL(5,4)     NOT NULL,
  bbox_x1 INT NOT NULL, bbox_y1 INT NOT NULL, bbox_x2 INT NOT NULL, bbox_y2 INT NOT NULL,
  crop_path       VARCHAR(255)     NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ri_tx (transaction_id),
  CONSTRAINT fk_ri_tx FOREIGN KEY (transaction_id) REFERENCES transactions(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Trạng thái trạm (1 dòng duy nhất, sau này nhiều trạm thì thêm dòng)
CREATE TABLE IF NOT EXISTS station (
  id                TINYINT UNSIGNED NOT NULL,
  name              VARCHAR(100)     NOT NULL DEFAULT 'ATM Đồng Nát',
  storage_count     INT UNSIGNED     NOT NULL DEFAULT 0,
  storage_capacity  INT UNSIGNED     NOT NULL DEFAULT 300,
  is_full           TINYINT(1)       NOT NULL DEFAULT 0,
  last_emptied_at   DATETIME         NULL,
  updated_at        DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Cấu hình (giá, timeout...) – admin sửa được
CREATE TABLE IF NOT EXISTS settings (
  `key`       VARCHAR(50)   NOT NULL,
  `value`     VARCHAR(255)  NOT NULL,
  description VARCHAR(255)  NULL,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Dữ liệu khởi tạo
INSERT IGNORE INTO station (id, name, storage_capacity) VALUES (1, 'ATM Đồng Nát', 300);
INSERT IGNORE INTO settings (`key`, `value`, description) VALUES
  ('price_bottle',        '200', 'Giá 1 chai nhựa (VNĐ)'),
  ('price_can',           '300', 'Giá 1 lon nhôm (VNĐ)'),
  ('idle_timeout_sec',    '120', 'Tự đăng xuất khi không thao tác (giây)'),
  ('max_vibrate_retries', '2',   'Số lần rung lại tối đa khi vật đè nhau');
```

---

## 9. Trang Admin

- Đăng nhập bằng mật khẩu.
- Thẻ tổng quan: số chai, số lon, tổng tiền đã trả, % dung lượng kho, số lượt bị trả rác.
- Bảng người dùng: tên, STK (che bớt), số dư, số lượt.
- Bảng giao dịch: xem được ảnh quét và ảnh cắt của rác lỗi.
- Nút "Làm trống kho". Có thể sửa giá chai/lon (lưu vào bảng `settings`).

---

## 10. Cấu trúc thư mục

```
ATM_Dong_Nat/
├─ Plan.md
├─ requirements.txt
├─ .env.example                 # DATABASE_URL (MySQL atm_db), ADMIN_PASSWORD, DETECTOR, MODEL_PATH...
├─ database/
│  └─ schema.sql                # script tạo bảng, chạy trong Navicat
├─ run.py
├─ app/
│  ├─ __init__.py               # create_app, SocketIO
│  ├─ config.py                 # giá, sức chứa, timeout, mapping lớp model
│  ├─ models.py                 # SQLAlchemy
│  ├─ station/
│  │  ├─ controller.py          # máy trạng thái
│  │  ├─ hal.py                 # HardwareInterface, SimulatedHardware, (GpioHardware stub)
│  │  └─ session.py             # phiên người dùng + timeout 2 phút
│  ├─ detection/
│  │  ├─ base.py                # Detection, Detector
│  │  ├─ mock_detector.py
│  │  ├─ yolo_detector.py       # khung sẵn, chờ model
│  │  └─ cropper.py
│  ├─ routes/  (main.py, api.py, admin.py)
│  ├─ sockets.py
│  ├─ templates/ (index.html, screen.html, admin/*.html)
│  └─ static/
│     ├─ vendor/ (three, gsap, socket.io client)
│     ├─ js/
│     │  ├─ main.js             # khởi tạo scene, renderer, controls
│     │  ├─ station/            # body.js, door.js, feedDrawer.js, returnDrawer.js,
│     │  │                      # vibratePlate.js, scanner.js, storage.js, panel.js
│     │  ├─ items/              # bottle.js, can.js, invalidItems.js, itemFactory.js
│     │  ├─ sim/                # hardwareBridge.js (sensor/actuator ↔ socket), snapshot.js
│     │  └─ ui/                 # handTray.js, viewButtons.js, devPanel.js
│     ├─ screen/ (screen.js, keyboard.js [Telex], screen.css)
│     └─ css/
├─ data/  (app.db, scans/, crops/)
└─ tests/ (test_controller.py, test_pricing.py, test_cropper.py, test_api.py)
```

---

## 11. Các giai đoạn thực hiện

| Giai đoạn | Nội dung | Kết quả kiểm tra |
|-----------|---------|------------------|
| **G1. Nền móng** | `database/schema.sql` (anh/chị chạy trong Navicat trên `atm_db`), Flask app kết nối MySQL, API users, Socket.IO, khung máy trạng thái + HAL giả lập, unit test | 5 bảng hiện trong Navicat, `pytest` pass, tạo người dùng qua API thì thấy dòng mới trong bảng `users` |
| **G2. Mô hình 3D tĩnh** | Vỏ trạm, cửa, khay nạp, ngăn trả, bảng thao tác, nút, ánh sáng, vật liệu, OrbitControls, nút góc nhìn | Xoay/zoom quanh trạm đẹp, đúng tỉ lệ |
| **G3. Cơ khí tương tác** | Mở/đóng cửa, kéo/đẩy khay trên ray (có chặn), ngăn trả rác, đèn khóa, đèn nút, kẹt khay khi quá đầy | Thao tác bằng chuột giống thật |
| **G4. Màn hình cảm ứng** | `/screen` + CSS3DRenderer, chọn/tạo người dùng, bàn phím ảo Telex, thông báo, đếm ngược đăng xuất | Toàn bộ luồng chọn tên chạy trên màn hình 3D |
| **G5. Rác & bên trong** | Các mô hình rác, thanh "Rác trong tay", chế độ cắt lớp, mặt rung, camera, kho, máng trượt | Thấy được bên trong máy |
| **G6. Quy trình xử lý** | Nối máy trạng thái ↔ hoạt ảnh: đổ → quét sơ bộ → rung → quét → nhận/trả; chụp ảnh camera ảo, MockDetector, cắt ảnh rác lỗi, tính tiền | Chạy hết các kịch bản ở mục 12 |
| **G7. Admin & hoàn thiện** | Trang admin, trạm đầy, panel Dev, tối ưu hiệu năng, README hướng dẫn chạy và cắm model | Checklist mục 12 đạt 100% |

---

## 12. Kịch bản nghiệm thu

1. Tạo người dùng mới. Người thứ hai cùng tên thì danh sách hiển thị `Nam (*1234)` và `Nam (*5678)`.
2. Bấm TÍNH TIỀN khi cửa đang mở: có thông báo, máy không chạy.
3. Đổ quá nhiều rác: khay kẹt, không đẩy vào được.
4. Khay trống, bấm tính tiền: báo "Không phát hiện rác".
5. 1 chai: không rung, nhận ngay, cộng 200đ.
6. 3 chai + 2 lon: rung, quét, vào kho, cộng 1.200đ.
7. 2 chai + 1 hộp sữa giấy: trả cả đống về ngăn dưới, màn hình hiện ảnh cắt hộp sữa, không cộng tiền.
8. Ép lỗi vật đè nhau (panel Dev): rung lại 2 lần rồi trả cả đống, báo lỗi.
9. Không thao tác 2 phút: đếm ngược rồi tự đăng xuất.
10. Kho đầy: màn hình báo trạm đầy. Admin làm trống kho thì trạm hoạt động lại.
11. Đổi `DETECTOR=yolo` mà chưa có model: báo lỗi rõ ràng, không làm sập server.

---

## 13. Giả định (cần anh/chị xác nhận khi duyệt)

1. ~~Cửa nạp lật lên~~ → **Đã chốt: cửa mở sang ngang**, bản lề bên trái, mở về phía trái.
2. **Khay nạp đổ rác xuống mặt rung bằng cách lật đáy.** Như vậy khay luôn sạch để lần sau dùng tiếp, và tách riêng vùng quét khỏi vùng nạp, giống máy thật.
3. **Trả rác là trả cả đống** (kể cả chai/lon hợp lệ), đúng như yêu cầu. Người dùng loại vật lỗi rồi bỏ lại phần hợp lệ ở lượt sau.
4. **Cho phép bỏ rác nhiều lượt trong một phiên.** Sau mỗi lượt có nút "Tiếp tục" hoặc "Kết thúc".
5. **Người dùng không xóa được tài khoản của mình**, chỉ admin mới xóa được.
6. **Số tài khoản là duy nhất:** một STK chỉ gắn với một tên.
7. **Màn hình chỉ thao tác được khi zoom gần.** Khi ở xa, bấm vào màn hình thì camera tự bay đến góc "Bảng thao tác".


---

## 14. G8 – Bổ sung sau nghiệm thu (17/11/2026)

### 14.1 Chuyển khoản / Từ thiện
- Sau TÍNH TIỀN, màn hình hiện **số tiền** và 2 nút: **Chuyển khoản** (vào STK của người dùng → báo thành công) và **Từ thiện** (tiền vào quỹ từ thiện của trạm → cảm ơn + tổng đã góp).
- Không chọn trong 30 giây (`settings.payout_timeout_sec`) → tự chuyển khoản. Đăng xuất / hết giờ khi còn tiền chờ → tự chuyển khoản.
- Còn tiền chờ thì chưa được "Tiếp tục" hay bấm TÍNH TIỀN lần nữa.
- Admin: thẻ "Đã chuyển khoản", "Quỹ từ thiện", bảng Quỹ từ thiện, cột Đã nhận / Từ thiện, lọc theo hình thức nhận tiền.

### 14.2 Zoom mượt
- Con lăn / touchpad: zoom có quán tính, **zoom về đúng điểm dưới con trỏ** (soi được từng góc), có thể zoom sát 12 cm. Pinch trên cảm ứng giữ nguyên.

### 14.3 Lỗ bỏ từng chai/lon (Ø11 cm)
- Phía trên cửa, cùng hàng nút TÍNH TIỀN; nắp servo + đèn (xanh = mời bỏ, đỏ = tạm ngưng). Vật to hơn lỗ không lọt.
- Đường đi: lỗ → ống ngang → ống đứng → tấm hắt → mặt phẳng quét; cảm biến hồng ngoại cuối máng báo `slot_item`.
- Quét riêng từng vật: hợp lệ → kho; không hợp lệ → ngăn trả rác + ảnh cắt trên màn hình.
- **Chưa chọn tên**: vẫn phân loại, không tính tiền (giao dịch `user_id = NULL`). **Đã chọn tên**: cộng dồn, tính chung ở lần TÍNH TIỀN (khay trống vẫn tính).
- Khay nạp vẫn theo quy trình cũ (phải chọn tên, đóng cửa...). Nắp đóng khi: máy đang xử lý, kho đầy, cửa sau mở, ngăn trả rác mở, chưa có bộ nhận diện.

### 14.4 Cửa sau (nhân viên thu gom)
- Cửa sau khóa bằng chìa, mở ra thấy thùng chứa; kéo thùng ra đổ, đẩy vào → **tự reset bộ đếm kho** (nút "Làm trống kho" ở admin vẫn giữ).
- Cửa sau / thùng chưa vào vị trí → trạm "đang thu gom / bảo trì": không cho chọn tên, không tính tiền, đóng lỗ bỏ chai.

### 14.5 Hiệu ứng quét
- Đèn LED vòng sáng dần → chớp flash ngắn lúc chụp → tắt dần; đèn đỏ nhỏ trên thân camera sáng khi chụp.
- Màn hình hiện **ảnh vừa chụp + khung nhận diện** (xanh hợp lệ / đỏ không hợp lệ / vàng đè nhau).

### 14.6 Thay đổi kỹ thuật
- DB (chạy `python tools/migrate.py`, an toàn khi chạy lại): `users.balance` → `total_received`, thêm `total_donated`; `transactions.user_id` cho phép NULL, thêm `source`, `payout`, `paid_at`; setting `payout_timeout_sec`.
- HAL: cảm biến `rear_door_closed`, `storage_bin_in`, sự kiện `slot_item`, cơ cấu `slot_gate(open)`, đèn `slot`.
- Socket: client gửi `slot_item`, `ui{action:'payout', method}`; server phát `payout`, `slot:result`, `scan:frame`.
- Trạng thái mới `PROCESSING_SLOT`. Test: 44 bài (thêm 15 bài cho G8).

### 14.7 Tinh chỉnh hiệu ứng (17/11/2026)
- **Rung mạnh hơn**: mặt phẳng rung theo 3 trục + lắc nghiêng (motor lệch tâm, có tăng tốc / hãm), rác nảy và lắc trên mặt phẳng, thân máy rung nhẹ theo.
- **Quét bằng laser**: đầu laser vạch đỏ đặt cạnh camera; tia quét từ mép sau ra mép trước rồi quay lại, vạch đỏ in thật lên mặt phẳng và rác, có quạt sáng mờ + ánh đỏ hắt. Sau đó đèn vòng sáng lên và chớp flash để chụp. Màn hình cảm ứng chạy 1 vạch laser qua ảnh vừa chụp.
