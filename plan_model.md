# Kế hoạch model AI nhận diện: nhựa, kim loại, rác khác

> Ngày lập: 18/11/2026 · Cập nhật lần 3: 18/11/2026.
> **Mục tiêu trước mắt:** nhận diện trên **webcam laptop** (cầm vật đưa lên camera). Nối vào trạm 3D để sau.
> **Ràng buộc:** phần nhận diện **phải do mình tự train**, không gọi model có sẵn để thay thế.
> Các quyết định đã chốt ở mục 10.

---

## 0. Tóm tắt

| Hạng mục | Quyết định |
| --- | --- |
| Nhãn | **3 nhãn**: `plastic` (mọi đồ nhựa) · `metal` (lon nhôm và hộp thép) · `other` (mọi thứ khác → từ chối) |
| Model | **YOLO11s tự train** (khởi tạo từ trọng số COCO là chuẩn của "train" fine-tune), trên laptop RTX 4060 8 GB |
| Dữ liệu | Tải tự động bằng script. **Nguồn chính:** Kaggle + Roboflow + TACO. **Nguồn cho `other` và nền:** COCO + Open Images (mục 3) |
| Chặn vật lạ / nền | Theo ý anh/chị: **`other` đa dạng tối đa** + bổ sung ảnh nền, hard negative, bàn tay (mục 1) |
| Sản phẩm bước này | `models/model/best.pt` + `models/scripts/webcam_demo.py` (camera → khung + nhãn + quyết định NHẬN/TỪ CHỐI) |
| Giao diện trạm | ✅ Đã đổi chữ thành "Nhựa / Kim loại" |

---

## 1. Góp ý cho ý tưởng "tăng cường, đa dạng tối đa nhãn `other`"

### 1.1 Đánh giá: hướng đúng, nhưng cần làm đúng cách

👍 **Điểm mạnh**

- Đây là cách chuẩn khi **chỉ được dùng model tự train**: dạy model chủ động nói "cái này KHÔNG phải nhựa/kim loại" (*negative class*), thay vì im lặng.
- Càng nhiều loại vật trong `other`, model càng học được "khái niệm vật thể nói chung". Khi gặp vật lạ, nó có xu hướng vẽ khung `other` hoặc khung độ tin cậy thấp, thay vì bỏ qua.

⚠️ **Rủi ro cần lưu ý**

1. **Không bao giờ phủ hết thế giới** (*open-set*). Vật hoàn toàn mới vẫn có thể không có khung, nên cần thêm luật "mặc định từ chối" ở mục 1.3 (đây là logic, không phải model có sẵn).
2. **Nền và vật lạ là 2 chuyện khác nhau:**
   - *Nền* (tường, bàn, người phía sau) **không được gán nhãn gì cả**. Nếu gán nền là `other`, khung hình nào cũng có `other`, và trạm sẽ từ chối tất cả.
   - *Vật lạ* (điện thoại, chìa khóa cầm trên tay) **mới gán `other`**.
   - Muốn model "quen nền" thì thêm **ảnh nền không có nhãn** (*background images*, khoảng 10% bộ dữ liệu theo khuyến nghị của Ultralytics).
3. **Bàn tay luôn xuất hiện** khi cầm vật trước webcam. Bàn tay và người **không được gán `other`**, nhưng phải **có nhiều ảnh có tay/người** để model học rằng đó là nền.
4. **Mất cân bằng:** `other` quá nhiều làm model "lười", nhìn đâu cũng nói `other` → giảm recall nhựa/kim loại. Giữ `other` ≈ 1–1,5 lần mỗi nhãn kia, phần dư dồn vào ảnh nền.
5. **"Đa dạng" quan trọng hơn "nhiều":** 5.000 ảnh của 300 loại vật khác nhau tốt hơn 20.000 ảnh giấy vụn.

### 1.2 Cách làm `other` tốt nhất (tất cả đều là dữ liệu để train)

