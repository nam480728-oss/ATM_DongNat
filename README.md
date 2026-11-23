# ATM Đồng Nát – Trạm đổi chai nhựa & lon nhôm lấy tiền

Mô phỏng 3D (Three.js) một **hệ thống nhiều trạm** thu gom tái chế tự động, back-end Flask + MySQL (1 server trung tâm, 1 CSDL chung), nhận diện bằng **model YOLO11s tự train** (3 nhãn `plastic` / `metal` / `other`).

**Hệ sinh thái chung:** người dùng định danh bằng **số điện thoại**, dùng được ở mọi trạm (`/?station=<id>`). Trang admin trung tâm quản lý trạm, người dùng, voucher, cửa hàng liên kết. Trạm **không lưu số tài khoản ngân hàng**.

**Mỗi trạm có mã riêng theo tỉnh** (vd `DNG-001`, cấp tự động khi tạo, không đổi) và **địa chỉ chi tiết**: số nhà / đường, phường / xã, tỉnh / thành (mô hình chính quyền 2 cấp, 34 tỉnh thành) + tọa độ trên bản đồ OpenStreetMap ở trang admin.

**Camera giám sát** gắn ngay trên màn hình, nhìn thẳng vào người dùng. Khi có **bỏ rác lạ nhiều lần** (mặc định 3 lần / phiên hoặc 5 lần / 24 giờ cùng SĐT), **va đập / đá máy** (cảm biến rung), **cố cạy khay / cửa** khi máy đang khóa (3 lần / 15 giây) hoặc **che camera** (tối liên tục 5 giây): trạm chụp ảnh (che camera thì gửi kèm ảnh rõ cuối cùng trước khi bị che), màn hình cảnh báo người dùng, admin nhận thông báo ngay ở tab **An ninh**. Ảnh chỉ admin xem được.

Trạm cỡ một nhà vệ sinh công cộng gọn (1,6 × 1,4 × 2,4 m), 2 **thùng rác mini âm vào 2 vách hông** (mặt ngoài phẳng với vỏ, chỉ lộ miệng nắp lật) cho rác thường.

**Quy trình:**
1. **Nhập số điện thoại** trên màn hình (hiện tên đã che bớt, vd "Nguyễn V** A*"; số mới thì đăng ký nhanh bằng họ tên), mở cửa (cao ngang ngực), **rút khay** ra (khay là hộp kín 2 bên + mặt sau, rút ra thì mặt sau khay bịt kín ô cửa, không thò tay vào máy được), bỏ chai/lon vào, đẩy khay vào rồi **đóng cửa**. Không có nút tính tiền: đóng cửa là camera trên khay tự quét. Nhiều vật thì **rung khay cho tản ra** rồi quét lại.
2. Có vật không phải chai/lon: **loa hú + đèn đỏ**, cửa **bung hé**, khay nằm yên. Người dùng rút khay, lấy vật khoanh đỏ ra, đẩy khay vào và đóng cửa để quét lại.
3. Toàn chai/lon: **tính tiền ngay** (chai 200đ, lon 300đ). Màn hình hiện 3 nút:
   - **Từ thiện**: góp vào quỹ từ thiện.
   - **Chuyển vào STK**: chọn ngân hàng/ví + nhập số tài khoản cho lần này (không lưu; giao dịch chỉ ghi ngân hàng + 4 số cuối để đối soát).
   - **Lấy voucher**: mã QR + mã chữ (vd `DN-7KQ2-M9XA`), dùng 1 lần trong 30 ngày để trả vé xe / mua hàng ở cửa hàng liên kết. Người bán quét QR bằng điện thoại (mở trang `/shop`), đăng nhập mã cửa hàng + PIN rồi bấm xác nhận.
   - **Lưu vào tài khoản**: cộng vào số dư của số điện thoại để tích lũy dần; lần sau nhập SĐT ở bất kỳ trạm nào rút bằng 1 trong 3 cách trên (nút này chỉ hiện khi có tiền mẻ mới).
   - Hết giờ (mặc định 60 giây) hoặc kết thúc mà chưa chọn: tiền cũng được **giữ vào số dư**.
