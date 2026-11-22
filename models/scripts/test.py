"""Thử model train lần 3 (y11s_1119_02, model đang chọn) với 1 ảnh ngoài đời: khoanh vật, đếm chai/lon, tính tiền, báo rác.

Chạy (trong thư mục D:\\ATM_Dong_Nat\\models\\scripts):
  python test.py "D:\\anh\\khay.jpg"
  python test.py "https://.../anh.jpg"
Tùy chọn: --nguong 0.7 (ngưỡng chai/lon), --nguong-other 0.5 (ngưỡng rác).
Mặc định như MODEL_CARD.md: chai/lon 0,85, rác 0,80. Hạ --nguong nếu bỏ sót chai/lon; hạ --nguong-other nếu bỏ sót rác.

Tiền: chai nhựa 200đ, lon nhôm 300đ. Có rác (other) -> không tính tiền, báo có rác.
Không lưu file: hiện ảnh đã khoanh trong cửa sổ, bấm phím bất kỳ (hoặc đóng cửa sổ) để thoát.
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

WEIGHTS = Path(__file__).resolve().parent.parent / "model" / "y11s_1119_02" / "weights" / "best.pt"   # lần 3
GIA = {"plastic": 200, "metal": 300}
TEN = {"plastic": "Chai nhựa", "metal": "Lon nhôm", "other": "RÁC"}
MAU = {"plastic": (0, 200, 0), "metal": (255, 140, 0), "other": (0, 0, 255)}   # BGR: xanh lá, xanh dương, đỏ


def tien(x):
    return f"{x:,}đ".replace(",", ".")


def doc_anh(nguon):
    """Đọc ảnh từ đường dẫn (kể cả tên có dấu tiếng Việt) hoặc link http(s)."""
    if nguon.lower().startswith(("http://", "https://")):
        import urllib.request
        req = urllib.request.Request(nguon, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = np.frombuffer(r.read(), np.uint8)
    else:
        if not Path(nguon).is_file():
            sys.exit(f"Không thấy file ảnh: {nguon}")
        data = np.fromfile(nguon, np.uint8)       # cv2.imread không đọc được đường dẫn có dấu trên Windows
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        sys.exit("Không đọc được ảnh (file hỏng hoặc link không phải ảnh).")
    return img


def ve(img, dets, dong_cuoi, co_rac):
    img = img.copy()
    h, w = img.shape[:2]
    day = max(2, round(max(h, w) / 400))
    co = max(0.5, max(h, w) / 1400)
    for k, (nhan, conf, (x0, y0, x1, y1)) in enumerate(dets, 1):
        c = MAU[nhan]
        cv2.rectangle(img, (x0, y0), (x1, y1), c, day)
        chu = f"{k}.{nhan} {conf:.2f}"
        (tw, th), _ = cv2.getTextSize(chu, cv2.FONT_HERSHEY_SIMPLEX, co, day)
        y = max(th + 6, y0)
        cv2.rectangle(img, (x0, y - th - 6), (x0 + tw + 4, y), c, -1)
        cv2.putText(img, chu, (x0 + 2, y - 4), cv2.FONT_HERSHEY_SIMPLEX, co, (255, 255, 255), day)
    # dải kết quả ở đáy ảnh
    (tw, th), _ = cv2.getTextSize(dong_cuoi, cv2.FONT_HERSHEY_SIMPLEX, co * 1.2, day)
    cv2.rectangle(img, (0, h - th - 20), (w, h), (0, 0, 200) if co_rac else (0, 120, 0), -1)
    cv2.putText(img, dong_cuoi, (10, h - 10), cv2.FONT_HERSHEY_SIMPLEX, co * 1.2, (255, 255, 255), day)
    return img


def main():
    ap = argparse.ArgumentParser(description="Thử model với 1 ảnh: đếm chai/lon, tính tiền, báo rác")
    ap.add_argument("anh", help="đường dẫn ảnh hoặc link http(s)")
    ap.add_argument("--nguong", type=float, default=0.85, help="ngưỡng tin cậy chai/lon (mặc định 0.85)")
    ap.add_argument("--nguong-other", type=float, default=0.80, help="ngưỡng tin cậy rác (mặc định 0.80)")
    a = ap.parse_args()

    import torch
    from ultralytics import YOLO
    img = doc_anh(a.anh.strip().strip('"').strip("'"))
    model = YOLO(str(WEIGHTS))
    r = model.predict(img, imgsz=640, conf=min(a.nguong, a.nguong_other),
                      device=0 if torch.cuda.is_available() else "cpu", verbose=False)[0]

    dets = []
    for c, s, b in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist(), r.boxes.xyxy.tolist()):
        nhan = model.names[int(c)]
        if s >= (a.nguong_other if nhan == "other" else a.nguong):
            dets.append((nhan, s, [round(v) for v in b]))
    dets.sort(key=lambda d: (d[2][1] // 50, d[2][0]))        # đánh số từ trên xuống, trái sang phải
    so = {k: sum(d[0] == k for d in dets) for k in ("plastic", "metal", "other")}
    tong = so["plastic"] * GIA["plastic"] + so["metal"] * GIA["metal"]
    co_rac = so["other"] > 0

    print(f"\nẢnh: {a.anh}  ({img.shape[1]}x{img.shape[0]})")
    for k, (nhan, s, b) in enumerate(dets, 1):
        print(f"  {k:2d}. {TEN[nhan]:<10} tin cậy {s:.2f}")
    if not dets:
        print("  (không thấy chai/lon/rác nào)")
    print("-" * 40)
    print(f"  Chai nhựa : {so['plastic']:2d} x {tien(GIA['plastic'])}")
    print(f"  Lon nhôm  : {so['metal']:2d} x {tien(GIA['metal'])}")
    if co_rac:
        print(f"  Rác       : {so['other']:2d}")
        print("-" * 40)
        print(f"  ⚠️  CÓ {so['other']} VẬT RÁC (khung đỏ) -> KHÔNG TÍNH TIỀN, trả lại cả mẻ.")
        dong = f"CO RAC ({so['other']}) - KHONG TINH TIEN"
    else:
        print("-" * 40)
        print(f"  TỔNG TIỀN : {tien(tong)}  ({so['plastic'] + so['metal']} vật)")
        dong = f"Chai {so['plastic']} | Lon {so['metal']} | Tong {tong:,} d".replace(",", ".")

    hien(ve(img, dets, dong, co_rac), f"{'CÓ RÁC' if co_rac else 'Kết quả'} — bấm phím bất kỳ hoặc đóng cửa sổ để thoát")


def hien(kq, tieu_de):
    """Hiện ảnh trong cửa sổ (matplotlib; OpenCV trên máy là bản không có giao diện nên không dùng cv2.imshow)."""
    import matplotlib
    matplotlib.use("TkAgg")
    import matplotlib.pyplot as plt
    h, w = kq.shape[:2]
    s = min(1.0, 900 / h, 1500 / w)                          # vừa màn hình laptop
    fig = plt.figure(figsize=(w * s / 100, h * s / 100), dpi=100)
    fig.canvas.manager.set_window_title(tieu_de)
    ax = fig.add_axes([0, 0, 1, 1])
    ax.imshow(cv2.cvtColor(kq, cv2.COLOR_BGR2RGB))
    ax.axis("off")
    fig.canvas.mpl_connect("key_press_event", lambda e: plt.close(fig))
    plt.show()


if __name__ == "__main__":
    main()
