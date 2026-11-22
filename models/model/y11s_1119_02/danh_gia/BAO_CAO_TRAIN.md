# Báo cáo train — y11s_1119_02

## 1. Quá trình train

- Trạng thái: **xong**, 80/80 epoch, tổng 1h57m (bắt đầu 2026-11-19 17:48:40).
- Epoch tốt nhất: **67** (val mAP50 0.802, mAP50-95 0.669).
- Biểu đồ: `../results.png` (loss, mAP theo epoch), `../confusion_matrix*.png`, `../BoxPR_curve.png`.

## 2. Tiêu chí đạt

| Chỉ số | Mục tiêu | val |
|---|---|---|
| mAP50 (3 lớp) | ≥ 0.850 | 0.802 ❌ |
| Precision nhựa (ngưỡng vận hành) | ≥ 0.950 | 0.974 ✅ |
| Recall nhựa (ngưỡng vận hành) | ≥ 0.930 | 0.643 ❌ |
| Precision kim loại (ngưỡng vận hành) | ≥ 0.950 | 0.986 ✅ |
| Recall kim loại (ngưỡng vận hành) | ≥ 0.930 | 0.691 ❌ |
| Từ chối đúng vật lạ (unseen_test) | ≥ 90.0% | 99.7% ✅ |
| Tốc độ GPU (khung hình/giây) | ≥ 20 | 114 ✅ |

Ngưỡng conf vận hành: **0.85** — ngưỡng thấp nhất đạt precision nhựa/kim loại và từ chối vật lạ. Tốc độ CPU tham khảo: 17.5 khung hình/giây.

## 3. Chi tiết tập val (1692 ảnh, trọng số best.pt)

**mAP chính thức (Ultralytics):** mAP50 0.802, mAP50-95 0.669. AP50 nhựa 0.902, AP50 kim loại 0.932, AP50 other 0.573. Biểu đồ PR / ma trận nhầm lẫn: `val/`.

**Ở ngưỡng 0.85:**

| Nhãn | Precision | Recall | Đúng | Báo nhầm | Bỏ sót |
|---|---|---|---|---|---|
| nhựa | 0.974 | 0.643 | 532 | 14 | 295 |
| kim loại | 0.986 | 0.691 | 486 | 7 | 217 |
| other | 0.957 | 0.169 | 178 | 8 | 878 |

**Ma trận nhầm lẫn** (hàng = nhãn đúng, cột = model đoán):

| Đúng \ Đoán | nhựa | kim loại | other | bỏ sót |
|---|---|---|---|---|
| nhựa | 532 | 1 | 2 | 292 |
| kim loại | 1 | 486 | 1 | 215 |
| other | 5 | 3 | 178 | 870 |
| nền (không có vật) | 8 | 3 | 5 | — |

**Theo nguồn dữ liệu:**

| Nguồn | P nhựa | R nhựa | P kim loại | R kim loại | R other |
|---|---|---|---|---|---|
| coco | — | 0.00 | — | 0.00 | 0.01 |
| dw | 1.00 | 0.98 | 1.00 | 0.91 | 0.70 |
| g12 | 0.92 | 0.58 | 0.89 | 0.40 | 0.37 |
| oi | 0.89 | 0.16 | 0.99 | 0.69 | 0.12 |
| rf | 1.00 | 0.37 | 1.00 | 0.86 | 0.02 |
| taco | 0.87 | 0.24 | 1.00 | 0.24 | 0.07 |

**Recall theo kích thước vật** (cạnh quy về ảnh 640):

| Nhãn | Kích thước | Số vật | Recall |
|---|---|---|---|
| kim loại | lớn (>96²) | 619 | 0.75 |
| kim loại | nhỏ (<32²) | 12 | 0.00 |
| kim loại | vừa | 72 | 0.29 |
| nhựa | lớn (>96²) | 727 | 0.66 |
| nhựa | nhỏ (<32²) | 7 | 0.00 |
| nhựa | vừa | 93 | 0.58 |

**Từ chối đúng vật lạ:** 99.7% — Bread 98%, Light bulb 98%, Candle 100%, Clock 100%, Croissant 100%, Flower 100%, Picture frame 100%, Pillow 100%, Tomato 100%, Towel 100%

**Quét ngưỡng:** biểu đồ `quet_nguong_val.png`

