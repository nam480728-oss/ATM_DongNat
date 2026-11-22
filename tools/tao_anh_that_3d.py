"""Cắt ảnh chụp THẬT của chai / lon / rác từ bộ dữ liệu train để dán lên khối 3D trong mô phỏng.

Model YOLO học trên ảnh chụp thật -> vật vẽ bằng code khó nhận ra. Mô phỏng dùng hình khối 3D (chai, lon, hộp...)
phủ ảnh thật nhìn từ trên xuống, nên camera buồng quét chụp ra ảnh gần giống ảnh thật.

Chỉ lấy ảnh tập TRAIN (không đụng val/test), ảnh có đúng 1 vật. Kết quả:
  app/static/textures/real/<loai>/NNN.jpg  +  app/static/textures/real/manifest.json
Chạy:  python tools/tao_anh_that_3d.py
"""
import csv
import json
import random
import shutil
import sys
from pathlib import Path

import cv2
import numpy as np

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "models" / "data_da_xu_ly"
OUT = ROOT / "app" / "static" / "textures" / "real"

# loại texture: (nhóm trong catalog, lớp nhãn, tỉ lệ dài/rộng của khung (min, max), số ảnh)
KINDS = {
    "can": (["dw:AluCan", "g12:metal"], 1, (1.35, 2.9), 40),
    "pet": (["dw:PET", "g12:plastic"], 0, (2.2, 4.8), 40),
    "glass": (["dw:Glass", "g12:green-glass", "g12:brown-glass"], 2, (2.2, 5.0), 24),
    "carton": (["g12:cardboard"], 2, (1.0, 2.2), 20),
    "paper": (["g12:paper"], 2, (1.0, 2.5), 16),
    "trash": (["g12:trash"], 2, (1.0, 2.6), 20),
}
LONG = 512   # cạnh dài ảnh cắt


def read(p):
    return cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)