| Thành phần | Nguồn | Vai trò |
| --- | --- | --- |
| **Hard negative**: vật *giống* nhựa/kim loại nhưng không phải | chai/cốc **thủy tinh**, cốc sứ, cốc giấy, hộp giấy sữa, lọ thủy tinh, thìa/dĩa kim loại, kéo, chìa khóa, điện thoại | Quan trọng nhất: dạy model ranh giới dễ nhầm |
| **Vật dụng hằng ngày đa dạng** | ~60 lớp COCO (sách, điện thoại, chuột, remote, đồ chơi, trái cây, giày…) + Open Images | Khái niệm "vật thể khác" |
| **Rác không tái chế** | TACO (giấy, xốp, đầu lọc, thức ăn…), Garbage 12 lớp (vải, giày, pin, hữu cơ…) | Đúng ngữ cảnh rác |
| **Ảnh nền không nhãn** (~10%) | ảnh COCO/Open Images phòng ốc, bàn làm việc, người, **bàn tay không cầm gì** | Nền thay đổi không gây báo nhầm |
| **Ảnh tay cầm vật** | COCO/Open Images có người cầm chai/lon/vật (tay để nền, vật gán nhãn) | Đúng tình huống webcam |
| **Tăng cường mạnh** | mosaic, đổi màu/sáng, mờ chuyển động, xoay ±30°, co giãn xa/gần, **copy-paste** (dán vật TACO có mask lên ảnh nền phòng) | Nhân đa dạng nền lên nhiều lần |

### 1.3 Luật quyết định "mặc định từ chối" (logic trong `webcam_demo.py`, không dùng model ngoài)

1. **Ô quét giữa khung hình:** chỉ xét vật nằm trong ô. Nền và người phía sau bị bỏ qua.
2. **Ngưỡng:** `plastic`/`metal` phải có conf ≥ 0,6. Có bất kỳ khung `other` nào (conf ≥ 0,3) trong ô thì từ chối.
3. **Bỏ phiếu khoảng 1 giây (15–20 khung hình):** chỉ NHẬN khi ≥ 80% khung hình ra cùng nhãn hợp lệ.
4. Không đủ chắc chắn (khung chập chờn, conf dao động) thì **từ chối, mời đưa lại**.

### 1.4 Đo xem ý tưởng có hiệu quả không: tập "vật chưa từng thấy"

- Giữ lại khoảng **10 loại vật không bao giờ đưa vào train** (ví dụ lấy từ Open Images: đồng hồ, kính, ví, bút, búp bê, ổ khóa…).
- Đo **tỉ lệ từ chối đúng** trên tập này. Mục tiêu ≥ 90%.
- Nếu không đạt thì nâng cấp lên **phương án B, vẫn 100% tự train**:
  - Model 1: phát hiện **"vật thể" chung (1 lớp)**, train trên mọi vật của mọi bộ dữ liệu. Model phát hiện "có vật" khái quát tốt hơn nhiều so với phân loại 3 nhãn.
  - Model 2: **phân loại** (YOLO11s-cls) 3 nhãn trên ảnh cắt từ khung.
  - Vật lạ: model 1 vẫn khoanh được, model 2 cho conf thấp → từ chối.

### 1.5 Chế độ khay nền cố định (anh/chị đề xuất): camera chĩa xuống khay

Khi có **khay một màu + camera cố định nhìn từ trên xuống**, nền không đổi nữa, nên **so sánh nền dùng lại được**. Đây là xử lý ảnh OpenCV thuần (trừ ảnh, tìm vùng), **không phải model có sẵn**, nên vẫn đúng ràng buộc "tự train".

**Trả lời câu hỏi "chụp gì":**

| Việc | Có cần không | Dùng để làm gì |
| --- | --- | --- |
| Chụp **khay trống** | ✅ **Bắt buộc, nhưng tự động**: lúc khởi động (và mỗi khi khay trống), chương trình tự lấy khoảng 30 khung hình khay trống, tính trung vị làm **ảnh nền**. **Không cần đưa vào dữ liệu train** | Bước so nền khi chạy |
| 50–100 ảnh **khay trống** đưa vào train (không nhãn) | 👍 Nên có (chụp tự động trong 1 phút bằng `webcam_demo.py --capture-bg`) | Model không báo nhầm vân/bóng của khay thành vật |
| 300–500 ảnh **vật đặt trên khay** (nhựa, kim loại, rác khác) **có gán nhãn** | ⭐ Không bắt buộc cho so nền, nhưng **tăng độ chính xác model rõ nhất** (đúng góc nhìn, đúng nền, đúng ánh sáng). Gán nhãn bán tự động: model train từ dữ liệu mạng đề xuất khung, anh/chị chỉ sửa | Model chính xác hơn khi chạy thật |

