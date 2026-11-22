# Kế hoạch xử lý dữ liệu — Model nhận diện ATM Đồng Nát

> Ngày lập: 18/11/2026. Đầu vào: dữ liệu thô trong `models/data/` (xem `models/data/REPORT.md`).
> Đầu ra: **1 bộ YOLO 3 nhãn** `plastic / metal / other` + ảnh nền + **tập test vật lạ** riêng, sẵn sàng để train YOLO11s.
> Nguyên tắc: **không sửa dữ liệu thô**; mọi thứ sinh ra nằm trong `models/data/processed/`, script chạy lại được, có trang ảnh để anh/chị duyệt bằng mắt ở các bước quan trọng.

---

## ⚙️ Thay đổi khi thực hiện (18/11/2026)

| Plan ban đầu | Thực tế | Lý do |
|---|---|---|
| Grounding DINO (HuggingFace) | **YOLO-World v2-x** (Ultralytics, tải từ GitHub) | huggingface.co bị nhà mạng chặn; YOLO-World cũng là bộ phát hiện theo mô tả chữ, chỉ dùng offline |
| CLIP qua open_clip/HF | **CLIP ViT-L/14 gốc của OpenAI** (gói `clip`) | Như trên |
| Thứ tự B3 CLIP → B4 DINO | B3 YOLO-World → B4 CLIP | Garbage12 cần box trước rồi mới phân loại chất liệu |
| Dừng ở B3/B4 chờ duyệt | Chạy một mạch; **không chắc → `ko_ro/`** (ảnh cắt từng vật, phân loại tay) | Theo yêu cầu 18/11 |
| Chia train/val/test trong bước xử lý | **Chưa chia** — dữ liệu sạch ở `models/data_da_xu_ly/`, chia sau khi anh/chị kiểm tra | Theo yêu cầu 18/11 |
| Box tìm thêm: tự thêm nhãn nếu CLIP ≥ 0,6 | Chỉ tự thêm nhựa/kim loại khi CLIP ≥ 0,9 | Kiểm tra mắt thấy ly bia, pin, bình cứu hỏa bị nhận nhầm |
| Ảnh zoom cho mọi nguồn | Chỉ TACO, Open Images, COCO, Roboflow | Drinking Waste/Garbage12 vốn là ảnh cận nền trơn |
| Cân bằng nhãn (B6) | Để sang bước chia tập/train | Chưa chia tập nên chưa cắt bớt `other` |
| Cân bằng nhãn để sang bước chia tập | **B9 `09_can_bang_other.py`**: chỉ cắt ảnh "chỉ có other" -> tổng box other = 5.500 (plastic/metal giữ nguyên). Thứ tự: bỏ ảnh mờ (độ mờ Crété-Roffet ≥ 0,58) -> trùng (cùng split_key, giữ ảnh nét nhất) -> giống hệt kiểu dáng (CLIP ≥ 0,92, giữ ảnh nét nhất) -> ảnh đông vật ≥ 10 box -> ngẫu nhiên đều theo nhóm (nhóm dễ nhầm được ưu tiên). Ảnh bị cắt -> `other_du_phong/` | Anh/chị duyệt 18/11: other gấp 4–5 lần là quá lệch |
| Ảnh có vật quá nhỏ: tô xám, giữ làm ảnh nền | Roboflow: nếu **mọi** vật đều < 12 px thì bỏ cả ảnh (272 ảnh chụp bãi cát từ trên cao) | Anh/chị duyệt 18/11: vô ích cho camera cận cảnh |

Script: `models/scripts/Xu_Ly_Du_Lieu/01…08` (`common.py` chứa bảng ánh xạ nhãn + prompt). Công cụ: `models/tools/`.

## 0. Tóm tắt

