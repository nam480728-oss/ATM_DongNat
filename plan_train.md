# Kế hoạch train model nhận diện: nhựa, kim loại, rác khác

> Ngày lập: 18/11/2026. Dựa trên `plan_model.md` (mục 4) và dữ liệu đã xử lý xong (`plan_xu_ly_data.md`).
> **Trạng thái (19/11):** train lần 2 (`y11s_1119_01`) xong, **vẫn chưa đạt** recall nhựa/kim loại (mục 11.6). Anh/chị chốt: **không train YOLO11m**. Đã chốt hướng mục 11.7: bước 1–2 **đã áp dụng** (`data_da_xu_ly/BAO_CAO.md` mục 7) + rà soát B15 (mục 8) → 8.359 ảnh. Cấu hình lần 3: **epochs 80, close_mosaic 10**. `02_danh_gia.py` tính thêm other giả trên nền. Ảnh đã resize cạnh dài 640 (B16).
> **19/11 tối:** train lần 3 `y11s_1119_02` xong 80/80 epoch (1h57m, best epoch 67). Chấm lại cả 2 lần trên val mới (bản chấm cũ của lần 2: `y11s_1119_01/danh_gia_val_cu/`): mAP50 0,802 vs 0,786; AP50 other 0,573 vs 0,527; rác bị nhận là chai/lon 0,8% vs 1,7%. Đường đánh đổi trạm gần như nhau, **chưa ngưỡng nào đạt mục tiêu trạm** (other trượt chủ yếu ở cảnh ngoài trời TACO/OI). **Đã chọn lần 3 làm model hiện tại** (`03_chot_model.py`: `models/model/best.pt` + `best.onnx` + `MODEL_CARD.md`, ngưỡng chai/lon 0,85, other 0,80; **chưa chạy tập test**, để dành cho model cuối). `scripts/test.py` đã đổi sang lần 3. → bước tiếp: chụp ảnh khay thật.
> **22/11 – tích hợp model vào trạm 3D:** `.env DETECTOR=yolo` (models/model/best.pt, imgsz 1280, ngưỡng 0,85/0,80), so nền khay (`app/detection/background.py`), màn xác nhận ảnh + nút OK (trạng thái `WAITING_CONFIRM`), vật 3D phủ ảnh thật cắt từ tập train (`tools/tao_anh_that_3d.py`). Mô phỏng 30 mẻ × 6 vật: nhận đúng từng vật ~10% ở ngưỡng 0,85 (~35% ở 0,5) -> **gần như mọi mẻ sạch bị trả** vì vật sót bị so nền coi là vật lạ. Chờ anh/chị chọn hướng xử lý.
> **20/11:** theo anh/chị, **đã xóa hẳn thư mục lần 1 (`y11s_1118_01`) và lần 2 (`y11s_1119_01`)**; `models/model/` chỉ còn lần 3 + `best.pt/onnx`. Số liệu lần 1–2 ở mục 11 bên dưới chỉ còn là ghi chép lịch sử, đường dẫn tới 2 thư mục đó không còn.
> Code train lưu ở `models/scripts/Train/`. Trọng số, biểu đồ, báo cáo lưu ở `models/model/`.

---

## 0. Tóm tắt

| Hạng mục | Quyết định đề xuất |
| --- | --- |
| Model | **YOLO11s**, khởi tạo từ trọng số COCO (`yolo11s.pt`), fine-tune 3 lớp (đã chốt ở `plan_model.md`) |
| Dữ liệu | `models/data_da_xu_ly/data.yaml`: train 6.134 / val 1.776 / test 853 ảnh (bản chốt 19/11) |
| Máy | Laptop RTX 4060 8 GB, RAM 16 GB |
| Thời gian | Khoảng **4–6 giờ** cho 150 epoch (dừng sớm nếu 30 epoch liền không tiến bộ) |
| Đánh giá | Tập test (mAP, precision/recall từng nhãn, ma trận nhầm lẫn) + **tập vật lạ `unseen_test`** (tỉ lệ từ chối đúng) + tốc độ |
| Sản phẩm | `models/model/best.pt` + `MODEL_CARD.md` (số liệu, ngày, phiên bản dữ liệu) |
| Bước sau (plan riêng) | `webcam_demo.py`: anh/chị cầm đồ thử thật (M4 trong `plan_model.md`) |

---

## 1. Dữ liệu đầu vào

