"""Quét models/data/* và viết models/data/REPORT.md (số ảnh, lớp, số box, dung lượng, lỗi).

Chạy:  python models/scripts/Down_data/build_report.py
"""
import csv
import json
import os
import re
import shutil
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
DATA = Path(__file__).resolve().parents[2] / "data"
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".heic"}


def walk_stats(path):
    n_img = size = 0
    ext = Counter()
    for dp, _, fn in os.walk(path):
        for f in fn:
            p = os.path.join(dp, f)
            size += os.path.getsize(p)
            e = os.path.splitext(f)[1].lower()
            if e in IMG_EXT:
                n_img += 1
                ext[e] += 1
    return n_img, size, ext


def gb(b):
    return f"{b / 1e9:.2f} GB" if b >= 1e9 else f"{b / 1e6:.0f} MB"


def yolo_counts(label_files, names):
    boxes, imgs_with = Counter(), Counter()
    empty = 0
    for lf in label_files:
        ids = []
        for line in Path(lf).read_text(encoding="utf-8", errors="ignore").splitlines():
            parts = line.split()
            if parts:
                ids.append(int(float(parts[0])))
        if not ids:
            empty += 1
        for i in ids:
            boxes[names.get(i, str(i))] += 1
        for i in set(ids):
            imgs_with[names.get(i, str(i))] += 1
    return boxes, imgs_with, empty


def table(rows, head):
    out = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def parse_names(yaml_text):
    m = re.search(r"names:\s*\n((?:\s*-\s*.+\n?)+)", yaml_text)
    if m:
        return {i: s.strip()[1:].strip().strip("'\"") for i, s in enumerate(m.group(1).strip().splitlines())}
    m = re.search(r"names:\s*\[(.*?)\]", yaml_text)
    return {i: s.strip().strip("'\"") for i, s in enumerate(m.group(1).split(","))} if m else {}


def log_tail(name, pattern):
    p = DATA / "logs" / f"{name}.log"
    if not p.is_file():
        return "—"
    txt = p.read_text(encoding="utf-8", errors="ignore").replace("\r", "\n")
    hits = [l.strip() for l in txt.splitlines() if re.search(pattern, l)]
    return "; ".join(hits[-3:]) or "không có lỗi"