→ **So nền chỉ cần ảnh khay trống.** Ảnh "rác khác trên khay" là để **model** giỏi hơn, không phải để so nền.

**Cách so nền hoạt động (mỗi lần quét):**

```text
1. Chờ khung hình đứng yên khoảng 0,5 giây (tay đã rút ra, không còn chuyển động)
2. diff = |ảnh hiện tại − ảnh nền|  (tính theo màu Lab + cạnh, để bắt cả chai nhựa trong suốt)
3. Lọc nhiễu, bóng mờ → tìm các vùng "có vật" (contour, diện tích > ngưỡng)
4. Mỗi vùng phải được phủ ≥ 70% bởi một khung plastic/metal của model
     ✔ mọi vùng đều được phủ, không có khung other → NHẬN
     ✘ có vùng không được phủ (vật lạ model không thấy) → TỪ CHỐI
     ✘ có khung other → TỪ CHỐI
5. Khay trống (không vùng nào) → cập nhật lại ảnh nền (bù thay đổi ánh sáng chậm)
```

**Lưu ý khi dựng khay:**

- **Camera phải cố định** (giá đỡ/kẹp). Camera laptop khó chĩa xuống, nên dùng **webcam USB** hoặc **điện thoại làm webcam** (DroidCam, Iriun, Camo…).
- **Màu khay:** chọn màu **nhám (không bóng)**, **ít trùng màu rác**. **Tránh xanh lá** (chai Sprite, 7Up, lon Heineken, chai bia xanh rất phổ biến). Đề xuất **xám đậm hoặc đen nhám**: chai nhựa trong vẫn lộ viền sáng, nhãn chai nổi rõ.
- **Ánh sáng ổn định:** đèn chiếu đều, tránh nắng hắt. Nếu được thì **khóa phơi sáng / cân bằng trắng** của webcam (script sẽ thử tắt auto-exposure qua OpenCV).
- Khay không bị xê dịch. Nếu bị dịch thì bấm `B` để chụp lại nền.

**Kết hợp:** ở chế độ khay, luật quyết định = **so nền + model 3 nhãn + ngưỡng + bỏ phiếu**. So nền chặn được **cả vật model chưa từng thấy**, đúng phần mà `other` đa dạng đến mấy cũng không phủ hết. `webcam_demo.py` sẽ có 2 chế độ: `--mode hand` (cầm tay, nền tự do) và `--mode tray` (khay cố định, có so nền).

---

## 2. Có tự tải từ A–Z được không?

| Nguồn | Tự tải không cần anh/chị làm gì? | Ghi chú |
| --- | --- | --- |
| **TACO** (GitHub) | ✅ Có | Script chính chủ tải ảnh từ Flickr |
| **COCO 2017** | ✅ Có | Tải trực tiếp, không cần tài khoản |
| **Open Images V7** | ✅ Có | Qua FiftyOne / Ultralytics, chọn theo lớp (Bottle, Tin can, Mug, Coffee cup, Plastic bag, Mobile phone…) |
| **Kaggle** (Drinking Waste, Garbage 12 lớp) | ❌ Cần tài khoản + `kaggle.json` | Kaggle bắt buộc đăng nhập để tải. Mình **không được tạo tài khoản hay đăng nhập thay anh/chị** |
| **Roboflow** (bottle-can-detector, tin-alu cans) | ❌ Cần tài khoản + API key | Như trên |

**Hai cách:**

- **Cách 1 (khuyên dùng):** anh/chị làm **một lần, khoảng 5 phút** (mục 3.1). Phần còn lại mình tự động hết. Lý do: bộ Drinking Waste (Kaggle) là bộ chai/lon **sạch nhất, nhãn chuẩn, CC0**, có thì chất lượng `plastic`/`metal` tốt hơn rõ.
- **Cách 2 (không cần làm gì):** chỉ dùng TACO + COCO + Open Images. Lớp `plastic`/`metal` lấy từ TACO và Open Images "Bottle / Tin can". Lớp "Bottle" của Open Images **lẫn chai thủy tinh**, nên mình dùng CLIP tự tách nhựa và thủy tinh. Làm được, nhưng nhãn kém sạch hơn và độ chính xác dự kiến thấp hơn.
- Có thể **bắt đầu ngay bằng cách 2**, khi anh/chị có key thì tải thêm Kaggle/Roboflow và train lại. Không mất công làm lại.