| Tập | Ảnh | Box plastic | Box metal | Box other | Ảnh nền |
| --- | --- | --- | --- | --- | --- |
| train | 6.134 | 2.816 | 2.496 | 3.110 | 67 |
| val | 1.776 | 846 | 732 | 953 | 24 |
| test | 853 | 406 | 346 | 430 | 11 |
| **Tổng** | **8.763** | **4.068** | **3.574** | **4.493** | **102** (1%) |

- Bản chốt 19/11 (mục 11; anh/chị lọc tay thêm 18 ảnh train). Bản cũ dùng cho train lần 1: 10.416 ảnh (plastic 4.643 / metal 3.994 / other 5.500 / nền 1.257).
- Chia theo `split_key` nên không có rò rỉ giữa các tập (đã kiểm tra: ảnh gần trùng, ảnh zoom, khung cùng video luôn chung 1 tập).
- `unseen_test/`: 600 ảnh của 10 loại vật **không có trong train** (bánh mì, nến, đồng hồ, bóng đèn, khung ảnh, gối, khăn, cà chua, hoa, bánh sừng bò). Chỉ dùng để đo khả năng **từ chối vật lạ**.
- Tập **test chỉ mở 1 lần** khi chốt model. Mọi việc chỉnh tham số đều nhìn tập **val**, để số liệu test là số liệu thật.

---

## 2. Các giai đoạn

| Bước | Việc | Thời gian | Anh/chị duyệt? |
| --- | --- | --- | --- |
| T0 | Kiểm tra môi trường: GPU, tải `yolo11s.pt` (GitHub), đọc `data.yaml`, cài `albumentations` (làm mờ, nhiễu, nén JPEG) | 5 phút | — |
| T1 | **Chạy thử**: 2 epoch trên 10% dữ liệu, đo VRAM, RAM, thời gian/epoch, xem ảnh batch đã tăng cường | 5–10 phút | — |
| T2 | **Train chính**: YOLO11s, 150 epoch, `patience=30` | 4–6 giờ | — |
| T3 | **Đánh giá** trên val + test + unseen_test, chọn ngưỡng conf, đo tốc độ, xuất ảnh lỗi | 15 phút | ✅ xem báo cáo |
| T4 | (Chỉ khi T3 chưa đạt) cải thiện theo mục 6 rồi train lại | tùy | ✅ chọn hướng |
| T5 | Chốt model: chép `best.pt` vào `models/model/`, viết `MODEL_CARD.md`, xuất ONNX (để dự phòng) | 5 phút | — |

Mỗi bước xong mình báo tiến độ. Trong lúc train, mình báo mỗi khoảng 25 epoch (mAP val, loss).

---

## 3. Tham số train

| Nhóm | Giá trị | Lý do |
| --- | --- | --- |
| Model | `yolo11s.pt` (COCO) | Khởi tạo sẵn "hiểu vật thể", hội tụ nhanh và tốt hơn nhiều so với train từ đầu khi chỉ có ~10 nghìn ảnh |
| Ảnh | `imgsz=640` | Chuẩn của YOLO11; vật cầm trước webcam thường to |
| Batch | `batch=16` (thiếu VRAM thì 8) | YOLO11s 640 dùng khoảng 4–5 GB VRAM với AMP |
| Epoch | `epochs=150`, `patience=30` | Dừng sớm khi mAP val không tăng 30 epoch |
| Tối ưu | `optimizer=auto` (AdamW/SGD tự chọn), `cos_lr=True`, `warmup_epochs=3` | Mặc định tốt của Ultralytics + giảm learning rate mượt cuối quá trình |
| Hiệu năng | `amp=True`, `workers=2` (train) + `workers_val=2`, `cache=False` | **RAM 16 GB:** mỗi tiến trình đọc ảnh tốn ~0,6–1 GB trên Windows; Ultralytics mặc định mở val = 2×workers và giữ suốt quá trình train → đo được ~7,9 GB, giảm còn ~6,5 GB. 3 tiến trình không nhanh hơn (GPU là giới hạn: ~4,7 vòng/giây ≈ 75 ảnh/giây) |
| Lặp lại được | `seed=42`, `deterministic=True` | Chạy lại ra cùng kết quả |

**Tăng cường dữ liệu** (mô phỏng webcam cầm tay: nghiêng, xa gần, ánh sáng, mờ chuyển động):