| Bước | Việc | Anh/chị duyệt? |
|---|---|---|
| B0 | Chốt **bảng ánh xạ nhãn** (mục 2) và các con số trong plan | ✅ trước khi chạy |
| B1 | Chuẩn hóa: đọc 7 nguồn về 1 định dạng chung, thu nhỏ ảnh, bỏ ảnh hỏng | — |
| B2 | Khử trùng lặp (ảnh giống nhau, bản nhân 3 của Roboflow, khung video) | — |
| B3 | Lọc bằng CLIP: chai nhựa vs chai thủy tinh (Open Images), lon vs đồ kim loại khác (Garbage12)… | ✅ xem mẫu |
| B4 | Gán box tự động bằng Grounding DINO: Garbage12 (chưa có box) + soát chai/lon "bị sót nhãn" trong ảnh `other` | ✅ xem mẫu |
| B5 | Làm sạch box (box quá nhỏ, tràn biên), tạo ảnh "zoom cận" cho vật nhỏ | — |
| B6 | Cân bằng số lượng theo nhãn và theo nguồn | — |
| B7 | Chia train/val/test 80/10/10 không rò rỉ + tập `unseen_test` | — |
| B8 | Xuất YOLO + `data.yaml`, thống kê, trang ảnh tổng duyệt, train thử 3 epoch | ✅ duyệt cuối |

Ước tính kết quả: **~16–18 nghìn ảnh**, trong đó ~5.000 ảnh có nhựa, ~3.500 ảnh có kim loại, ~7.000 ảnh `other`, ~1.500 ảnh nền (không box) + 600 ảnh test vật lạ.
Thời gian chạy máy: **~2–4 giờ** (phần lâu nhất là CLIP + Grounding DINO chạy trên RTX 4060). Dung lượng thêm: ~5–6 GB.

---

## 1. Hiện trạng dữ liệu thô và vấn đề của từng nguồn

| Nguồn | Có box? | Vấn đề phát hiện | Cách xử lý |
|---|---|---|---|
| Kaggle Drinking Waste (4.811) | ✅ YOLO | Lưu 2 bản (`YOLO_imgs` + `rawimgs`); 8 ảnh `.heic`; ~10 ảnh jpg không có file nhãn; ảnh 1 vật trên nền trơn, ít đa dạng | Chỉ dùng `YOLO_imgs`; bỏ `.heic` và ảnh thiếu nhãn; kiểm tra ID lớp bằng tên file (`AluCan…`, `PET…`); giới hạn số ảnh để model không "nghiện" nền trơn |
| Kaggle Garbage 12 (15.515) | ❌ chỉ nhãn thư mục | Không có box; `clothes` 5.325 ảnh (quá nhiều); thư mục `metal` lẫn đồ kim loại khác lon; `plastic` lẫn túi/màng | Grounding DINO gán box (B4); CLIP tách lon/không lon, chai-hộp/túi (B3); giới hạn mỗi lớp |
| Roboflow bottle-can-detector (2.001) | ✅ YOLO | **Mỗi ảnh gốc bị nhân 3** (chỉ ~670 ảnh gốc); ảnh bị kéo méo về 640×640 | Gom theo tên gốc (`…_jpg.rf.<mã>`), giữ 1 bản/ảnh gốc; cả nhóm vào cùng 1 split |
| Roboflow tin-and-aluminum-cans (679) | ✅ YOLO | Nhân 3 + **khung hình cắt từ video** (`VID_…_0023`) → gần như trùng nhau; có nhiễu muối tiêu, xoay 90° | Giữ 1 bản/ảnh gốc; gom theo tên video để chia split; khử trùng lặp pHash |
| TACO (1.500) | ✅ COCO | Ảnh rất to (~3 MB, ~4000 px); vật thường nhỏ trên nền đất/cỏ; 60 lớp chi tiết | Thu nhỏ cạnh dài 1280 px; ánh xạ 60 lớp (mục 2.2); tạo thêm ảnh "zoom cận" (B5) |
| COCO (4.256) | ✅ COCO | Không có lớp "lon" → ảnh có thể chứa lon chưa gán nhãn; nhiều lớp vật to (giường, xe…) | Soát bằng Grounding DINO (B4); chỉ gán box `other` cho vật cầm tay được (mục 2.4) |
| Open Images (8.776) | ✅ (không đầy đủ) | `Bottle` lẫn thủy tinh/rượu; box `Drink/Wine/Beer` chồng lên chai; nhãn không phủ hết mọi vật | CLIP tách nhựa/thủy tinh (B3); chai thủy tinh → `other` (mẫu khó rất tốt); soát sót nhãn (B4) |

---

## 2. Bảng ánh xạ nhãn (cần anh/chị chốt — B0)

Ký hiệu: **P** = `plastic`, **M** = `metal`, **O** = `other`, **N** = không vẽ box (để làm nền), **X** = bỏ cả ảnh.

### 2.1 Nguyên tắc đề xuất cho các món "lưng chừng"