def fill_ratio(img, box):
    """Tỉ lệ khung là vật (GrabCut khởi tạo bằng khung): vật nằm thẳng trục ~0,9; nằm chéo ~0,5."""
    x1, y1, x2, y2 = box
    pad = 12
    H, W = img.shape[:2]
    X1, Y1, X2, Y2 = max(0, x1 - pad), max(0, y1 - pad), min(W, x2 + pad), min(H, y2 + pad)
    sub = img[Y1:Y2, X1:X2]
    s = min(1.0, 320 / max(sub.shape[:2]))
    sub = cv2.resize(sub, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    rect = (round((x1 - X1) * s), round((y1 - Y1) * s), max(2, round((x2 - x1) * s)), max(2, round((y2 - y1) * s)))
    mask = np.zeros(sub.shape[:2], np.uint8)
    try:
        cv2.grabCut(sub, mask, rect, np.zeros((1, 65)), np.zeros((1, 65)), 3, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return 0.0
    fg = (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)
    rx, ry, rw, rh = rect
    return float(fg[ry:ry + rh, rx:rx + rw].mean())


def color_bin(crop, mask):
    """Nhóm màu chủ đạo của vật: 0–7 theo sắc độ, 8 = xám/trắng/trong suốt."""
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    sel = mask > 127
    if sel.sum() < 50:
        return 8
    h, s = hsv[..., 0][sel], hsv[..., 1][sel]
    colored = s > 80
    if colored.mean() < 0.3:
        return 8
    return int(np.median(h[colored]) // 23)


def object_mask(img, box):
    """Mặt nạ vật trong khung (255 = vật, 0 = nền) bằng GrabCut, làm mượt mép -> dùng làm alphaMap trong 3D."""
    x1, y1, x2, y2 = box
    pad = 16
    H, W = img.shape[:2]
    X1, Y1, X2, Y2 = max(0, x1 - pad), max(0, y1 - pad), min(W, x2 + pad), min(H, y2 + pad)
    sub = img[Y1:Y2, X1:X2]
    s = min(1.0, 480 / max(sub.shape[:2]))
    small = cv2.resize(sub, None, fx=s, fy=s, interpolation=cv2.INTER_AREA)
    rect = (max(1, round((x1 - X1) * s)), max(1, round((y1 - Y1) * s)),
            max(2, round((x2 - x1) * s) - 2), max(2, round((y2 - y1) * s) - 2))
    m = np.zeros(small.shape[:2], np.uint8)
    try:
        cv2.grabCut(small, m, rect, np.zeros((1, 65)), np.zeros((1, 65)), 5, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return np.zeros((y2 - y1, x2 - x1), np.uint8)
    fg = (((m == cv2.GC_FGD) | (m == cv2.GC_PR_FGD)) * 255).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    n, lb, st, _ = cv2.connectedComponentsWithStats(fg)      # giữ mảng lớn nhất
    if n > 1:
        k = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
        fg = ((lb == k) * 255).astype(np.uint8)
    fg = cv2.morphologyEx(fg, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    fg = cv2.resize(fg, (X2 - X1, Y2 - Y1), interpolation=cv2.INTER_LINEAR)
    return cv2.GaussianBlur(fg[y1 - Y1:y2 - Y1, x1 - X1:x2 - X1], (5, 5), 0)


def main():
    rows = list(csv.DictReader(open(DATA / "catalog.csv", encoding="utf-8")))
    rng = random.Random(42)
    if OUT.exists():
        shutil.rmtree(OUT)
    manifest = {}
    for kind, (groups, cls, (amin, amax), n) in KINDS.items():
        cands = [r for r in rows if r["split"] == "train" and r["group"] in groups
                 and sum(int(r[k]) for k in ("n_plastic", "n_metal", "n_other")) == 1]
        rng.shuffle(cands)
        (OUT / kind).mkdir(parents=True)
        files, bins = [], {}
        for r in cands:
            if len(files) >= n:
                break
            lines = (DATA / "labels" / "train" / f"{r['id']}.txt").read_text().split()
            c, x, y, w, h = int(lines[0]), *map(float, lines[1:5])
            if c != cls:
                continue
            img = read(DATA / "images" / "train" / f"{r['id']}.jpg")
            H, W = img.shape[:2]
            bw, bh = w * W, h * H
            a = max(bw, bh) / max(1, min(bw, bh))
            if not (amin <= a <= amax) or min(bw, bh) < 60:
                continue
            x1, y1 = int(max(0, (x - w / 2) * W)), int(max(0, (y - h / 2) * H))
            x2, y2 = int(min(W, (x + w / 2) * W)), int(min(H, (y + h / 2) * H))
            if kind in ("can", "pet", "glass") and fill_ratio(img, (x1, y1, x2, y2)) < 0.7:
                continue                                  # vật nằm chéo trong khung -> góc ảnh cắt toàn nền
            crop = img[y1:y2, x1:x2]
            mask = object_mask(img, (x1, y1, x2, y2))
            if mask.mean() / 255 < 0.45:                  # tách nền thất bại
                continue
            if crop.shape[0] > crop.shape[1]:            # luôn để cạnh dài nằm ngang (vật nằm dọc trục X)
                crop = cv2.rotate(crop, cv2.ROTATE_90_CLOCKWISE)
                mask = cv2.rotate(mask, cv2.ROTATE_90_CLOCKWISE)
            s = LONG / crop.shape[1]
            size = (LONG, max(8, round(crop.shape[0] * s)))
            crop = cv2.resize(crop, size, interpolation=cv2.INTER_AREA)
            mask = cv2.resize(mask, size, interpolation=cv2.INTER_LINEAR)
            # đa dạng bao bì: mỗi nhóm màu (8 dải màu + 1 nhóm xám/trong) tối đa ~1/5 số ảnh
            bin_ = color_bin(crop, mask) if kind in ("can", "pet") else 0
            if kind in ("can", "pet") and bins.get(bin_, 0) >= max(3, n // 5):
                continue
            bins[bin_] = bins.get(bin_, 0) + 1
            name = f"{len(files):03d}"
            ok, buf = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 88])
            buf.tofile(str(OUT / kind / f"{name}.jpg"))
            ok, buf = cv2.imencode(".png", mask)
            buf.tofile(str(OUT / kind / f"{name}_m.png"))
            files.append({"file": f"{kind}/{name}.jpg", "mask": f"{kind}/{name}_m.png",
                          "aspect": round(crop.shape[1] / crop.shape[0], 3), "src": r["id"]})
        manifest[kind] = files
        print(f"{kind:7s}: {len(files)} ảnh (ứng viên {len(cands)})")
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    size = sum(p.stat().st_size for p in OUT.rglob("*.jpg")) / 2**20
    print(f"Xong: {OUT} ({size:.1f} MB)")


if __name__ == "__main__":
    main()