| Tham số | Giá trị | Ghi chú |
| --- | --- | --- |
| `mosaic` | 1.0, tắt ở **30** epoch cuối (`close_mosaic=30`; lần 1 là 15) | Ghép 4 ảnh, đa dạng nền. Tắt sớm hơn để model học lâu hơn trên ảnh 1 vật cận cảnh giống ATM |
| `mixup` | 0.1 | Trộn nhẹ 2 ảnh |
| `degrees` | **5** (lần 1 là 20) | Chai/lon cầm nghiêng nhẹ. Xoay mạnh làm box thẳng trục phình to, box lỏng |
| `flipud` / `fliplr` | 0.1 / 0.5 | Thỉnh thoảng cầm ngược chai |
| `scale` | 0.5 | Vật xa/gần camera |
| `translate` | 0.1 | |
| `hsv_h` / `hsv_s` / `hsv_v` | 0.015 / 0.6 / 0.4 | Ánh sáng, màu đèn khác nhau |
| `albumentations` | Blur, MedianBlur, ToGray, CLAHE, nén JPEG (Ultralytics tự áp dụng với xác suất nhỏ khi đã cài) | Webcam rung, mờ, chất lượng thấp |
| ~~`copy_paste`~~ | **Không dùng** | Plan cũ có ghi 0.3, nhưng tính năng này cần nhãn **mask**. Dữ liệu của mình chỉ có box nên không có tác dụng |

Mất cân bằng nhãn đã được xử lý ở bước dữ liệu (bản 19/11: other 4.493, plastic 4.068, metal 3.574, chênh tối đa khoảng 1,3 lần), nên **không cần trọng số lớp**.

---

## 4. Đánh giá (T3)

### 4.1 Chỉ số và tiêu chí đạt (theo `plan_model.md`)

| Chỉ số | Đo trên | Mục tiêu |
| --- | --- | --- |
| mAP50 (3 lớp) | test | ≥ 0,85 |
| Recall `plastic`, `metal` | test, ở ngưỡng conf vận hành | ≥ 0,93 |
| Precision `plastic`, `metal` | test, ở ngưỡng conf vận hành | ≥ 0,95 |
| **Từ chối đúng vật lạ** | `unseen_test` (600 ảnh) | ≥ 90% |
| Tốc độ | ảnh 640, GPU laptop (đo cả CPU để tham khảo) | ≥ 20 khung hình/giây |

**"Từ chối đúng" được tính thế nào:** một ảnh vật lạ được tính là từ chối đúng nếu model **không** ra khung `plastic`/`metal` nào có conf ≥ ngưỡng vận hành. Ra khung `other` hoặc không ra khung nào đều tính là đúng.

### 4.2 Chọn ngưỡng conf vận hành

- Quét conf từ 0,3 đến 0,9 trên **val**.
- Vẽ đường precision/recall của plastic/metal cùng tỉ lệ từ chối vật lạ.
- Chọn ngưỡng thấp nhất mà precision ≥ 0,95 và từ chối vật lạ ≥ 90%. Plan cũ đề xuất 0,6; con số này sẽ được kiểm chứng lại bằng dữ liệu.
- Ngưỡng chọn được ghi vào `MODEL_CARD.md` để `webcam_demo.py` dùng.

### 4.3 Báo cáo cho anh/chị (`models/model/<tên lần train>/danh_gia/BAO_CAO_TRAIN.md`)

- Đường loss, mAP theo epoch; ma trận nhầm lẫn (quan trọng nhất: **nhựa ↔ other** và **kim loại ↔ other**).
- Kết quả **theo từng nguồn dữ liệu** trên test (Drinking Waste, TACO, Open Images…), để biết model yếu ở loại ảnh nào.
- Kết quả theo **kích thước vật** (nhỏ / vừa / lớn).
- **Thư viện ảnh lỗi** (`loi/`): khoảng 100 ảnh nhận nhầm hoặc bỏ sót nhiều nhất, có vẽ khung đúng và khung model đoán, để anh/chị xem bằng mắt.
- Tỉ lệ từ chối vật lạ **theo từng loại** (đồng hồ, bóng đèn…), xem loại nào hay bị nhận nhầm thành nhựa/kim loại.

---

## 5. Cấu trúc code và file

