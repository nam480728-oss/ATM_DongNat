# ATM Đồng Nát – Trạm đổi chai nhựa & lon nhôm (mô phỏng 3D)

Mô phỏng 3D (Three.js) của một trạm thu gom giống máy bán nước tự động. Back-end là Flask + MySQL.
Người dùng chọn tên, bỏ chai/lon vào khay, bấm **TÍNH TIỀN**. Máy rung dàn đều rác, quét bằng AI, rồi quy đổi ra tiền.
Nếu có vật không hợp lệ, máy trả **cả đống** rác về ngăn dưới và hiện ảnh cắt của vật đó lên màn hình.

## Chạy

```bash
pip install -r requirements.txt
# Database: chạy database/schema.sql trên MySQL/MariaDB (database atm_db) – Navicat: Query → New Query → Run
python tools/migrate.py     # chỉ khi database tạo từ bản cũ (an toàn khi chạy lại)
copy .env.example .env      # sửa DATABASE_URL, ADMIN_PASSWORD nếu cần
python run.py
```

| Trang | Địa chỉ |
|---|---|
| Mô phỏng 3D | http://127.0.0.1:5000/ |
| Màn hình cảm ứng (dùng cho máy thật, 1280×800) | http://127.0.0.1:5000/screen |
| Quản trị | http://127.0.0.1:5000/admin (mật khẩu: `ADMIN_PASSWORD` trong `.env`) |

## Cách dùng bản mô phỏng

1. Bấm vào màn hình trên trạm. Camera sẽ bay tới gần, rồi bấm **Bắt đầu** → chọn tên (hoặc **+ Người dùng mới**). Tên gõ kiểu Telex.
2. Bấm vào tay nắm cửa để mở cửa, bấm tay cầm khay để kéo khay ra.
3. Ở bảng **Rác trong tay bạn** bên trái, bấm hoặc kéo thả rác vào khay. Bấm vào rác trong khay nếu muốn lấy ra.
4. Đẩy khay vào, đóng cửa, bấm nút xanh **TÍNH TIỀN**.
5. Máy tự bật chế độ cắt lớp để bạn xem bên trong: đổ rác → (rung) → quét → vào kho hoặc trả về ngăn dưới.
6. Màn hình hiện số tiền: chọn **Chuyển khoản** (vào STK) hoặc **Từ thiện** (vào quỹ của trạm). Không chọn sau 30 giây thì tự chuyển khoản.
7. Nếu rác bị trả về: kéo **ngăn trả rác** ở đáy máy ra, bấm vào rác để lấy lại.

**Lỗ bỏ từng chai/lon** (lỗ tròn phía trên cửa): ở bảng bên trái chọn **Lỗ bỏ chai** rồi bấm rác, hoặc kéo thả rác vào lỗ.
Không cần mở cửa. Chưa chọn tên thì chỉ phân loại, không tính tiền. Đã chọn tên thì cộng dồn vào lần bấm TÍNH TIỀN.

**Cửa sau** (nút **Mặt sau**): bấm cửa để mở, bấm thùng để kéo ra đổ, rồi đẩy vào và đóng cửa. Bộ đếm kho tự về 0.

**Xem**: kéo chuột để xoay, lăn chuột để zoom mượt về đúng chỗ con trỏ, chuột phải để dịch.

Phím `~` mở **panel Dev** với các công cụ: ép lỗi vật đè nhau, ép kho đầy, tua nhanh hoạt ảnh, xem ảnh camera quét gần nhất (kèm khung nhận diện).

## Kiến trúc

```
app/
  station/controller.py   Máy trạng thái (nguồn sự thật duy nhất của quy trình)
  station/hal.py          Lớp phần cứng: SimulatedHardware (scene 3D qua Socket.IO) | GpioHardware (tương lai)
  detection/              Detector: MockDetector (giả lập) | YoloDetector (model thật) + cắt ảnh rác lỗi
  routes/                 Trang, API người dùng, API admin
  sockets.py              Sự kiện cảm biến / lệnh cơ cấu
  static/js/              Scene 3D (Three.js): station/, items/, sim/, ui/
  static/screen/          Giao diện màn hình cảm ứng + bộ gõ Telex
database/schema.sql       Tạo bảng MySQL
tests/                    pytest (dùng SQLite in-memory, không đụng tới atm_db)
tools/cleanup_test_data.py  Xóa dữ liệu test khỏi atm_db
```

Scene 3D chỉ đóng vai "phần cứng ảo". Nó gửi sự kiện cảm biến (cửa, khay, ngăn trả rác, nút bấm), nhận lệnh cơ cấu
(`lock_door`, `dump_feed_tray`, `vibrate`, `capture`, `tilt_plate`, `set_led`) và báo khi đã chạy xong.
Khi lên máy thật, chỉ cần viết `GpioHardware` có cùng interface trong `app/station/hal.py`.
Màn hình `/screen` thì dùng lại nguyên như hiện tại.

## Cắm model AI tự train

1. Đặt file model, ví dụ `models/best.pt` (YOLO/ultralytics, hoặc `.onnx`).
2. Trong `.env`: `DETECTOR=yolo`, `MODEL_PATH=models/best.pt`, `CONF_THRESHOLD=0.5`.
3. Sửa `CLASS_MAP` trong `app/config.py` để ánh xạ tên lớp của model sang `bottle` / `can`.
   Lớp không có trong map, hoặc vật có độ tin cậy dưới ngưỡng, đều bị coi là **không hợp lệ**.
4. Thử model trên 1 ảnh: `curl -F file=@anh.jpg http://127.0.0.1:5000/api/scan`

Ảnh mỗi lần quét được lưu ở `data/scans/`, ảnh cắt rác lỗi ở `data/crops/`.
Có thể dùng các ảnh này làm dữ liệu thử nghiệm.

## Kiểm thử

```bash
python -m pytest -q
```
