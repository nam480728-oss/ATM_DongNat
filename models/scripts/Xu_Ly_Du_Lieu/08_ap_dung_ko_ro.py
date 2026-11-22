"""B8 — Áp dụng kết quả anh/chị phân loại tay trong models/data_da_xu_ly/ko_ro/.

Anh/chị kéo từng ảnh cắt vào ko_ro/plastic | metal | other | bo (không đổi tên file).
  plastic/metal/other -> gán nhãn đó cho đúng box trong ảnh gốc
  bo                  -> bỏ cả ảnh gốc
Quyết định được LƯU LÂU DÀI vào _work/ko_ro_quyet_dinh.csv (chạy lại 06 vẫn giữ nguyên).
Ảnh gốc chỉ được đưa vào images/ + labels/ khi TẤT CẢ box không rõ của nó đã được phân loại.
Ảnh cắt chưa phân loại (còn ở gốc ko_ro/) được giữ lại, lần sau làm tiếp.
Sau khi ghi quyết định, script chạy lại B6 (xuất toàn bộ) để images/, catalog.csv, BAO_CAO.md, review/ đồng bộ.
Chạy:  python models/scripts/Xu_Ly_Du_Lieu/08_ap_dung_ko_ro.py
"""
import csv
import importlib
import shutil
from collections import Counter

from common import OUT, WORK, log

xuat = importlib.import_module("06_xuat")
KO = OUT / "ko_ro"
FIELDS = ["image_id", "box_index", "cls", "x0", "y0", "x1", "y1", "file"]


def main():
    m = {r["file"]: r for r in csv.DictReader(open(KO / "_map.csv", encoding="utf-8"))}
    old = {}
    if xuat.DECISIONS.is_file():
        old = {(r["image_id"], r["box_index"]): r for r in csv.DictReader(open(xuat.DECISIONS, encoding="utf-8"))}
    new, sorted_files, st = {}, [], Counter()
    for sub in xuat.KO_RO_DIRS:
        for p in (KO / sub).glob("*.jpg"):
            if p.name not in m:
                st["file lạ (không có trong _map.csv) — bỏ qua"] += 1
                continue
            r = m[p.name]
            new[(r["image_id"], r["box_index"])] = {"image_id": r["image_id"], "box_index": r["box_index"], "cls": sub,
                                                    **{k: r[k] for k in ("x0", "y0", "x1", "y1")}, "file": p.name}
            sorted_files.append((sub, p))
            st[sub] += 1
    log(f"B8: {len(new)}/{len(m)} ảnh cắt mới được phân loại: {dict(st)}")
    if not new:
        log("  không có gì mới để áp dụng.")
        return
    old.update(new)
    with open(xuat.DECISIONS, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        w.writerows(old.values())
    log(f"  đã lưu {len(old)} quyết định vào {xuat.DECISIONS.name}")
    # cất ảnh cắt đã phân loại để ko_ro/ chỉ còn ảnh chưa làm
    for sub, p in sorted_files:
        dst = WORK / "ko_ro_da_xu_ly" / sub
        dst.mkdir(parents=True, exist_ok=True)
        shutil.move(str(p), dst / p.name)
    xuat.main()
    log("  -> chạy 07_kiem_tra.py để kiểm tra lại")


if __name__ == "__main__":
    main()