```text
models/scripts/Train/
├─ cau_hinh.yaml          tham số train (mục 3): sửa ở đây, không sửa code
├─ 00_kiem_tra.py         T0: GPU, trọng số, data.yaml, albumentations
├─ 01_train.py            T1 + T2: --thu (chạy thử 2 epoch) | --resume (train tiếp khi bị ngắt)
├─ 02_danh_gia.py         T3: val/test/unseen, quét ngưỡng, tốc độ, ảnh lỗi -> BAO_CAO_TRAIN.md
├─ 03_chot_model.py       T5: chép best.pt -> models/model/, MODEL_CARD.md, xuất ONNX
├─ theo_doi.py            xem tiến độ lần train đang chạy (anh/chị cũng chạy được)
└─ _chung.py              đường dẫn + hàm dùng chung

models/model/<tên>/       kết quả mỗi lần train: weights/, results.csv, tien_do.log, biểu đồ, danh_gia/
models/model/             best.pt + best.onnx + MODEL_CARD.md (model đang dùng)
```

- Tên lần train: `y11s_<ngày>_<số>`, ví dụ `y11s_1118_01`. Không ghi đè lần train cũ, để so sánh được.
- `models/model/` (trọng số, ảnh) thêm vào `.gitignore` vì file nặng.
- Ultralytics tự tạo file `labels/*.cache` trong `data_da_xu_ly/` khi đọc nhãn. Đây là file bình thường, xóa đi thì nó tự tạo lại.

---

## 6. Nếu chưa đạt (T4): hướng cải thiện theo thứ tự ưu tiên

| Hiện tượng | Hướng xử lý |
| --- | --- |
| Precision nhựa/kim loại thấp (nhận nhầm other) | Tăng ngưỡng conf; thêm hard negative (chai thủy tinh, cốc sứ…) lấy lại từ dữ liệu thô bằng pipeline xử lý |
| Recall thấp (bỏ sót) | Train thêm epoch; `imgsz=800` nếu sót vật nhỏ; xem thư viện ảnh lỗi để tìm nhãn sai |
| Từ chối vật lạ < 90% | Thêm loại vật đa dạng vào `other`. Nếu vẫn không đạt thì chuyển **phương án B** (`plan_model.md` mục 1.4): model phát hiện "vật thể" chung + model phân loại 3 nhãn, cả hai đều tự train |
| Đạt trên test nhưng yếu ở một nguồn | Xem lại nhãn của nguồn đó (có thể còn sót nhãn sai) |
| Mọi chỉ số đều thiếu một chút | Thử **YOLO11m** (lớn hơn, `batch=8`, chậm hơn khoảng 2 lần; webcam vẫn đạt ≥ 20 khung hình/giây trên GPU) |

Mỗi lần cải thiện đều train thành lần mới (`_02`, `_03`…) và so sánh với lần trước trên **val**. Chỉ lần được chọn cuối cùng mới chạy trên test.

---

## 7. Rủi ro và cách phòng

| Rủi ro | Cách phòng |
| --- | --- |
| **Thiếu RAM**, tiến trình bị dừng giữa chừng (đã xảy ra ở bước xuất dữ liệu) | `workers=4`, `cache=False`. Chạy train thành **tiến trình độc lập** (không phụ thuộc phiên Claude), ghi log ra file. Nên đóng bớt trình duyệt/ứng dụng nặng khi train |
| Train bị ngắt (tắt máy, sập nguồn) | Ultralytics lưu `last.pt` mỗi epoch. `01_train.py --resume` train tiếp từ chỗ dừng |
| Laptop nóng, GPU giảm xung | Cắm sạc, kê cao tản nhiệt. Mình theo dõi thời gian/epoch, nếu tăng bất thường thì báo |
| Hết VRAM | Tự giảm `batch` xuống 8 |
| Kết quả tốt trên test nhưng kém khi cầm thật | Đã tính trước: bước sau là thử webcam với khoảng 30 món đồ thật (M4), ảnh lỗi chụp lại bằng phím `S` để bổ sung dữ liệu |

---

## 8. Việc anh/chị cần làm

1. Duyệt các câu hỏi ở mục 9.
2. Lúc train chính (4–6 giờ): **để máy cắm sạc, không tắt máy/ngủ máy**, nên đóng bớt ứng dụng nặng. Có thể chạy qua đêm.
3. Sau T3: xem `BAO_CAO_TRAIN.md` và thư mục ảnh lỗi.

---

## 9. Cần anh/chị chốt