4. **Phân loại ngay trên khay**: camera quét tính tiền cũng là camera vẽ khung cho tay gắp. Cửa khóa tới khi khay trống.
   - **Tay gắp 2 ngón** lùa từng vật vào **phễu hình nón**: vật gần tâm khay trước, sau đó lần lượt vật gần miệng phễu nhất.
   - Vách trái khay là **cửa lật**: chỉ lật xuống khi khay đã vào hẳn và cửa đã khóa. Mép khay khớp sát miệng phễu, quanh miệng có hộp vách nghiêng che kín nên vật chỉ có đường rơi vào phễu.
   - Miệng phễu cố định, cổ phễu bình thường **giữ hẹp**. Camera băng chuyền canh vật mới rơi xuống: quá **10 giây** chưa thấy (kẹt) thì 16 cánh nón **mở dần** từng nấc; mở hết cỡ vẫn kẹt thì rung phễu, rồi báo nhân viên "kẹt phễu" (cửa vẫn khóa, nút **Gỡ kẹt** trong bảng Khu phân loại / `POST /api/admin/clear-jam`).
   - Trong mô phỏng, rác thả vào phễu luôn lọt xuống; mỗi mẻ chỉ cố ý cho 1–2 vật kẹt để thấy cơ chế chờ 10 giây rồi mở dần phễu.
   - Dưới cổ phễu: ống mica ngắn + **máng trượt nghiêng** cho chai nằm dọc theo **băng chuyền**. Camera băng chuyền xác định chai hay lon, máy hẹn giờ cho **thanh gạt chai** (trước) hoặc **thanh gạt lon** (sau) đẩy vật **thẳng vào thùng**: miệng 3 thùng (bằng nhau) nằm sát mép băng, bằng mặt băng.
5. **Lỗ từ thiện** bên trái cửa: không cần đăng nhập, không tính tiền. Ống **chúc xuống** đổ thẳng vào phễu, đi cùng đường xuống băng chuyền. Vật không phải chai/lon chạy tới **tấm gạt chéo** cuối băng, trượt vào thùng "khác".

Mô phỏng dùng **vật lý thật** (Rapier): rác rơi, lăn, va nhau, lật trong phễu, chạy trên băng, bị gạt rơi vào thùng. Đồ họa có HDRI bầu trời, bóng tiếp xúc (GTAO), bloom, khử răng cưa SMAA.

**Bối cảnh:** 3 trạm đứng thẳng hàng trên vỉa hè đường ven biển; phía sau là kè, bãi cát (dù, ghế nằm, chòi cứu hộ, cây dừa) và biển có sóng; người đi bộ trên 2 vỉa hè, người đi dạo / nằm phơi nắng trên cát, người bơi và tắm dưới biển. Bên kia đường là dãy nhà phố và **cửa hàng demo PEACE Mart** để thử voucher.

**Chế độ đồ họa** (ô **Đồ họa** trên cùng): Tự động (mặc định – bắt đầu ở Cao, FPS dưới 45 liên tục thì tự hạ 1 bậc) / Cao / Vừa / Thấp. Đã tối ưu: kính cửa khoang nạp không dùng khúc xạ (trước đây vẽ lại cả cảnh thêm 1 lượt mỗi khung hình), phần cơ cấu dưới ô cửa không thấy được từ ngoài thì không vẽ, cơ cấu bên trong chỉ đổ bóng khi bật cắt vách, 2 trạm không dùng + đồ trang trí được gộp mesh theo vật liệu, người vẽ bằng InstancedMesh, khung phố không tính lại ma trận mỗi khung hình, lớp màn hình HTML chỉ vẽ lại khi camera đổi, vật lý không chạy khi không có rác. Thời gian vẽ 1 khung hình giảm từ khoảng 46 ms xuống 13 ms (Cao có hậu kỳ: khoảng 21 ms).

Báo cáo model (dữ liệu, xử lý, train, kết quả): [`models/report.md`](models/report.md).

## Cài đặt & chạy trạm

Cần Python 3.11, MySQL/MariaDB. GPU NVIDIA (CUDA) nên có nếu dùng model thật.

```bash
pip install -r requirements.txt
pip install ultralytics            # chỉ cần khi dùng model thật (DETECTOR=yolo)
# Database: chạy database/schema.sql trên MySQL/MariaDB (database atm_db) – Navicat: Query → New Query → Run
python tools/migrate.py            # nâng cấp database cũ + tạo cửa hàng demo PEACEMART (chạy lại an toàn; bản 003 cần --delete-old-users)
copy .env.example .env             # sửa DATABASE_URL, ADMIN_PASSWORD, DETECTOR nếu cần
python run.py
```

