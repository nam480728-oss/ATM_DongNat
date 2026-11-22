# MODEL CARD — ATM Đồng Nát: nhận diện nhựa / kim loại / rác khác

- **File:** `best.pt` + `best.onnx` (chép từ `y11s_1119_02/weights/best.pt`, ngày 19/11/2026)
- **Kiến trúc:** YOLO11s, khởi tạo từ trọng số COCO, fine-tune 3 lớp: `0=plastic`, `1=metal`, `2=other`
- **Ảnh vào:** 640 px. **Ngưỡng nhựa/kim loại: 0.85** (chọn trên val: ngưỡng thấp nhất đạt precision nhựa/kim loại và từ chối vật lạ). **Ngưỡng other: 0.80** (chấm theo trạm, mục 5 `BAO_CAO_TRAIN.md`).
- **Luật dùng ở trạm (`app/station/controller.py`, plan_train.md mục 11.7):** mỗi mẻ 10–15 vật đổ lên khay, rung đến khi không chồng nhau rồi chụp. Có khung other ≥ 0.80 -> **TRẢ cả mẻ**; không có -> NHẬN, đếm chai/lon theo khung plastic/metal ≥ 0.85. Tùy chọn: `models/scripts/so_nen.py` so với ảnh khay trống để trả cả vật model không khoanh được.

## Dữ liệu

`models/data_da_xu_ly/` (xem `BAO_CAO.md` ở đó): train 5,838 / val 1,692 / test 829 ảnh; box plastic 3,999, metal 3,364, other 5,569. Nguồn: Kaggle Drinking Waste + Garbage 12, Roboflow, TACO, COCO, Open Images. Tập vật lạ `unseen_test/` (600 ảnh, 10 loại) không dùng để train.

## Train

- 80 epoch (tốt nhất: epoch 67), 1h57m trên RTX 4060 Laptop.
- batch 16, optimizer auto, cos_lr True, mosaic 1.0, mixup 0.1, degrees 5, flipud 0.1, scale 0.5, seed 42.
- Cấu hình đầy đủ: `y11s_1119_02/args.yaml`; biểu đồ: `y11s_1119_02/results.png`; báo cáo: `y11s_1119_02/danh_gia/BAO_CAO_TRAIN.md`.

## Kết quả

| Tập | mAP50 | mAP50-95 | P / R nhựa (ngưỡng 0.85) | P / R kim loại | Từ chối vật lạ |
|---|---|---|---|---|---|
| val | 0.802 | 0.669 | 0.974 / 0.643 | 0.986 / 0.691 | 99.7% |

Tốc độ: GPU 114 khung hình/giây, CPU 17.5 khung hình/giây (ảnh 640).

## Cách dùng

```python
from ultralytics import YOLO
model = YOLO(r"D:\ATM_Dong_Nat\models\model\best.pt")
r = model.predict(frame, imgsz=640, conf=0.80)[0]   # r.boxes.cls: 0 plastic, 1 metal, 2 other
co_rac = any(c == 2 and s >= 0.80 for c, s in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist()))
```

## Giới hạn đã biết

- Ảnh train chủ yếu từ internet, 77% ảnh chỉ có 1 vật; cần thử lại trên khay thật với mẻ 10–15 vật.
- Vật hoàn toàn lạ vẫn có thể không bị phát hiện -> so nền khay (`so_nen.py`) để chặn thêm.