| # | Câu hỏi | Đã chốt (18/11) |
| --- | --- | --- |
| 1 | Khởi tạo từ trọng số COCO hay train từ đầu? | ✅ **COCO** (`yolo11s.pt`) |
| 2 | Số epoch / thời gian | ✅ 150 epoch, dừng sớm sau 30 epoch không tiến bộ |
| 3 | Xoay/lật khi tăng cường | ✅ Xoay ±20°, lật dọc 10% → **19/11 đổi: xoay ±5°, tắt mosaic 30 epoch cuối** |
| 4 | Tiêu chí đạt | ✅ Như mục 4.1 |
| 5 | Chưa đạt thì làm gì? | ✅ **Thử các hướng cải thiện ở mục 6 trước**; thử hết mà không đạt thì dừng, báo anh/chị |
| 6 | Lưu ở đâu? | ✅ Code: `models/scripts/Train/`. **Bộ não (trọng số) + mọi biểu đồ, báo cáo: `models/model/`** (thay cho `models/runs/` ở mục 5) |
| 7 | Ai bấm train? | ✅ **Anh/chị tự chạy lệnh train ở terminal riêng** rồi nhắn mình; mình theo dõi và báo tiến độ (mục 10) |

---

## 10. Cách phối hợp khi train (đã chốt 18/11)

| Việc | Ai làm |
| --- | --- |
| Viết code, tự chạy thử ngắn (T0 + T1, 2 epoch trên 10% dữ liệu) để chắc code chạy được; xóa kết quả chạy thử | Mình |
| **Bấm train chính** (T2) và các lần train cải thiện (T4) ở **terminal riêng**: mình đưa sẵn câu lệnh | **Anh/chị** |
| Theo dõi: đọc `tien_do.log` + `results.csv` mà script ghi sau mỗi epoch, cùng trạng thái GPU | Mình |
| Đánh giá (T3) và chốt model (T5) sau khi train xong | Mình (chạy khi GPU rảnh) |
| Dừng train giữa chừng (Ctrl+C ở terminal train) | Chỉ anh/chị. Mình không tự tắt tiến trình train |

**Xử lý sự cố (chốt 18/11):** lần đầu anh/chị bấm train; khi có sự cố mình tự chạy lệnh trong **cửa sổ PowerShell mới, hiện trên màn hình** (anh/chị vẫn thấy và Ctrl+C được; độc lập với phiên Claude).

| Sự cố | Mình làm gì |
| --- | --- |
| Tiến trình train biến mất / lỗi tạm thời (tiến trình đọc ảnh, đọc file) | Tự `01_train.py --resume <tên>`, báo anh/chị |
| Cùng lỗi lặp lại, hoặc đã tự resume 3 lần trong một lần train | Dừng, báo nguyên nhân |
| Hết VRAM, loss = NaN | Không tự chạy lại (cần đổi cấu hình), báo + đề xuất |
| Anh/chị bấm Ctrl+C | Coi là chủ động dừng, không tự chạy lại |

**Train cải thiện (T4):** anh/chị chọn **a** (18/11) — mình chuẩn bị cấu hình và **tự bấm train** (cửa sổ PowerShell mới), báo khi bắt đầu.

**Báo tiến độ:**

- Báo **mỗi 10 epoch** (khoảng 20–30 phút): mAP val, loss, thời gian còn lại dự kiến.
- Báo **ngay** khi có sự kiện: train xong, dừng sớm, lỗi hoặc tiến trình biến mất, loss bất thường (NaN), epoch chậm hẳn (GPU nóng), mAP val đạt mức cao mới đáng kể.
- **Lưu ý:** mình chỉ báo được khi phiên Claude Code này còn mở. Nếu phiên bị đóng, train vẫn chạy bình thường; mở lại và nhắn mình, mình đọc log để cập nhật lại toàn bộ.

**Thư mục kết quả:**

```text
models/model/
├─ y11s_1119_02/          lần 3 = lần duy nhất còn giữ (lần 1, 2 đã xóa 20/11); lần train mới sẽ có thư mục riêng
│  ├─ weights/best.pt, last.pt
│  ├─ results.csv, tien_do.log, *.png (loss, mAP, PR, ma trận nhầm lẫn, ảnh batch)
│  └─ danh_gia/            BAO_CAO_TRAIN.md, biểu đồ quét ngưỡng, ảnh lỗi (loi/)
├─ best.pt, best.onnx     model đang dùng (chép từ lần train được chọn ở T5)
└─ MODEL_CARD.md          số liệu, ngưỡng conf vận hành, ngày, phiên bản dữ liệu
```

---

## 11. Lịch sử các lần train và thay đổi (cập nhật 19/11)