| conf | P nhựa | R nhựa | P kim loại | R kim loại | Từ chối vật lạ |
|---|---|---|---|---|---|
| 0.30 | 0.791 | 0.848 | 0.841 | 0.895 | 85.8% |
| 0.35 | 0.809 | 0.838 | 0.859 | 0.890 | 87.2% |
| 0.40 | 0.822 | 0.831 | 0.877 | 0.883 | 88.0% |
| 0.45 | 0.839 | 0.823 | 0.890 | 0.876 | 90.7% |
| 0.50 | 0.871 | 0.811 | 0.908 | 0.871 | 93.0% |
| 0.55 | 0.886 | 0.805 | 0.917 | 0.861 | 94.3% |
| 0.60 | 0.899 | 0.793 | 0.924 | 0.842 | 95.0% |
| 0.65 | 0.905 | 0.780 | 0.936 | 0.829 | 96.5% |
| 0.70 | 0.922 | 0.767 | 0.942 | 0.812 | 96.8% |
| 0.75 | 0.934 | 0.732 | 0.957 | 0.792 | 97.8% |
| 0.80 | 0.945 | 0.703 | 0.965 | 0.752 | 98.7% |
| 0.85 ◀ | 0.974 | 0.643 | 0.986 | 0.691 | 99.7% |
| 0.90 | 1.000 | 0.342 | 0.992 | 0.351 | 100.0% |

**Ảnh lỗi:** 100 ảnh sai nhiều nhất trong `loi_val/` (khung vàng = nhãn đúng, khung màu = model đoán: xanh lá nhựa, xanh dương kim loại, đỏ other).
**Tốc độ:** GPU 8.8 ms/ảnh (114 FPS), CPU 57 ms/ảnh.

## 5. Chấm theo trạm (val)

Mô phỏng `controller._process`: ảnh có box other ≥ ngưỡng other → **trả cả mẻ**; không có → nhận cả mẻ, trả tiền theo box nhựa/kim loại ≥ 0.85. Mẻ 12 vật là **ước tính**: (1 − other giả trên từng chai/lon)^12 × (1 − other giả trên nền), coi các vật độc lập.

Ngưỡng other: **0.80** (thấp nhất mà mẻ sạch 12 vật được nhận ≥ 90%; không ngưỡng nào đạt thì lấy ngưỡng có tỉ lệ nhận cao nhất).

| Chỉ số | Mục tiêu | Kết quả |
|---|---|---|
| Bắt được rác (từng vật other, 1056 vật) | ≥ 95% | 23.7% |
| Rác bị gọi nhầm là nhựa/kim loại | — | 0.8% |
| Chai/lon bị box other giả đè lên (1530 vật) | — | 1.1% |
| Ảnh sạch có box other giả trên nền (1079 ảnh) | — | 0.1% |
| Ảnh có rác bị trả đúng (613 ảnh) | — | 36.4% |
| Ảnh sạch được nhận (1079 ảnh) | — | 99.0% |
| Ảnh sạch được nhận **và đếm đúng hết** chai/lon | — | 77.7% |
| Vật lạ (unseen) bị bắt thành other | — | 21.0% |
| Ước tính: mẻ sạch 12 vật được nhận | ≥ 90% | 87.4% |
| Ước tính: mẻ 12 vật lẫn 1 rác bị trả | ≥ 95% | 32.6% |

**Quét ngưỡng other:**

| conf other | Bắt rác | Chai/lon bị other đè | Other giả trên nền | Mẻ sạch 12 vật nhận | Mẻ lẫn 1 rác bị trả | Vật lạ bắt thành other |
|---|---|---|---|---|---|---|
| 0.05 | 72.1% | 9.9% | 15.1% | 24.2% | 92.5% | 95.2% |
| 0.10 | 66.7% | 9.1% | 10.3% | 28.6% | 89.5% | 91.7% |
| 0.15 | 62.6% | 8.6% | 7.4% | 31.4% | 87.2% | 87.7% |
| 0.20 | 59.6% | 7.9% | 5.9% | 35.0% | 84.6% | 83.0% |
| 0.25 | 57.3% | 7.3% | 4.9% | 38.2% | 82.4% | 78.8% |
| 0.30 | 54.2% | 6.7% | 3.6% | 42.1% | 79.3% | 76.0% |
| 0.40 | 48.1% | 4.8% | 2.4% | 53.8% | 70.6% | 67.2% |
| 0.50 | 42.7% | 3.7% | 1.4% | 62.5% | 62.8% | 56.2% |
| 0.60 | 37.0% | 2.6% | 0.8% | 72.2% | 53.3% | 45.8% |
| 0.70 | 31.2% | 2.0% | 0.5% | 77.9% | 45.3% | 34.2% |
| 0.80 ◀ | 23.7% | 1.1% | 0.1% | 87.4% | 32.6% | 21.0% |
