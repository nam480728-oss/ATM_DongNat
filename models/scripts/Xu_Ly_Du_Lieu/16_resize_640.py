"""B16 — Resize ảnh về cạnh dài 640 px, giữ tỉ lệ (19/11, anh/chị chốt) để duyệt ảnh cùng cỡ với lúc train.

- Ảnh có cạnh dài > 640: thu nhỏ (INTER_AREA), lưu JPEG chất lượng 95. Ảnh ≤ 640: giữ nguyên.
- Nhãn YOLO là toạ độ tỉ lệ 0–1 -> không phải sửa.
- Trước khi ghi đè: chép toàn bộ images/ sang _ghi_chep/anh_goc_truoc_resize/ (chỉ chép lần đầu).
- Xóa labels/*.cache để Ultralytics đọc lại kích thước ảnh mới.

Chạy:  python models/scripts/Xu_Ly_Du_Lieu/16_resize_640.py [--thu]
"""
import argparse
import shutil
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
D = Path(__file__).resolve().parents[2] / "data_da_xu_ly"
GOC = D / "_ghi_chep" / "anh_goc_truoc_resize"
CANH = 640


def resize(p, thu):
    img = cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    m = max(h, w)
    if m <= CANH:
        return "giu", (w, h)
    s = CANH / m
    nw, nh = round(w * s), round(h * s)
    if not thu:
        out = cv2.resize(img, (nw, nh), interpolation=cv2.INTER_AREA)
        ok, buf = cv2.imencode(".jpg", out, [cv2.IMWRITE_JPEG_QUALITY, 95])
        assert ok, p
        buf.tofile(str(p))
    return "resize", (nw, nh)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--thu", action="store_true")
    a = ap.parse_args()
    files = sorted((D / "images").glob("*/*.jpg"))
    print(f"{len(files)} ảnh")
    if not a.thu:
        if GOC.exists():
            print(f"Đã có bản gốc ở {GOC} -> không chép lại")
        else:
            print(f"Chép ảnh gốc sang {GOC} ...")
            shutil.copytree(D / "images", GOC / "images")
    with ThreadPoolExecutor(6) as ex:
        res = list(ex.map(lambda p: resize(p, a.thu), files))
    n = Counter(r[0] for r in res)
    sizes = Counter(r[1] for r in res)
    print(f"{'(chạy thử) ' if a.thu else ''}resize {n['resize']} ảnh, giữ nguyên {n['giu']} ảnh (đã ≤ {CANH})")
    print("kích thước phổ biến:", ", ".join(f"{w}x{h}: {k}" for (w, h), k in sizes.most_common(6)))
    if not a.thu:
        for p in (D / "labels").glob("*.cache"):
            p.unlink()
        print("Xong.")


if __name__ == "__main__":
    main()