### 11.1 Lần 1: `y11s_1118_01` (YOLO11s, dữ liệu bản 18/11)

Dừng sớm ở epoch 113 (tốt nhất epoch 83), 3 giờ 47 phút. Kết quả trên **val**, ngưỡng conf tự chọn 0,85:

| Chỉ số | Mục tiêu | Kết quả |
| --- | --- | --- |
| mAP50 (3 lớp) | ≥ 0,85 | 0,753 ❌ (plastic 0,862 · metal 0,900 · other 0,498) |
| Precision plastic / metal | ≥ 0,95 | 0,968 / 0,967 ✅ |
| Recall plastic / metal | ≥ 0,93 | 0,556 / 0,627 ❌ |
| Từ chối đúng vật lạ | ≥ 90% | 99,7% ✅ |
| Tốc độ GPU | ≥ 20 khung hình/giây | 73 ✅ |

**Mốc so sánh cho lần 2** — chấm lại model lần 1 trên **val mới** (1.776 ảnh, bản chốt 19/11; báo cáo cũ giữ ở `y11s_1118_01/danh_gia_data_18_11/`):

| Chỉ số (val mới) | Lần 1 |
| --- | --- |
| mAP50 | 0,793 (plastic 0,898 · metal 0,934 · other 0,548) |
| Ở ngưỡng 0,85: P / R plastic | 0,973 / 0,604 |
| Ở ngưỡng 0,85: P / R metal | 0,990 / 0,645 |
| Ở ngưỡng 0,50: P / R plastic · metal | 0,844 / 0,825 · 0,935 / 0,832 |
| Từ chối vật lạ (ngưỡng 0,85) | 99,7% |

### 11.2 Lần cải thiện YOLO11m: `y11m_1119_01` — **hủy**

Ổ D bị ngắt đột ngột lúc 4:31 (lỗi phần cứng ổ SSD) → train dừng ở epoch ~19. Ở epoch 14, mAP50 0,608, gần bằng YOLO11s (0,604): model lớn hơn không giúp. Anh/chị quyết định bỏ, đã xóa toàn bộ kết quả, cấu hình và trọng số `yolo11m.pt`.

### 11.3 Rà soát nguyên nhân (19/11)

- **Lỗi nằm ở khâu phân loại, không phải khoanh box**: loss phân loại trên val tăng lại từ epoch ~75 (0,90 → 0,95) trong khi trên train vẫn giảm (học thuộc nhãn sai); loss box giảm đều.
- **Nhãn sai**: `other` lẫn lon/chai nhựa (Garbage12 `metal`, Open Images), và ngược lại (thùng bia gán `metal`). Do bước lọc CLIP tự động trước đây.
- **Ảnh nền lạc đề**: người, đường phố, xe cộ, động vật… không đúng chủ đề.
- Code train/đánh giá: không thấy lỗi làm sai số liệu.

### 11.4 Làm sạch dữ liệu (19/11, `models/scripts/Xu_Ly_Du_Lieu/`)

| Bước | Script | Kết quả |
| --- | --- | --- |
| B11 | `11_ra_soat_nhan.py` | CLIP (bộ mô tả mới) + model lần 1 chấm 14.137 box → 1.821 box nghi gán sai (không tính Drinking Waste) → `khong_ro/` |
| — | Anh/chị phân loại tay | giữ 1.262 box, xóa 559 box |
| B12 | `12_ap_dung_khong_ro.py` | bỏ 421 ảnh gốc chứa box bị xóa + 59 ảnh zoom cùng vật = **480 ảnh** |
| B13 | `13_loc_lac_de.py` | ảnh nền chỉ giữ tay/vật cận cảnh → bỏ **1.155 ảnh** người, cảnh vật, nhiễu; ảnh có box giữ hết |

Sau đó anh/chị lọc tay thêm 18 ảnh train (ghi trong `_ghi_chep/da_loai.csv`). Kết quả: 10.416 → **8.763 ảnh** (mục 1). Đã kiểm tra: ảnh/nhãn/catalog khớp, không rò rỉ giữa các tập, Ultralytics đọc được. Đã xóa `_da_loai/` và `khong_ro/` (nhật ký ở `data_da_xu_ly/_ghi_chep/`).

### 11.5 Đổi cấu hình train (`cau_hinh.yaml`)