| Trang | Địa chỉ |
|---|---|
| Mô phỏng 3D (trạm 1 / trạm 2…) | http://127.0.0.1:5000/?station=1 |
| Màn hình cảm ứng (máy thật, 1280×800) | http://127.0.0.1:5000/screen?station=1 |
| Quản trị hệ thống | http://127.0.0.1:5000/admin (mật khẩu `ADMIN_PASSWORD` trong `.env`) |
| Cửa hàng / nhà xe nhận voucher | http://127.0.0.1:5000/shop (mã + PIN do admin tạo) |

Mã QR voucher chứa địa chỉ `PUBLIC_BASE_URL` (trong `.env`) – để điện thoại người bán mở được, đặt thành địa chỉ LAN của máy chạy server (vd `http://192.168.1.10:5000`) và chạy server với `host=0.0.0.0`.
Sao lưu CSDL trước khi nâng cấp: `python tools/backup_db.py` (file .sql trong `backups/`, không đưa lên GitHub).

### Cấu hình nhận diện (`.env`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `DETECTOR` | `mock` | `mock` = giả lập theo đáp án 3D (demo mượt) · `yolo` = model thật |
| `MODEL_PATH` | `models/model/best.pt` | model đang dùng (YOLO11s lần 3) |
| `CONF_BOTTLE_CAN` / `CONF_OTHER` | `0.85` / `0.80` | ngưỡng tin cậy chai/lon và rác (chọn trên tập val, xem `models/model/MODEL_CARD.md`) |
| `YOLO_IMGSZ` | `1280` | cỡ ảnh đưa vào model khi quét cả khay |
| `BG_CHECK` | `1` | so nền khay: vùng có vật mà model không khoanh → vật lạ → báo động |

Đang chạy vẫn đổi được giữa model thật và giả lập: phím `~` → panel Dev → **Bộ nhận diện**.

## Cách dùng bản mô phỏng

**Điều khiển nhân vật (mặc định khi mở trang)** – kiểu game thế giới mở:

| Phím | Việc |
|---|---|
| `W` `A` `S` `D` (hoặc mũi tên) | Đi theo hướng camera · giữ `Shift` để chạy |
| Kéo chuột · lăn chuột | Xoay camera quanh nhân vật · xa / gần |
| `E` | Tương tác: dùng trạm (đứng trước trạm), sang trạm khác, nhặt rác dưới đất, xem kệ hàng / tủ lạnh, thanh toán ở quầy |
| `V` | Đổi góc **sau lưng** ↔ **trên cao** (camera cao bám theo nhân vật, WASD vẫn điều khiển) |
| `F` | **Xem tự do** (camera xoay quanh trạm như cũ + các nút góc nhìn, cắt vách) · `F` / `Esc` để về nhân vật |
| `Esc` | Thôi dùng trạm / rời quầy thu ngân |

- Đứng trước trạm bấm `E`: camera vào màn hình trạm để bấm như bình thường (nhập SĐT, mở cửa, khay...). Bấm `Esc` hoặc `WASD` để đi tiếp. Đứng trước trạm khác bấm `E` là sang dùng trạm đó (trạm đang dùng phải rảnh).
- Rác vương vãi trên vỉa hè và bãi cát: đi tới bấm `E` để nhặt vào tay (bảng **Rác trong tay** vẫn dùng được như cũ).
- **Mua hàng ở PEACE Mart**: đi qua vạch kẻ (xe tự phanh nhường), vào cửa kính giữa; đứng trước kệ / tủ lạnh bấm `E` chọn hàng vào **Giỏ hàng**; tới **quầy thu ngân** (bên trái cửa) bấm `E` → giỏ thành hóa đơn của thu ngân → trong **Ví voucher** bấm **Đưa mã cho thu ngân quét** → **Trừ vào hóa đơn** → **Thanh toán**. Voucher trừ trước, thiếu thì trả tiền mặt (giả lập); voucher lớn hơn hóa đơn thì phần dư không hoàn (có cảnh báo). Đơn lưu vào CSDL, admin xem ở tab **Cửa hàng** (mục **Đơn bán ở quầy**, nút **Sản phẩm** để thêm / sửa giá / ẩn món).
- **Xe cộ**: ô tô, xe máy chạy 2 chiều; gặp nhân vật hoặc người qua đường trước mũi xe thì giảm tốc, dừng, bấm còi; không đâm vào người. Nhân vật không đi xuyên xe.
- **Người 3D**: thỉnh thoảng có người rẽ vào trạm đút chai qua lỗ từ thiện hoặc bỏ rác vào thùng mini (chỉ là hoạt ảnh, không ghi CSDL; không chen vào trạm bạn đang dùng), có người chờ xe rồi qua đường ở vạch kẻ.
- **Bản đồ nhỏ** góc dưới trái: trạm (trạm đang dùng viền sáng), cửa hàng, rác (chấm vàng), xe, người có việc (chấm hồng), nhân vật (mũi tên) + tầm nhìn camera. Bấm bản đồ để cắm cờ đích (cột sáng xanh trong cảnh), nút `+` / `−` đổi tỉ lệ.