Vì trạm **trả tiền theo từng món** (không cân), món nhựa/kim loại **quá nhỏ hoặc là mảnh vụn** sẽ bị lợi dụng (bỏ 10 nắp chai lấy tiền 10 chai). Nên đề xuất:

| Món | Đề xuất | Lý do |
|---|---|---|
| Chai nhựa, ly/cốc nhựa (kể cả có ống hút), hộp nhựa đựng đồ ăn, hũ/tub nhựa, hộp Tupperware | **P** | Đồ nhựa thường ngày, nguyên món |
| Lon nhôm, lon thép đựng đồ ăn | **M** | Đúng như đã chốt |
| Nắp chai nhựa, nắp hộp nhựa, ống hút rời, thìa/dĩa nhựa, mảnh nhựa vụn | **O** ✅ | Quá nhỏ → dễ bị lợi dụng (đã chốt 18/11) |
| Túi nilon, màng bọc, vỏ bánh kẹo, túi rác | **O** | Đã chốt túi nilon = other |
| Bình xịt vỏ **nhựa** (bình xịt kiểu vòi bóp, chai xịt) | **P** ✅ | Đã chốt 18/11 |
| Bình xịt vỏ **kim loại** (aerosol, bình sơn xịt), **thùng/hộp sơn kim loại** | **M** ✅ | Đã chốt 18/11 — tách nhựa/kim loại bằng CLIP (B3) |
| Nắp kim loại, khoen kéo lon, giấy bạc, sắt vụn, thìa/dĩa/dao kim loại | **O** ✅ | Kim loại nhưng không phải lon (đã chốt 18/11) |
| Hộp xốp, cốc xốp | **O** | Như danh sách cũ |
| Thủy tinh (chai, ly, mảnh vỡ), hộp giấy, giấy, carton, tetra-pak | **O** | |
| Điện thoại, điều khiển, chuột, máy tính bỏ túi, bàn chải | **O** ✅ | Có vỏ nhựa nhưng không phải đồ nhựa thường ngày (đã chốt 18/11) |
| Người, bàn ăn, giường, xe, nhà cửa… (vật to / phông) | **N** | Làm nền, không vẽ box |
| Tay người | **N** | Ảnh nền có tay — giúp model không nhầm tay là vật |

✅ = đã được anh/chị chốt ngày 18/11/2026.

### 2.2 TACO (60 lớp)

| Lớp TACO | Nhãn |
|---|---|
| Clear plastic bottle, Other plastic bottle | P |
| Disposable plastic cup, Other plastic cup | P |
| Disposable food container, Other plastic container, Spread tub, Tupperware | P |
| Drink can, Food Can | M |
| Plastic bottle cap, Plastic lid, Plastic straw, Plastic utensils, Other plastic | O |
| Plastic film, Other plastic wrapper, Single-use carrier bag, Garbage bag, Crisp packet, Polypropylene bag, Six pack rings | O |
| Aerosol | CLIP tách: vỏ kim loại → M; vỏ nhựa → P; không chắc → X |
| Metal bottle cap, Metal lid, Pop tab, Aluminium foil, Scrap metal, Aluminium/Carded blister pack | O |
| Glass bottle, Glass cup, Glass jar, Broken glass | O |
| Toàn bộ carton, giấy, cốc giấy, ống hút giấy, xốp, Cigarette, Food waste, Shoe, Battery, Rope & strings, Squeezable tube, Plastic glooves | O |
| Unlabeled litter (rác không rõ loại) | O (nếu B4 không thấy chai/lon chồng lên) |

### 2.3 Kaggle

| Nguồn / lớp | Nhãn |
|---|---|
| Drinking Waste `PET`, `HDPEM` | P |
| Drinking Waste `AluCan` | M |
| Drinking Waste `Glass` | O |
| Garbage12 `plastic` | CLIP tách: chai/ly/hộp/bình xịt nhựa → P; túi/màng/đồ nhựa nhỏ → O; không chắc → X |
| Garbage12 `metal` | CLIP tách: lon, bình xịt kim loại, hộp/thùng sơn → M; đồ kim loại khác → O; không chắc → X |
| Garbage12 `battery, biological, brown/green/white-glass, cardboard, paper, clothes, shoes, trash` | O (giới hạn 250 ảnh/lớp) |

### 2.4 Roboflow, COCO, Open Images

