"""B10 — Chia train/val/test 70/20/10 (anh/chị duyệt 18/11/2026).

- Chia theo NHÓM split_key: ảnh zoom + ảnh gốc, ảnh gần trùng (pHash ≤ 8), khung cùng video luôn chung 1 tập
  -> không rò rỉ giữa các tập.
- Phân tầng: giữ tỉ lệ 70/20/10 đồng đều cho số ảnh, số box từng nhãn, ảnh nền và từng nguồn dữ liệu.
- Di chuyển images/<id>.jpg -> images/<tập>/<id>.jpg (labels tương tự), thêm cột `split` vào catalog.csv,
  ghi data.yaml cho Ultralytics. unseen_test/ giữ riêng (KHÔNG thuộc tập nào).
Chạy:  python models/scripts/Xu_Ly_Du_Lieu/10_chia_tap.py
"""
import csv
import random
import shutil
from collections import Counter, defaultdict

from common import CLASSES, OUT, SEED, log

RATIO = {"train": 0.7, "val": 0.2, "test": 0.1}
SPLITS = list(RATIO)


def features(r):
    f = Counter(img=1, plastic=int(r["n_plastic"]), metal=int(r["n_metal"]), other=int(r["n_other"]))
    f["bg"] = int(not (f["plastic"] or f["metal"] or f["other"]))
    f[f"src_{r['src']}"] = 1
    f["img_plastic"] = int(f["plastic"] > 0)
    f["img_metal"] = int(f["metal"] > 0)
    return f


def main():
    cat_path = OUT / "catalog.csv"
    cat = list(csv.DictReader(open(cat_path, encoding="utf-8")))
    assert "split" not in cat[0], "catalog.csv đã có cột split — dữ liệu đã chia rồi"
    groups = defaultdict(list)
    for r in cat:
        groups[r["split_key"]].append(r)
    gfeat = {k: sum((features(r) for r in rs), Counter()) for k, rs in groups.items()}
    total = sum(gfeat.values(), Counter())
    keys = list(groups)
    random.Random(SEED).shuffle(keys)
    keys.sort(key=lambda k: -gfeat[k]["img"])  # nhóm lớn xếp trước (ổn định nhờ shuffle)
    cur = {s: Counter() for s in SPLITS}
    assign = {}
    for k in keys:
        g = gfeat[k]

        def need(s):  # tập nào đang thiếu nhiều nhất đúng những thứ nhóm này có
            return sum((RATIO[s] * total[f] - cur[s][f]) / total[f] * v for f, v in g.items() if total[f])

        s = max(SPLITS, key=need)
        assign[k] = s
        cur[s].update(g)
    # di chuyển file
    for s in SPLITS:
        (OUT / "images" / s).mkdir(parents=True, exist_ok=True)
        (OUT / "labels" / s).mkdir(parents=True, exist_ok=True)
    for r in cat:
        s = assign[r["split_key"]]
        r["split"] = s
        shutil.move(str(OUT / "images" / f"{r['id']}.jpg"), OUT / "images" / s / f"{r['id']}.jpg")
        shutil.move(str(OUT / "labels" / f"{r['id']}.txt"), OUT / "labels" / s / f"{r['id']}.txt")
    with open(cat_path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["split"] + [k for k in cat[0] if k != "split"])
        w.writeheader()
        w.writerows(cat)
    (OUT / "data.yaml").write_text(
        f"# ATM Đồng Nát — dữ liệu 3 nhãn, chia 70/20/10 theo split_key (seed {SEED})\n"
        f"path: {OUT.as_posix()}\ntrain: images/train\nval: images/val\ntest: images/test\n"
        f"nc: {len(CLASSES)}\nnames:\n" + "".join(f"  {i}: {n}\n" for i, n in enumerate(CLASSES)),
        encoding="utf-8")
    # báo cáo
    cols = ["img", "plastic", "metal", "other", "img_plastic", "img_metal", "bg"]
    L = ["", "## 5. Chia train/val/test (70/20/10)", "",
         "Chia theo nhóm `split_key` (ảnh zoom + ảnh gốc, ảnh gần trùng, khung cùng video luôn chung 1 tập); "
         "phân tầng theo nhãn và nguồn. File: `data.yaml`, cột `split` trong `catalog.csv`. "
         "`unseen_test/` để riêng, không thuộc tập nào.", "",
         "| Tập | Ảnh | Box plastic | Box metal | Box other | Ảnh có plastic | Ảnh có metal | Ảnh nền |",
         "|---|---|---|---|---|---|---|---|"]
    for s in SPLITS + ["tổng"]:
        c = total if s == "tổng" else cur[s]
        L.append(f"| {s} | " + " | ".join(f"{c[k]:,} ({c[k] / total[k]:.0%})" if total[k] else "0" for k in cols) + " |")
    srcs = sorted(k for k in total if k.startswith("src_"))
    L += ["", "| Nguồn | " + " | ".join(SPLITS) + " |", "|---|" + "---|" * len(SPLITS)]
    for k in srcs:
        L.append(f"| {k[4:]} | " + " | ".join(f"{cur[s][k]:,} ({cur[s][k] / total[k]:.0%})" for s in SPLITS) + " |")
    rep = OUT / "BAO_CAO.md"
    rep.write_text(rep.read_text(encoding="utf-8").rstrip("\n") + "\n" + "\n".join(L) + "\n", encoding="utf-8")
    for s in SPLITS:
        log(f"  {s}: " + ", ".join(f"{k}={cur[s][k]} ({cur[s][k] / total[k]:.1%})" for k in cols if total[k]))
    log(f"B10 xong: {len(groups)} nhóm, {len(cat)} ảnh.")


if __name__ == "__main__":
    main()