`degrees` 20 → 5, `close_mosaic` 15 → 30, `epochs` 150 → 100, `patience` 30 → 50 (anh/chị đồng ý 19/11). Lý do đổi epoch: lần 1 dừng sớm ở epoch 113 nên learning rate chưa giảm hết (còn 0,0048) và chưa tới giai đoạn tắt mosaic (epoch 135). Với 100 epoch: mosaic tắt từ epoch 71, learning rate giảm trọn. Các tham số khác giữ nguyên (YOLO11s, ảnh 640, batch 16).

### 11.6 Lần 2: `y11s_1119_01` (dữ liệu sạch 8.763 ảnh, cấu hình 11.5)

Train trọn 100/100 epoch trong 2h29m. Epoch tốt nhất là 83; từ epoch 75 trở đi mAP50 đứng yên ở 0,77–0,78. Báo cáo đầy đủ: `models/model/y11s_1119_01/danh_gia/BAO_CAO_TRAIN.md`.

| Chỉ số (val) | Mục tiêu | Lần 1 | Lần 2 |
|---|---|---|---|
| mAP50 (3 lớp) | ≥ 0,85 | 0,793 | 0,779 |
| AP50 nhựa / kim loại / other | — | 0,898 / 0,934 / 0,548 | 0,897 / 0,923 / 0,517 |
| Ngưỡng vận hành | — | 0,85 | 0,80 |
| P / R nhựa (ở ngưỡng vận hành) | ≥ 0,95 / ≥ 0,93 | 0,973 / 0,604 | 0,951 / **0,709** |
| P / R kim loại (ở ngưỡng vận hành) | ≥ 0,95 / ≥ 0,93 | 0,990 / 0,645 | 0,973 / **0,751** |
| R nhựa / kim loại ở **cùng** ngưỡng 0,85 | — | 0,604 / 0,645 | 0,638 / 0,701 |
| Từ chối vật lạ | ≥ 90% | 99,7% | 98,8% |
| GPU | ≥ 20 FPS | 92 | 102 |

Nhận xét:

- **Tiến bộ thật nhưng nhỏ.** So ở cùng ngưỡng 0,85, recall tăng 3–6 điểm. Phần lớn mức tăng hiển thị trong bảng là do ngưỡng vận hành hạ được từ 0,85 xuống 0,80.
- **Model gần như không còn nhầm giữa các nhãn.** Ma trận nhầm lẫn chỉ có 1–8 vật bị nhầm, nhưng bỏ sót nhựa 237 và kim loại 173. Nguyên nhân: model nhận ra vật nhưng độ tự tin dưới ngưỡng.
- **Chỗ sai nằm ở các ảnh khác hẳn cảnh dùng thật:**
  - ảnh đống lon/chai dày đặc (vài chục box);
  - ảnh stock nhiều chai xếp sát nhau;
  - ảnh catalog chỉ gán nhãn một phần;
  - ảnh cảnh COCO/OI gán `other` cho xe máy, sách, màn hình.
- **Ảnh giống cảnh trạm đã đạt mục tiêu.** Nguồn `dw` (một vật, cận cảnh) đạt nhựa P 1,00 / R 0,98, kim loại P 1,00 / R 0,94. Recall thấp đến từ `taco` (0,36 / 0,43), `oi` (0,35 / 0,72), `rf` nhựa (0,43) và vật cỡ vừa/nhỏ.
- **Bỏ bớt ảnh nền không làm hỏng khả năng từ chối vật lạ** (98,8%). Tuy vậy, báo nhầm trên ảnh nền ở ngưỡng 0,80 tăng lên 48 vật (lần 1 ở ngưỡng 0,85 là 16).

### 11.7 Hướng sau lần 2 (anh/chị chốt 19/11)

Trạm nhận **10–15 vật mỗi mẻ**. Theo `controller._process`, chỉ cần có 1 khung other là trả cả mẻ. Vì vậy phải **giữ nhãn `other`**: nếu bỏ, rác sẽ không có khung nào và bị đổ chung vào kho. Bỏ hướng "2 nhãn".