| Nguồn / lớp | Nhãn |
|---|---|
| Roboflow `plastic bottle` | P |
| Roboflow `aluminium can`, `tin-and-aluminum-cans` | M |
| COCO — vật cầm tay: apple, banana, orange, broccoli, carrot, donut, cake, sandwich, hot dog, pizza, book, cell phone, remote, mouse, keyboard, scissors, spoon, fork, knife, toothbrush, teddy bear, clock, vase, sports ball, frisbee, handbag, backpack, tie, umbrella, hair drier, baseball glove, baseball bat, kite | O |
| COCO — vật to/phông: person, bed, couch, chair, dining table, bench, car, bicycle, motorcycle, tv, laptop, oven, microwave, toaster, sink, toilet, refrigerator, potted plant, suitcase, skis, snowboard, surfboard, skateboard, tennis racket, bird, cat, dog | N |
| Open Images `Bottle` | CLIP: nhựa → P; thủy tinh/kim loại → O; không chắc → X (bỏ ảnh) |
| Open Images `Tin can` | CLIP kiểm lại: lon → M; không phải lon → X |
| Open Images `Drink`, `Beer`, `Wine`, `Juice`, `Milk` (box chồng lên chai) | Không dùng làm nhãn; chỉ dùng để phát hiện chai/lon chưa gán (B4) |
| Open Images nhóm `other` (34 lớp) | O |
| Open Images `Human hand` | N (ảnh nền có tay) |
| Open Images nhóm `unseen` (10 lớp) | **Không train** → `processed/unseen_test/` |

---

## 3. Chi tiết từng bước

Script đặt trong `models/scripts/process/`, đánh số theo thứ tự; mỗi bước đọc đầu ra bước trước. Định dạng trung gian: **catalog JSONL** — mỗi dòng 1 ảnh:
```json
{"id": "taco/batch_1/000006", "src": "taco", "file": "processed/images/taco/batch_1/000006.jpg",
 "w": 1280, "h": 960, "group": "...", "boxes": [{"cls": "plastic", "src_cls": "Clear plastic bottle", "xyxy": [0.1, 0.2, 0.3, 0.6]}],
 "phash": "…", "dup_of": null, "split_key": "…", "flags": []}
```

### B1 — Chuẩn hóa (`01_normalize.py`)
- Đọc 7 nguồn theo đúng định dạng của từng nguồn (YOLO txt / COCO json / CSV Open Images) → toạ độ box chuẩn `xyxy` 0–1.
- Xoay ảnh theo EXIF, đổi sang RGB, **thu nhỏ cạnh dài ≤ 1280 px** (TACO), lưu JPEG q95 vào `processed/images/<nguồn>/`. Ảnh ≤ 1280 px chỉ chép nguyên.
- Bỏ: ảnh hỏng/không mở được, `.heic`, ảnh Drinking Waste thiếu file nhãn, ảnh < 200 px.
- Drinking Waste: so ID lớp trong file txt với tiền tố tên file; báo nếu lệch.
- Gắn nhãn 3 lớp theo bảng mục 2 (bảng nằm trong `process/class_map.yaml` để sửa không cần sửa code).

### B2 — Khử trùng lặp (`02_dedupe.py`)
- Roboflow: gom ảnh theo tên gốc trước `_jpg.rf.` → giữ **1 bản** (bản đầu tiên theo tên). Kết quả dự kiến ~670 + ~226 ảnh gốc.
- Tính **pHash** cho mọi ảnh; cặp nào khoảng cách Hamming ≤ 6 → coi là trùng, giữ ảnh có nhiều box hơn. Bắt được: khung video liên tiếp, ảnh dùng lại giữa các nguồn (Roboflow/Kaggle hay lấy ảnh của nhau).
- Ghi `split_key` = cụm ảnh gần trùng / tên video → dùng ở B7 để cả cụm vào chung 1 split.