0. Chọn trạm: bấm vào trạm khác trên vỉa hè (hoặc ô **Trạm** trên cùng, hoặc mở `/?station=2`): camera bay sang, trạm đó chạy đủ cơ cấu. Chỉ đổi được khi trạm đang dùng rảnh (đã kết thúc phiên, cửa đóng). Mỗi trạm là một máy riêng, dùng chung tài khoản.
1. Bấm vào màn hình trên trạm → **Bắt đầu** → nhập số điện thoại (bàn phím số trên màn hình hoặc bàn phím máy tính). Số mới: gõ họ tên (Telex) → **Đăng ký**.
2. Bấm cửa để mở, bấm khay để **rút khay** ra.
3. Bảng **Rác trong tay bạn** bên trái: chọn **Khay nạp**, bấm hoặc kéo thả chai, lon, rác lên khay (bấm vào rác trên khay để lấy ra).
4. Bấm khay để đẩy vào, bấm cửa để đóng: máy quét (rung nếu nhiều vật). **Ảnh nhận diện** hiện trong bảng **Camera & khu phân loại** ở góc dưới phải (không che màn hình): khung xanh lá = chai nhựa, xanh dương = lon, đỏ = rác lạ, vàng nét đứt = vật lạ.
5. Hợp lệ: chọn **Từ thiện**, **Chuyển vào STK** hoặc **Lấy voucher** trên màn hình trạm. Máy tự bật cắt vách cho xem phân loại; bảng góc phải hiện thêm ảnh camera khay (đánh số thứ tự lùa) và phép tính hẹn giờ thanh gạt.
6. Có rác lạ: còi + đèn đỏ, cửa bung hé, vật lạ có khung đỏ. Mở cửa, rút khay, bấm **Lấy vật lạ ra khỏi khay**, bấm **Bỏ hết vào thùng rác mini**, đẩy khay vào, đóng cửa.