| # | Việc | Trạng thái |
|---|---|---|
| 1 | Định nghĩa lại `other` = rác và đồ có thể bị bỏ vào trạm. Bỏ **ảnh cảnh** (người, phố, phòng) chỉ có vật other nhỏ: `14_bo_sung_nhan.py` đề xuất 173 ảnh | ✅ bỏ 173 ảnh cảnh + ảnh có người do anh/chị xóa (tổng 403 ảnh kể cả họ zoom) |
| 2 | Bổ sung **nhãn còn sót** trong ảnh nhiều vật (taco, oi, coco, rf). Model lần 2 + YOLO-World tìm, CLIP đề xuất nhãn: 2.932 ứng viên trong 1.338 ảnh | ✅ thêm 2.218 box (other 2.127, plastic 81, metal 10). metal/plastic máy đề xuất sai nhiều (~70%), Claude lọc lại 350 ô, anh/chị xác nhận |
| 3 | `02_danh_gia.py` thêm **chấm theo trạm**: ngưỡng riêng cho other, bắt rác, mẻ 12 vật (mục tiêu trong `cau_hinh.yaml` → `muc_tieu_tram`, đề xuất chờ chốt) | ✅ |
| 4 | Train lần 3 `y11s_<ngày>_01` (YOLO11s, cấu hình như lần 2), so sánh theo cách chấm mới | sau bước 1–2 |
| 5 | Module so nền khay `models/scripts/so_nen.py` (OpenCV, tự kiểm tra 5/5 đạt), dùng trong `webcam_demo.py --mode tray` | ✅ viết xong |

**Lần 2 chấm theo trạm (val, ngưỡng nhựa/kim loại 0,80):**

| conf other | Bắt rác | Chai/lon bị other đè | Mẻ sạch 12 vật được nhận | Mẻ 12 vật lẫn 1 rác bị trả |
|---|---|---|---|---|
| 0,10 | 60,7% | 7,3% | 40,3% | 82,9% |
| 0,30 | 50,2% | 5,7% | 49,4% | 73,9% |
| 0,50 | 40,8% | 3,7% | 63,8% | 60,8% |
| 0,80 | 25,8% | 1,0% | 89,2% | 33,2% |

Không ngưỡng nào vừa bắt được rác vừa giữ được mẻ sạch. Trong ảnh nhiều vật, model chỉ bắt được 18–19% số vật other. Nguyên nhân là nhiều vật trong các ảnh này chưa được gán nhãn, nên model học rằng chúng là "nền" (đây chính là việc bước 2 xử lý).

**Lưu ý về so nền:** vùng có vật mà không có khung nhựa/kim loại thì bị **trả lại**. Vì vậy chai/lon bị model bỏ sót cũng làm **trả cả mẻ**. Chỉ nên bật so nền khi recall nhựa/kim loại đã cao, hoặc đổi luật thành "rung và quét lại" trước khi trả.

---

## 12. Các bước tiếp theo

| # | Việc | Ai | Thời gian |
| --- | --- | --- | --- |
| 1 | ✅ Chạy thử nhanh (`01_train.py --thu`) trên dữ liệu mới, đã xóa kết quả thử | Mình | xong 19/11 |
| 2 | ✅ Đánh giá lại model lần 1 trên **val mới** (mục 11.1) | Mình | xong 19/11 |
| 3 | ✅ **Train lần 2** `y11s_1119_01` (dữ liệu sạch + cấu hình mới) ở terminal riêng | Anh/chị bấm | xong 19/11, 2h29m |
| 4 | ✅ Theo dõi, báo tiến độ mỗi 10 epoch | Mình | xong |
| 5 | Đánh giá lần 2 trên val (`02_danh_gia.py y11s_1119_01`), so sánh với lần 1 (mục 2); đặc biệt kiểm tra **từ chối vật lạ** vì đã bỏ phần lớn ảnh nền | Mình | ✅ xong (mục 11.6): chưa đạt |
| 6 | Anh/chị xem báo cáo + ảnh lỗi, quyết định: đạt → bước 8; chưa đạt → bước 7 | Anh/chị | — |
| 7 | Bàn lại hướng (2) đổi baseline (2 nhãn / giữ 3 nhãn nhưng bỏ `other` khỏi mục tiêu / định nghĩa lại `other`) hoặc hướng khác ở mục 6. **Không train YOLO11m** (anh/chị chốt 19/11) | Cùng bàn | ✅ chốt: mục 11.7 (đang làm) |
| 8 | Chạy tập **test** một lần duy nhất (`02_danh_gia.py <tên> --test`), chốt model (`03_chot_model.py`): `best.pt`, ONNX, `MODEL_CARD.md` | Mình | ~10 phút |
| 9 | Viết `webcam_demo.py` và thử với đồ thật (M4 trong `plan_model.md`) | Mình viết, anh/chị thử | plan riêng |