### B3 — Lọc bằng CLIP (`03_clip_filter.py`)
- CLIP (mô hình mở `ViT-L/14`) **chỉ là công cụ lọc dữ liệu offline**, không nằm trong model cuối — model nhận diện vẫn do mình tự train.
- Cắt ảnh theo box (thêm lề 10%), so với các mô tả:
  - Open Images `Bottle`: "a plastic bottle", "a glass bottle", "a wine bottle", "a metal bottle", "a baby bottle"…
  - Open Images `Tin can`, Garbage12 `metal`, TACO `Aerosol`: "an aluminum drink can", "a steel food can", "a metal aerosol spray can", "a paint can" (→ M); "a plastic spray bottle" (→ P); "a metal lid", "a metal spoon", "scrap metal", "aluminum foil" (→ O)…
  - Garbage12 `plastic`: "a plastic bottle", "a plastic cup", "a plastic food container", "a plastic spray bottle" (→ P); "a plastic bag", "plastic wrap", "a plastic bottle cap", "a plastic straw" (→ O)…
- Quy tắc: điểm lớp thắng ≥ 0,6 **và** hơn lớp thứ hai ≥ 0,15 → nhận; còn lại → bỏ ảnh (X). Thà mất ảnh còn hơn sai nhãn.
- Xuất `processed/review/03_clip.html`: mỗi nhóm 60 ảnh ngẫu nhiên + 30 ảnh sát ngưỡng để anh/chị xem.

### B4 — Grounding DINO (`04_autolabel.py`)
Cũng là công cụ offline (mô hình mở `grounding-dino-base`), dùng cho 2 việc:
1. **Gán box cho Garbage12** (chỉ có nhãn thư mục): prompt theo lớp (vd. `bottle . cup . container`), lấy box tốt nhất có điểm ≥ 0,35; ảnh không ra box → bỏ. Mỗi ảnh Garbage12 thường chỉ có 1 vật nên rất ít sai.
2. **Soát sót nhãn** ở ảnh nhóm O/N (COCO, Open Images `other`/`hand`, TACO `Unlabeled litter`): prompt `plastic bottle . plastic cup . aluminum can . tin can`. Ảnh nào phát hiện điểm ≥ 0,4 mà chưa có box P/M → **bỏ ảnh** (không tự thêm nhãn, để tránh nhãn sai). Lý do: chai/lon nằm trong ảnh mà không có box sẽ dạy model "lờ đi chai/lon" — lỗi nguy hiểm nhất.
3. Ảnh của nhóm P/M ở Open Images: box `Drink/Beer` không trùng box chai/lon nào (IoU < 0,5) → kiểm tra bằng CLIP như B3; là chai nhựa/lon → thêm box; còn lại → bỏ ảnh.
- Xuất `processed/review/04_autolabel.html`.

### B5 — Làm sạch box + ảnh zoom cận (`05_boxes.py`)
- Cắt box tràn biên; bỏ box có cạnh < 12 px (tính ở kích thước 640). Nếu box bị bỏ là P/M → **tô xám vùng đó** (để không còn chai/lon không nhãn trong ảnh).
- **Ảnh zoom cận**: webcam sẽ thấy vật **to, gần**, còn TACO/Open Images thường vật nhỏ, xa. Với mỗi box P/M cạnh dài < 25% ảnh, cắt thêm 1 ảnh quanh vật sao cho vật chiếm 30–60% khung (giữ mọi box khác nằm trong khung). Tối đa 1 ảnh zoom/ảnh gốc, cùng `split_key` với ảnh gốc.

### B6 — Cân bằng (`06_balance.py`)
Mục tiêu tỉ lệ số box **P : M : O ≈ 1 : 1 : 1,5** và ảnh nền ≈ 10% tổng. Giới hạn theo nguồn để không nguồn nào áp đảo:

| Nguồn | Giới hạn đề xuất |
|---|---|
| Drinking Waste | 800 ảnh/lớp (nền trơn — không để quá nhiều) |
| Garbage12 lớp O | 250 ảnh/lớp |
| COCO | ~2.500 ảnh `other` + toàn bộ ảnh người làm nền |
| Open Images `other` | ~3.000 ảnh (giữ đủ ≥ 60 ảnh/lớp) |
| TACO, Roboflow, Open Images P/M | giữ hết (P/M là nhãn khan hiếm) |

Ước tính sau cân bằng:

| Nhãn | Ảnh chứa nhãn (≈) | Nguồn chính |
|---|---|---|
| plastic | 5.000 | Drinking Waste, Open Images, Garbage12, TACO, Roboflow |
| metal | 3.500 | Drinking Waste, Open Images Tin can, Roboflow, TACO, Garbage12 |
| other | 7.000 | COCO, Open Images, Garbage12, TACO, Drinking Waste Glass |
| nền (không box) | 1.500 | Open Images Human hand, COCO người, ảnh vật to |