- **Lỗ từ thiện**: chọn **Lỗ từ thiện** ở bảng trái rồi bấm chai/lon, hoặc kéo thả vào lỗ tròn.
- **Thùng rác mini**: chọn **Thùng rác** rồi bấm rác, hoặc bấm vào thùng. Trang Admin (tab **Trạm**) có mức đầy và nút **Đã đổ** cho từng thùng.
- **Trang admin** `/admin`: tab Tổng quan (lọc theo trạm hoặc toàn hệ thống), Trạm (thêm/sửa trạm, kho chứa, kẹt phễu), Người dùng (tìm theo SĐT/tên, thêm, sửa, khóa, xóa, xem số dư và lịch sử theo trạm), Voucher (lọc, hủy), Cửa hàng (thêm cửa hàng/nhà xe + PIN), Giao dịch, Cài đặt (giá, hạn voucher, thời gian chọn).
- **Trang cửa hàng** `/shop`: người bán đăng nhập mã + PIN, quét QR (link `/v/<mã>` tự mở trang) hoặc gõ mã, bấm **Xác nhận dùng**.
- **In voucher**: sau khi chọn Lấy voucher, màn hình trạm có nút **🖨 In voucher** (tối đa 3 lần) → phiếu giấy (QR, mã, mệnh giá, hạn) đùn ra ở khe in ngay dưới màn hình → bấm vào phiếu để cầm (nhân vật cầm trên tay, ví ghi "📄 phiếu giấy"). Bấm vào **PEACE Mart** ở bất kỳ góc nhìn nào → nhân vật vào đứng trước quầy thu ngân → thanh **Máy quét** trên màn hình thu ngân → **Quét** là trừ luôn và hiện **THANH TOÁN THÀNH CÔNG** (có giỏ hàng thì trừ vào hóa đơn, thiếu trả tiền mặt).
- **Thùng chứa bên trong**: chai / lon bị thanh gạt đẩy vào thùng nằm lại và chồng dần lên nhau (tối đa 30 vật thật mỗi thùng, vượt quá thì gộp vào lớp rác nén dưới đáy), có vách mica chắn quanh miệng thùng để vật không văng ra ngoài. Kéo xe thùng ra đổ thì rác đi theo xe và được đổ hết.
- **Thử voucher ở cửa hàng đối diện**: lấy voucher ở trạm → voucher tự vào **Ví voucher** (nút trên cùng, lưu trên trình duyệt này). Kết thúc phiên ở trạm, bấm vào **PEACE Mart** bên kia đường → camera bay tới, mở **quầy thu ngân** (trang `/shop` thật, vào thẳng tài khoản cửa hàng demo) → trong ví bấm **Đưa mã cho thu ngân quét** → **Xác nhận dùng**. Cửa hàng demo: mã `PEACEMART`, PIN `2468` (tạo bởi `tools/migrate.py`; admin tắt chế độ demo ở tab Cửa hàng thì quầy thu ngân phải đăng nhập PIN như cửa hàng thường).
- **Camera giám sát**: hộp camera + đèn REC trên màn hình trạm, nhãn "Khu vực có camera". Thử ở panel Dev: **Đá vào trạm**, **Cạy cửa 3 lần**, **Che camera** (giữ ≥ 5 giây); hoặc bấm dồn dập ≥ 5 lần vào vỏ trạm, cố mở cửa khi máy đang quét / phân loại, bỏ rác lạ 3 lần trong 1 phiên. Xem kết quả ở tab **An ninh** trang admin (ảnh, người đang đăng nhập, ghi chú, đánh dấu đã xử lý).
- **Cửa sau** (nút **Mặt sau**): mở cửa, kéo xe thùng (chai | lon | khác) ra đổ, đẩy vào; bộ đếm về 0.
- **Xem**: kéo chuột để xoay, lăn chuột để zoom, chuột phải để dịch.
- **Panel Dev** (phím `~`): đổi bộ nhận diện, ép vật đè nhau, chọn kiểu kẹt phễu mỗi mẻ (mặc định 1–2 vật kẹt rồi lọt khi phễu mở dần / không kẹt / kẹt cứng phải gỡ), bật/tắt đồ họa cao, ép kho đầy, tua nhanh ×3, xem ảnh gần nhất của camera khay / camera băng chuyền.

> Với model thật, vật 3D được phủ ảnh chụp thật nên model nhận ra được, nhưng model hiện mới bắt được ~65% chai/lon ở ngưỡng 0,85, nên mẻ nhiều vật thường bị báo rác lạ (chi tiết `models/report.md` mục 6). Muốn demo trơn tru dùng `DETECTOR=mock`.

## Thử model ngoài trạm

```bash
cd models/scripts
python test.py "D:\anh\khay.jpg"            # 1 ảnh (đường dẫn hoặc link): khoanh vật, đếm, tính tiền
python test_came.py                          # realtime qua webcam: SPACE chốt mẻ in hóa đơn, Q thoát
curl -F file=@anh.jpg http://127.0.0.1:5000/api/scan   # API của trạm (?conf=0.3 để hạ ngưỡng khi thử)
```

## Dữ liệu & train lại model (`models/`)

Dữ liệu (~12 GB) **không có trên GitHub**, tải và xử lý lại bằng script:

```bash
python models/scripts/Down_data/download_*.py        # Kaggle (cần ~/.kaggle/kaggle.json), Roboflow (ROBOFLOW_API_KEY trong .env), TACO, COCO, Open Images
python models/scripts/Xu_Ly_Du_Lieu/01_*.py ... 16_*.py   # chạy lần lượt theo số thứ tự (xem plan_xu_ly_data.md)
python models/scripts/Train/00_kiem_tra.py           # kiểm tra GPU, RAM, dữ liệu
python models/scripts/Train/01_train.py --ten y11s_MMDD_01   # train (cấu hình: models/scripts/Train/cau_hinh.yaml)
python models/scripts/Train/theo_doi.py y11s_MMDD_01         # theo dõi tiến độ
python models/scripts/Train/02_danh_gia.py y11s_MMDD_01      # đánh giá trên val (+ chấm theo trạm)
python models/scripts/Train/03_chot_model.py y11s_MMDD_01    # chép best.pt/onnx ra models/model/ + MODEL_CARD.md
python tools/tao_anh_that_3d.py                       # cắt ảnh thật dán lên vật 3D của bản mô phỏng
```