---

## 3. Dữ liệu

### 3.1 Tài khoản (chỉ cho cách 1)

| Nguồn | Cần làm | Đặt ở đâu |
| --- | --- | --- |
| Kaggle | Đăng nhập [kaggle.com](https://www.kaggle.com) → Settings → API → **Create New Token** (tải `kaggle.json`). Mở 2 trang dataset và bấm Download một lần nếu được hỏi đồng ý điều khoản | `C:\Users\PREDATOR\.kaggle\kaggle.json` |
| Roboflow | Đăng nhập [app.roboflow.com](https://app.roboflow.com) → Settings → API Keys → copy ([hướng dẫn](https://docs.roboflow.com/developer/python-sdk/download-a-dataset)) | Dòng `ROBOFLOW_API_KEY=...` trong `.env` (không bị đẩy lên GitHub) |

### 3.2 Danh sách bộ dữ liệu

| Bộ | Nguồn | → `plastic` | → `metal` | → `other` / nền |
| --- | --- | --- | --- | --- |
| [Drinking Waste](https://www.kaggle.com/datasets/arkadiyhacks/drinking-waste-classification) (~4.800, CC0) | Kaggle | PET, HDPE | Aluminium can | Glass bottle |
| [Garbage 12 lớp](https://www.kaggle.com/datasets/mostafaabla/garbage-classification) (~15.000) | Kaggle | plastic (lọc CLIP) | metal (lọc CLIP) | paper, cardboard, glass, clothes, shoes, batteries, biological, trash |
| [bottle-can-detector](https://universe.roboflow.com/jidapa-thonglek/bottle-can-detector) (~2.000) | Roboflow | plastic bottle | aluminium can | – |
| [tin and aluminum cans](https://universe.roboflow.com/national-cheng-kung-university-wjot1/tin-and-aluminum-cans) | Roboflow | – | tin / aluminum can | – |
| [TACO](https://github.com/pedropro/TACO) (~1.500) | GitHub | chai/ly/hộp nhựa | Drink can, Food can | giấy, xốp, túi, thủy tinh, đầu lọc, thức ăn… |
| [COCO 2017](https://cocodataset.org) | trực tiếp | – | – | ~60 lớp vật dụng (bỏ `bottle`, `cup`, `wine glass`, `bowl` vì không rõ chất liệu; bỏ ảnh có các vật đó) + ảnh nền có người/tay |
| [Open Images V7](https://docs.voxel51.com/dataset_zoo/datasets/open_images_v7.html) | trực tiếp | Bottle (CLIP tách nhựa) | Tin can | Mug, Coffee cup, Mobile phone, Glasses, Watch… + ảnh nền + **tập vật chưa thấy (mục 1.4)** |

**Thư mục lưu (theo yêu cầu: mỗi nguồn một thư mục, đặt tên theo nguồn):**

```text
D:\ATM_Dong_Nat\models\data\
├─ kaggle\       drinking_waste\  garbage12\
├─ roboflow\     bottle_can_detector\  tin_aluminum_cans\
├─ taco\         annotations.json  images\  (✅ đang tải)
├─ coco\         (tập con cho other + ảnh nền)
├─ openimages\   (tập con cho other + tập vật chưa thấy)
└─ merged\       bộ gộp cuối cùng để train (images/ labels/ dataset.yaml)
```

`models/data/` đã thêm vào `.gitignore` nên không bị đẩy lên GitHub.

Cách xử lý tự động: chuyển định dạng → ánh xạ lớp (`class_map.yaml`) → CLIP lọc/tách chất liệu → Grounding DINO vẽ khung cho bộ chỉ có thư mục → bỏ trùng (`imagehash`) → cân bằng → chia **80/10/10**.

### 3.3 Quy mô dự kiến

| Thành phần | Số ảnh/vật |
| --- | --- |
| `plastic` | ~4.000–5.000 vật |
| `metal` | ~3.000–4.000 vật |
| `other` | ~5.000–6.000 vật, **≥ 300 loại vật khác nhau** |
| Ảnh nền không nhãn | ~10% tổng số ảnh |
| Tập vật chưa thấy (chỉ để test) | ~500 ảnh, ~10 loại |

---

## 4. Huấn luyện (laptop RTX 4060 8 GB)

| Mục | Giá trị |
| --- | --- |
| Model | `yolo11s.pt` → fine-tune 3 lớp |
| Ảnh / batch | `imgsz=640`, `batch=16` (thiếu VRAM thì giảm còn 8) |
| Epoch | 100–150, `patience=25` |
| Augment | `degrees=30, fliplr=0.5, hsv_h=0.02, hsv_s=0.6, hsv_v=0.4, scale=0.5, mosaic=1.0, mixup=0.1, copy_paste=0.3` + làm mờ chuyển động |
| Thời gian | ~3–5 giờ |

**Tiêu chí đạt:**

| Chỉ số | Mục tiêu |
| --- | --- |
| mAP50 (3 lớp, tập test) | ≥ 0,85 |
| Recall `plastic`, `metal` | ≥ 0,93 |
| Precision `plastic`, `metal` | ≥ 0,95 |
| **Từ chối đúng trên tập vật chưa thấy** | ≥ 90% |
| Webcam | ≥ 20 khung hình/giây |
| Thử thật | ~30 món đồ trong nhà đưa lên webcam, ghi tỉ lệ đúng |

---

## 5. Sản phẩm bước này: nhận diện trên webcam

`python models/scripts/webcam_demo.py`:

- Mở webcam laptop, vẽ **ô quét** giữa khung hình.
- Vẽ khung và nhãn (**Nhựa** xanh lá, **Kim loại** xanh dương, **Rác khác** đỏ) kèm độ tin cậy, FPS.
- Thanh bỏ phiếu khoảng 1 giây, rồi hiện kết quả lớn: **✅ NHẬN – Nhựa** / **✅ NHẬN – Kim loại** / **❌ TỪ CHỐI – Rác khác / Không chắc chắn**.
- Phím: `S` lưu ảnh khung hình (để sau này bổ sung dữ liệu), `Q` thoát.

Nối vào trạm (để sau): trang trạm bật webcam, gửi khung hình lên `YoloDetector`. `CLASS_MAP` / `LABEL_VI` đã sẵn sàng.

---

## 6. Lộ trình

| Bước | Việc | Ai |
| --- | --- | --- |
| M1 | Cài môi trường (`ultralytics`, `fiftyone`, `open_clip`, `kaggle`, `roboflow`); tải TACO + COCO + Open Images | Mình (tự động) |
| M1b | (Cách 1) Đặt `kaggle.json` + `ROBOFLOW_API_KEY`, sau đó mình tải Kaggle/Roboflow | Anh/chị 5 phút → mình |
| M2 | Ánh xạ lớp, CLIP lọc, auto-label, bỏ trùng, cân bằng, chia tập + báo cáo thống kê | Mình |
| M3 | Train YOLO11s, báo cáo mAP, ma trận nhầm lẫn, tỉ lệ từ chối vật chưa thấy | Mình |
| M4 | `webcam_demo.py`, anh/chị cầm đồ thử | Mình + anh/chị |
| M5 | (Nếu M3/M4 chưa đạt) phương án B hai model, hoặc thêm dữ liệu hard negative | Mình |
| Sau | Nối vào trạm 3D | Mình |

Dung lượng ổ đĩa cần khoảng **25–40 GB** (COCO đầy đủ khoảng 20 GB; nếu chỉ lấy tập con thì khoảng 8 GB).

---

## 7. Đã thay đổi trong code (18/11/2026)

- Chữ giao diện đổi thành **Nhựa / Kim loại**: màn hình trạm, tấm hướng dẫn 3D, bảng rác cầm tay, lỗ bỏ, trang chủ, admin. Bỏ "cốc nhựa" khỏi KHÔNG NHẬN.
- `config.py`: `CLASS_MAP` thêm `plastic → bottle`, `metal → can`; `LABEL_VI` thêm Nhựa / Kim loại / Rác khác / Vật lạ. 44 test đạt.

## 8. Ghi chú mô phỏng 3D

Vật mẫu và bộ nhận diện giả (`DETECTOR=mock`) giữ nguyên. Riêng "Cốc nhựa có ống hút" nay được tính là **nhựa** (đã sửa `itemFactory.js` + `CLASS_MAP`).

---

## 9. Việc anh/chị cần làm

1. **Kaggle:** kaggle.com → avatar → **Settings** → mục **API** → **Create New Token** → file `kaggle.json` tải về → chép vào `C:\Users\PREDATOR\.kaggle\kaggle.json` (tạo thư mục `.kaggle` nếu chưa có). Mở 2 trang dataset (mục 3.2), bấm **Download** một lần nếu Kaggle hỏi đồng ý điều khoản.
2. **Roboflow:** app.roboflow.com → **Settings** → **API Keys** → copy **Private API Key** → thêm dòng `ROBOFLOW_API_KEY=<key>` vào `D:\ATM_Dong_Nat\.env`.
3. (Chế độ khay) Chọn khay và cách gắn camera theo mục 1.5.

---

## 10. Quyết định đã chốt

| # | Nội dung | Trả lời |
| --- | --- | --- |
| 1 | Dữ liệu riêng | Ghép sau (`models/data/raw/custom/` → chạy lại script gộp) |
| 2 | Phạm vi nhựa | Mọi đồ nhựa, cùng giá |
| 3 | Nhôm và thép | Cùng nhãn `metal`, cùng giá |
| 4 | Thủy tinh, tetra-pak | `other` |
| 5 | Còn nước | Không quan tâm |
| 6 | Ảnh tự chụp / render 3D | Không dùng |
| 7 | Máy | Laptop RTX 4060, YOLO11s |
| 8 | Số nhãn | 3 |
| 9 | So ảnh nền | Bỏ (nền webcam thay đổi) |
| 10 | Chữ giao diện | Nhựa / Kim loại ✅ |
| 11 | Mục tiêu trước mắt | **Nhận diện trên webcam**, nối trạm sau |
| 12 | Model có sẵn làm canh gác (YOLOE…) | **Không dùng**, mọi model phải tự train |
| 13 | Chặn vật lạ | `other` đa dạng tối đa + ảnh nền + hard negative + luật "mặc định từ chối" (mục 1) |
| 14 | Tải dữ liệu | Cách 1 (Kaggle + Roboflow + TACO; thêm COCO/Open Images cho `other`), lưu ở `D:\ATM_Dong_Nat\models\data\<nguồn>\` |
| 15 | Túi nilon / ly có ống hút | Túi nilon → `other` · Ly nhựa có ống hút → `plastic` (mô phỏng 3D đã sửa: món này giờ được nhận) |
| 16 | Chế độ khay nền cố định | Đang cân nhắc. Hỗ trợ cả `--mode hand` và `--mode tray` (so nền, mục 1.5) |

---

### Nguồn tham khảo

- [Drinking Waste – Dataset Ninja](https://datasetninja.com/drinking-waste) · [Papers with Code](https://paperswithcode.com/dataset/drinking-waste-classification) · [Kaggle](https://www.kaggle.com/datasets/arkadiyhacks/drinking-waste-classification)
- [Garbage Classification 12 lớp (model card nhắc nguồn Kaggle)](https://huggingface.co/kendrickfff/my_resnet50_garbage_classificationv1.2)
- [TACO paper](https://arxiv.org/pdf/2003.06975) · [TACO GitHub](https://github.com/pedropro/TACO)
- [bottle-can-detector](https://universe.roboflow.com/jidapa-thonglek/bottle-can-detector) · [tin and aluminum cans](https://universe.roboflow.com/national-cheng-kung-university-wjot1/tin-and-aluminum-cans)
- [Roboflow – tải dataset bằng Python (cần API key)](https://docs.roboflow.com/developer/python-sdk/download-a-dataset)
- [Open Images V7 – FiftyOne](https://docs.voxel51.com/dataset_zoo/datasets/open_images_v7.html) · [Open Images V7 – Ultralytics](https://docs.ultralytics.com/ru/datasets/detect/open-images-v7)
- [Autodistill (Roboflow)](https://blog.roboflow.com/autodistill/)