Nếu `metal` thấp hơn nhiều so với `plastic` → dùng ảnh zoom (B5) và lặp ảnh M trong train (oversample ×1,5) chứ không bịa thêm dữ liệu.

### B7 — Chia tập (`07_split.py`)
- **80/10/10** theo `split_key` (cả cụm ảnh trùng, cùng video, ảnh gốc + ảnh zoom luôn chung 1 tập) → không rò rỉ.
- Chia phân tầng theo (nguồn × nhãn chính) để val/test có đủ mọi nguồn.
- Bỏ split gốc của Roboflow (vì đã gộp lại).
- `test` cố định, **không bao giờ dùng để chỉnh tham số**.
- `processed/unseen_test/`: 600 ảnh Open Images `unseen` (bóng đèn, nến, bánh mì, gối, khăn, khung ảnh, đồng hồ, hoa, cà chua, croissant) — đo **tỉ lệ từ chối vật lạ** (mục tiêu ≥ 90%, dưới mức đó → Plan B như `plan_model.md`).

### B8 — Xuất + kiểm tra (`08_export.py`)
```
models/data/processed/merged/
  images/{train,val,test}/<nguồn>__<id>.jpg
  labels/{train,val,test}/<nguồn>__<id>.txt     # YOLO: cls cx cy w h ; ảnh nền = file rỗng
  data.yaml                                     # names: [plastic, metal, other]
  stats.md                                      # số ảnh/box theo nhãn × nguồn × split, phân bố kích thước box
models/data/processed/unseen_test/images/...
models/data/processed/review/08_final.html     # 300 ảnh ngẫu nhiên có vẽ box, lọc được theo nhãn/nguồn
```
- Kiểm tra tự động: mỗi ảnh có file nhãn; toạ độ trong 0–1; không ảnh nào ở 2 split; không ảnh `unseen` lọt vào train.
- **Train thử 3 epoch** YOLO11s (vài phút) để chắc chắn dữ liệu đọc được, loss giảm — chưa phải train thật.

---

## 4. Công cụ cần cài

| Gói | Dùng cho |
|---|---|
| `imagehash` | pHash khử trùng lặp |
| `open_clip_torch` (hoặc `transformers`) | CLIP lọc chất liệu (B3) |
| `transformers` + trọng số `IDEA-Research/grounding-dino-base` (~0,9 GB) | Gán box / soát sót nhãn (B4) |
| `pycocotools` (tùy chọn) | Đọc TACO/COCO |

Cả CLIP và Grounding DINO chỉ chạy **1 lần, offline**, để làm sạch dữ liệu; model chạy trên webcam là YOLO11s do mình tự train.

---

## 5. Các quyết định cần anh/chị chốt

1. ✅ **Món nhựa nhỏ** (nắp chai, nắp hộp, ống hút rời, thìa/dĩa nhựa, mảnh nhựa) → **other**.
2. ✅ **Bình xịt**: vỏ nhựa → **plastic**; vỏ kim loại (aerosol, bình sơn, hộp sơn) → **metal**.
3. ✅ **Kim loại không phải lon** (nắp kim loại, khoen lon, giấy bạc, thìa/dĩa/dao) → **other**.
4. ✅ **Đồ điện tử vỏ nhựa** (điện thoại, điều khiển, chuột…), bàn chải → **other**.
5. ✅ **Ảnh không chắc chắn** ở bước CLIP/Grounding DINO → **bỏ ảnh**.
6. ✅ **Drinking Waste giới hạn 800 ảnh/lớp** (vì nền trơn).
7. ✅ **Có** làm bước **ảnh zoom cận** (B5).
8. ✅ Định dạng đầu ra: **YOLO detection** — `images/{train,val,test}` + `labels/{train,val,test}` (mỗi ảnh 1 file `.txt` cùng tên, mỗi dòng 1 vật `cls cx cy w h`) + `data.yaml`. Bộ ảnh cắt chia 3 thư mục `plastic/metal/other` chỉ sinh thêm nếu phải dùng Plan B.

**Tất cả quyết định đã chốt (18/11/2026).** Bước tiếp: viết các script `models/scripts/process/01…08`, chạy lần lượt và dừng ở B3, B4, B8 để anh/chị xem trang ảnh duyệt.