## Kiến trúc

```
app/
  station/controller.py   Máy trạng thái của trạm (nguồn sự thật duy nhất): khay nạp + phân loại + lỗ từ thiện
  station/sorting.py      Thứ tự lùa vào phễu + hẹn giờ thanh gạt (hàm thuần)
  station/hal.py          Lớp phần cứng: SimulatedHardware (scene 3D qua Socket.IO) | GpioHardware (tương lai)
  detection/              MockDetector (giả lập) | YoloDetector (model thật) | background.py (so nền khay)
  routes/, sockets.py     Trang, API admin (routes/admin.py), cửa hàng (routes/shop.py), sự kiện socket theo từng trạm
  services/               user_service (SĐT, che tên), voucher_service (voucher QR, cửa hàng), station_service (mã trạm theo tỉnh,
                          địa chỉ), order_service (sản phẩm, thanh toán quầy), settings_service
  static/js/              Scene 3D (Three.js): station/interior.js (cơ cấu bên trong), sim/physics.js (vật lý Rapier),
                          items/trashManager.js (đường đi của rác), postfx.js (HDRI + hậu kỳ),
                          ui/alarm.js (còi + đèn đỏ), ui/sorterHud.js (ảnh quét + khu phân loại),
                          station/securityCam.js (camera giám sát), station/interiorCull.js (bớt vẽ cơ cấu khuất),
                          city/street.js (đường ven biển, 3 trạm, chuyển trạm), city/people.js (người), city/shop.js
                          (cửa hàng, ví voucher, giỏ hàng), city/merge.js (gộp mesh), ui/quality.js (chế độ đồ họa),
                          player/player.js (nhân vật WASD + camera), city/traffic.js (xe cộ), city/npcs.js (người bỏ rác,
                          qua đường), city/litter.js (rác dưới đất), ui/minimap.js (bản đồ nhỏ)
  static/vendor/          three.js r160 (+ addons hậu kỳ), Rapier 0.12 (WASM, Apache-2.0), HDRI Poly Haven (CC0), gsap, socket.io
  static/textures/real/   Ảnh thật (đã tách nền) phủ lên vật 3D
  static/screen/          Màn hình cảm ứng (đăng nhập SĐT, 3 nút nhận tiền, voucher QR) + bộ gõ Telex
  static/admin/, templates/shop.html   Trang admin trung tâm, trang cửa hàng nhận voucher
models/
  scripts/                Down_data/ (tải) · Xu_Ly_Du_Lieu/ (xử lý) · Train/ (train, đánh giá) · test.py · test_came.py
  model/                  best.pt, best.onnx, MODEL_CARD.md, y11s_1119_02/ (biểu đồ, báo cáo đánh giá)
  report.md               Báo cáo model
database/schema.sql       Tạo bảng MySQL
tests/                    pytest (SQLite in-memory, không đụng atm_db)
tools/                    migrate.py, backup_db.py (sao lưu CSDL ra .sql), cleanup_test_data.py, tao_anh_that_3d.py
```

Scene 3D đóng vai "phần cứng ảo". Nó gửi sự kiện cảm biến: cửa khoang nạp, cửa sau, xe thùng, vật rơi qua lỗ từ thiện. Nó nhận lệnh cơ cấu và báo khi chạy xong:
`lock_door`, `pop_door`, `alarm`, `tray_vibrate`, `capture{camera: tray|belt|security}`, `tray_gate{open}`, `gripper_push{bbox}`, `tray_sweep` (1 vật), `funnel_open{level 0..1}`, `funnel_shake`, `belt_wait{seconds} → {arrived}`, `belt_sort{kind, delay}`, `slot_gate`, `set_led`. Lên máy thật chỉ cần viết `GpioHardware` cùng interface trong `app/station/hal.py`.

Cảm biến an ninh gửi qua socket `security {name: impact{g} | tamper | camera_blocked{giây, 0 = hết che}}`.

Ảnh mỗi lần quét lưu ở `data/scans/`, ảnh cắt vật bị loại ở `data/crops/` – có thể dùng làm dữ liệu train thêm. Ảnh camera giám sát lưu ở `data/security/` (chỉ xem qua API admin, không công khai ở `/media`).

## Kiểm thử

```bash
python -m pytest -q
```