def main():
    md = [f"# Báo cáo dữ liệu gốc — ATM Đồng Nát\n\nTạo lúc {datetime.now():%Y-%m-%d %H:%M}. "
          "Đây là dữ liệu **thô**, chưa lọc/đổi nhãn/gộp. Ánh xạ nhãn ở cột \"Gợi ý\" chỉ để tham khảo "
          "cho bước lên kế hoạch xử lý.\n"]
    summary = []

    # ---------- Kaggle ----------
    md.append("## 1. Kaggle (`kaggle/`)\n")
    dw = DATA / "kaggle" / "drinking_waste" / "Images_of_Waste"
    if dw.exists():
        n, s, ext = walk_stats(dw.parent)
        yolo = dw / "YOLO_imgs"
        names = {0: "AluCan", 1: "Glass", 2: "HDPEM", 3: "PET"}
        labels = [yolo / f for f in os.listdir(yolo) if f.endswith(".txt")]
        boxes, iw, empty = yolo_counts(labels, names)
        raw = {d: len(os.listdir(dw / "rawimgs" / d)) for d in sorted(os.listdir(dw / "rawimgs"))}
        hint = {"AluCan": "metal", "Glass": "other", "HDPEM": "plastic", "PET": "plastic"}
        md.append("### 1.1 Drinking Waste Classification (arkadiyhacks) — CC0\n")
        md.append(f"- Thư mục `kaggle/drinking_waste/Images_of_Waste/`: `YOLO_imgs/` (ảnh + nhãn YOLO txt cùng chỗ) "
                  f"và `rawimgs/<lớp>/` (cùng ảnh, chia theo thư mục). Tổng {n:,} file ảnh (2 bản), {gb(s)}.")
        md.append(f"- `YOLO_imgs`: {len(labels):,} file nhãn, {empty} file rỗng. Có {ext.get('.heic', 0)} file .heic tính cả 2 bản (cần đổi/bỏ).")
        md.append("- ID lớp theo mô tả bộ dữ liệu: 0 AluCan, 1 Glass, 2 HDPEM, 3 PET (sẽ kiểm tra lại khi xử lý).\n")
        md.append(table([(k, boxes[k], iw[k], raw.get(k, "—"), hint[k]) for k in names.values()],
                        ["Lớp", "Số box", "Số ảnh có lớp", "rawimgs/", "Gợi ý"]))
        md.append("\nĐặc điểm: ảnh chụp 1 vật trên nền trơn, ánh sáng đều → rất sạch nhưng ít đa dạng nền.\n")
        summary.append(("Kaggle – Drinking Waste", f"{len(labels):,}", gb(s), "OK"))
    gc = DATA / "kaggle" / "garbage12" / "garbage_classification"
    if gc.exists():
        n, s, _ = walk_stats(gc)
        hint = {"plastic": "plastic", "metal": "metal (lẫn đồ kim loại khác)", "battery": "other",
                "biological": "other", "brown-glass": "other", "green-glass": "other", "white-glass": "other",
                "cardboard": "other", "paper": "other", "clothes": "other", "shoes": "other", "trash": "other"}
        rows = [(d, len(os.listdir(gc / d)), hint.get(d, "?")) for d in sorted(os.listdir(gc))]
        md.append("### 1.2 Garbage Classification 12 lớp (mostafaabla) — ODbL\n")
        md.append(f"- Thư mục `kaggle/garbage12/garbage_classification/<lớp>/`. {n:,} ảnh, {gb(s)}. "
                  "**Chỉ có nhãn cấp ảnh (phân loại), không có box** → muốn dùng cho detector phải tự gán box.\n")
        md.append(table(rows, ["Lớp", "Số ảnh", "Gợi ý"]))
        md.append("")
        summary.append(("Kaggle – Garbage 12", f"{n:,}", gb(s), "OK (không có box)"))

    # ---------- Roboflow ----------
    md.append("## 2. Roboflow (`roboflow/`) — định dạng YOLOv8\n")
    for pj in sorted(os.listdir(DATA / "roboflow")) if (DATA / "roboflow").exists() else []:
        d = DATA / "roboflow" / pj
        if not (d / "data.yaml").is_file():
            continue
        y = (d / "data.yaml").read_text(encoding="utf-8")
        names = parse_names(y)
        lic = re.search(r"license:\s*(.+)", y)
        url = re.search(r"url:\s*(.+)", y)
        n, s, _ = walk_stats(d)
        rows, tot = [], Counter()
        for sp in ("train", "valid", "test"):
            lbl = d / sp / "labels"
            files = [lbl / f for f in os.listdir(lbl)] if lbl.exists() else []
            b, _, e = yolo_counts(files, names)
            tot.update(b)
            rows.append((sp, len(os.listdir(d / sp / "images")) if (d / sp / "images").exists() else 0,
                         ", ".join(f"{k}: {v}" for k, v in b.items()), e))
        md.append(f"### {pj}\n")
        md.append(f"- Nguồn: {url.group(1).strip() if url else '?'} — license {lic.group(1).strip() if lic else '?'}")
        md.append(f"- Lớp: {', '.join(names.values())}. Tổng {n:,} ảnh, {gb(s)}.\n")
        md.append(table(rows, ["Split", "Ảnh", "Box theo lớp", "Ảnh không box"]))
        md.append("")
        summary.append((f"Roboflow – {pj}", f"{n:,}", gb(s), "OK"))
    md.append("Gợi ý: `plastic bottle` → plastic; `aluminium can`, `tin-and-aluminum-cans` → metal.\n")

    # ---------- TACO ----------
    taco = DATA / "taco"
    if (taco / "annotations.json").is_file():
        ann = json.loads((taco / "annotations.json").read_text(encoding="utf-8"))
        present = {im["id"] for im in ann["images"] if (taco / "images" / im["file_name"]).is_file()}
        cats = {c["id"]: (c["name"], c["supercategory"]) for c in ann["categories"]}
        cnt = Counter(cats[a["category_id"]] for a in ann["annotations"] if a["image_id"] in present)
        n, s, _ = walk_stats(taco / "images")
        md.append("## 3. TACO (`taco/`) — CC BY 4.0, nhãn COCO (polygon + box)\n")
        md.append(f"- {len(present):,}/{len(ann['images']):,} ảnh có trên đĩa, {gb(s)}, "
                  f"{sum(cnt.values()):,} box, {len(cats)} lớp. Ảnh rác ngoài trời, độ phân giải cao.\n")
        md.append(table([(nm, sc, c) for (nm, sc), c in cnt.most_common()], ["Lớp", "Nhóm lớn", "Số box"]))
        md.append("")
        summary.append(("TACO", f"{len(present):,}", gb(s), "OK"))

    # ---------- COCO ----------
    coco = DATA / "coco"
    md.append("## 4. COCO 2017 – phần nhỏ (`coco/`) — CC BY 4.0\n")
    if (coco / "manifest.csv").is_file():
        rows = list(csv.DictReader(open(coco / "manifest.csv", encoding="utf-8")))
        n, s, _ = walk_stats(coco / "images")
        g = Counter(r["group"] for r in rows)
        pc = Counter(r["pick_class"] for r in rows)
        md.append(f"- {len(rows):,} ảnh, {gb(s)}. Nhóm: " + ", ".join(f"{k} {v}" for k, v in g.items()) + ".")
        md.append("- Đã loại mọi ảnh có bottle / cup / wine glass / bowl. Nhãn đầy đủ của ảnh đã chọn ở "
                  "`coco/subset_annotations.json`, nhãn gốc toàn bộ ở `coco/meta/`.")
        md.append(f"- Lỗi tải: {log_tail('coco', r'^Ảnh:|Traceback')}\n")
        md.append("Số ảnh theo lớp được chọn: " + ", ".join(f"{k} {v}" for k, v in sorted(pc.items())) + "\n")
        summary.append(("COCO (phần nhỏ)", f"{len(rows):,}", gb(s), "OK"))
    else:
        md.append("- Chưa xong / lỗi: " + log_tail("coco", r".") + "\n")
        summary.append(("COCO (phần nhỏ)", "—", "—", "CHƯA XONG"))

    # ---------- Open Images ----------
    oi = DATA / "openimages"
    md.append("## 5. Open Images V7 – phần nhỏ (`openimages/`) — ảnh CC BY 2.0, nhãn CC BY 4.0\n")
    if (oi / "manifest.csv").is_file():
        rows = list(csv.DictReader(open(oi / "manifest.csv", encoding="utf-8")))
        n, s, _ = walk_stats(oi / "images")
        g = Counter(r["group"] for r in rows)
        byg = {}
        for r in rows:
            byg.setdefault(r["group"], Counter())[r["pick_class"]] += 1
        boxes = Counter(r["DisplayName"] for r in csv.DictReader(open(oi / "annotations.csv", encoding="utf-8")))
        md.append(f"- {len(rows):,} ảnh, {gb(s)}, {sum(boxes.values()):,} box. Nhóm: "
                  + ", ".join(f"{k} {v}" for k, v in g.items()) + ".")
        md.append("- `unseen` = lớp **giữ riêng để kiểm tra vật lạ**, không được đưa vào train.")
        md.append("- `plastic_candidate` (lớp Bottle) lẫn cả chai thủy tinh/rượu → phải lọc ở bước xử lý.")
        md.append("- Ảnh nhóm other/unseen/hand đã loại nếu có Bottle, Tin can, Beer, Wine, Drink, Juice, Milk.")
        md.append(f"- Lỗi tải: {log_tail('openimages', r'^Ảnh:|lỗi|Traceback|Không có')}\n")
        md.append(table([(gname, sum(c.values()), ", ".join(f"{k} {v}" for k, v in sorted(c.items())))
                         for gname, c in byg.items()], ["Nhóm", "Ảnh", "Theo lớp"]))
        md.append("\nSố box theo lớp (trong ảnh đã tải): "
                  + ", ".join(f"{k} {v}" for k, v in boxes.most_common()) + "\n")
        summary.append(("Open Images (phần nhỏ)", f"{len(rows):,}", gb(s), "OK"))
    else:
        md.append("- Chưa xong / lỗi: " + log_tail("openimages", r".") + "\n")
        summary.append(("Open Images (phần nhỏ)", "—", "—", "CHƯA XONG"))

    md.append("## 6. Ghi chú cho bước lên kế hoạch xử lý\n")
    md.append("- **Trùng ảnh**: Drinking Waste có 2 bản cùng ảnh (`YOLO_imgs` và `rawimgs`), chỉ cần dùng `YOLO_imgs`.")
    md.append("- **Garbage 12** không có box, cần tự gán box (Grounding DINO) hoặc chỉ dùng cho bộ phân loại (Plan B).")
    md.append("- **Open Images Bottle** lẫn chai thủy tinh/rượu; nhiều ảnh có box Drink/Wine/Beer → cần lọc (CLIP) trước khi gán `plastic`.")
    md.append("- **Open Images Tin can** chỉ có 1.246 ảnh đạt điều kiện (box ≥ 1% ảnh, không phải nhóm, không phải hình vẽ).")
    md.append("- Lớp Open Images không có/không tồn tại tên: Egg (Food), Orange, Lemon, Wallet, Soft drink → đã bỏ qua.")
    md.append("- **COCO**: ảnh chỉ có người (không lớp nào khác) chỉ có 238 ảnh đạt điều kiện; hair drier 26, toaster 17, baseball bat 55. "
              "Ảnh COCO chưa gán nhãn chai/lon nếu có lon (COCO không có lớp lon) → cần soát bằng model tạm trước khi dùng làm `other`/nền.")
    md.append("- **Ảnh nhựa thường ngày khác chai** (hộp nhựa, cốc nhựa, ly có ống hút) còn ít: chủ yếu từ TACO, Garbage12 `plastic`, Drinking Waste HDPEM.")
    md.append("- **Nhãn mơ hồ cần anh/chị quyết** khi xử lý: remote/chuột/điện thoại/bàn chải (nhựa nhưng không phải bao bì), "
              "thìa/dĩa/dao kim loại (kim loại nhưng không phải lon) → đề xuất đưa vào `other`.\n")

    free = shutil.disk_usage(DATA).free
    head = ["## Tóm tắt\n", table(summary, ["Nguồn", "Ảnh", "Dung lượng", "Trạng thái"]),
            f"\nỔ đĩa còn trống: {gb(free)}. Script tải: `models/scripts/download_*.py`; log: `models/data/logs/`.\n"]
    md[1:1] = head
    (DATA / "REPORT.md").write_text("\n".join(md), encoding="utf-8")
    print("Đã viết", DATA / "REPORT.md")


if __name__ == "__main__":
    main()
