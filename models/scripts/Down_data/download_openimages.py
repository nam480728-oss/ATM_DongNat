"""Tải một PHẦN Open Images V7 (box) cho dự án ATM Đồng Nát.

Chạy:  python models/scripts/Down_data/download_openimages.py
Kết quả trong models/data/openimages/:
  meta/class-descriptions-boxable.csv
  meta/boxes_<split>.csv        box đã lọc theo các lớp cần (cache, có .done)
  images/<split>/<id>.jpg
  annotations.csv               mọi box (trong các lớp cần) của các ảnh đã tải
  manifest.csv                  file,image_id,split,group,pick_class
Nhóm ảnh:
  metal_candidate   Tin can                          (ứng viên nhãn metal)
  plastic_candidate Bottle                           (lẫn chai thủy tinh -> lọc ở bước xử lý)
  other             đồ vật thường ngày + túi nilon   (ứng viên nhãn other)
  hand              Human hand, không cầm chai/lon   (ảnh nền / tay)
  unseen            ~10 lớp GIỮ RIÊNG để test vật lạ, KHÔNG được dùng để train
Chạy lại an toàn: CSV đã lọc và ảnh đã có thì bỏ qua; danh sách chọn cố định nhờ seed.
"""
import csv
import io
import random
import sys
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2] / "data" / "openimages"
META = ROOT / "meta"
IMG = ROOT / "images"
SEED = 42
MIN_AREA = 0.01  # box chiếm >= 1% ảnh

CLASS_CSV = "https://storage.googleapis.com/openimages/v7/oidv7-class-descriptions-boxable.csv"
BOX_CSV = {
    "validation": "https://storage.googleapis.com/openimages/v5/validation-annotations-bbox.csv",
    "test": "https://storage.googleapis.com/openimages/v5/test-annotations-bbox.csv",
    "train": "https://storage.googleapis.com/openimages/v6/oidv6-train-annotations-bbox.csv",
}
IMG_URL = "https://open-images-dataset.s3.amazonaws.com/{split}/{id}.jpg"

# nhóm -> (danh sách lớp, số ảnh tối đa mỗi lớp). Thứ tự = ưu tiên khi 1 ảnh thuộc nhiều nhóm.
GROUPS = [
    ("metal_candidate", ["Tin can"], 2000),
    ("plastic_candidate", ["Bottle"], 1500),
    ("unseen", [
        "Light bulb", "Candle", "Egg (Food)", "Bread", "Tomato", "Pillow", "Towel",
        "Picture frame", "Clock", "Flower", "Croissant", "Houseplant",
    ], 60),
    ("other", [
        "Plastic bag", "Mug", "Coffee cup", "Mobile phone", "Wine glass", "Book", "Pen",
        "Spoon", "Fork", "Kitchen knife", "Banana", "Apple", "Orange", "Lemon", "Remote control",
        "Computer mouse", "Scissors", "Watch", "Teddy bear", "Plate", "Bowl", "Sunglasses",
        "Glove", "Sock", "Hat", "Envelope", "Coin", "Calculator", "Toilet paper", "Paper towel",
        "Doughnut", "Cookie", "Carrot", "Wallet", "Necklace", "Ring binder", "Pencil case",
    ], 150),
    ("hand", ["Human hand"], 400),
]
UNSEEN_COUNT = 10
EXTRA_CAP = {"Plastic bag": 400}
# Ảnh nhóm other/unseen/hand không được chứa các lớp này (dễ là chai/lon chưa gán nhãn)
FORBIDDEN = ["Bottle", "Tin can", "Beer", "Wine", "Drink", "Juice", "Milk", "Soft drink"]


def get(url, **kw):
    r = requests.get(url, timeout=120, **kw)
    r.raise_for_status()
    return r


def load_classes():
    META.mkdir(parents=True, exist_ok=True)
    f = META / "class-descriptions-boxable.csv"
    if not f.is_file():
        f.write_bytes(get(CLASS_CSV).content)
    rows = list(csv.reader(io.StringIO(f.read_text(encoding="utf-8"))))
    rows = [r for r in rows if len(r) == 2 and r[0].startswith("/m/")]
    return {name.lower(): (mid, name) for mid, name in rows}


def stream_filter(split, url, wanted):
    """Đọc CSV box dạng stream, chỉ giữ dòng thuộc các lớp cần."""
    out = META / f"boxes_{split}.csv"
    done = META / f"boxes_{split}.done"
    if done.exists():
        return out
    print(f"Lọc box {split} (stream)...", flush=True)
    for attempt in range(3):
        try:
            kept = n = 0
            with get(url, stream=True) as r, open(out, "w", encoding="utf-8", newline="") as fo:
                lines = r.iter_lines(chunk_size=1 << 20, decode_unicode=False)
                header = next(lines).decode("utf-8").split(",")
                li = header.index("LabelName")
                fo.write(",".join(header[:13]) + "\n")
                for raw in lines:
                    n += 1
                    parts = raw.decode("utf-8").split(",")
                    if parts[li] in wanted:
                        fo.write(",".join(parts[:13]) + "\n")
                        kept += 1
                    if n % 2_000_000 == 0:
                        print(f"  {split}: {n:,} dòng, giữ {kept:,}", flush=True)
            done.write_text(f"{n} {kept}", encoding="utf-8")
            print(f"  {split}: xong {n:,} dòng, giữ {kept:,}", flush=True)
            return out
        except (requests.RequestException, StopIteration, UnicodeDecodeError) as e:
            print(f"  lỗi {split} lần {attempt + 1}: {e}", flush=True)
    raise SystemExit(f"Không lọc được {split}")


def fetch(job):
    split, img_id, dst = job
    if dst.is_file() and dst.stat().st_size > 1000:
        return "skip"
    for _ in range(3):
        try:
            r = requests.get(IMG_URL.format(split=split, id=img_id), timeout=60)
            if r.status_code == 200 and len(r.content) > 1000:
                dst.write_bytes(r.content)
                return "ok"
            if r.status_code in (403, 404):
                return "fail"
        except requests.RequestException:
            pass
    return "fail"


def main():
    classes = load_classes()
    missing = []

    def resolve(names):
        out = []
        for nm in names:
            if nm.lower() in classes:
                out.append(classes[nm.lower()])
            else:
                missing.append(nm)
        return out

    groups = []
    for g, names, cap in GROUPS:
        res = resolve(names)
        if g == "unseen":
            res = res[:UNSEEN_COUNT]
        groups.append((g, res, cap))
    forbidden = {mid for mid, _ in resolve(FORBIDDEN)}
    if missing:
        print("Lớp không có trong Open Images (bỏ qua):", missing, flush=True)
    mid2name = {mid: nm for _, res, _ in groups for mid, nm in res}
    wanted = set(mid2name) | forbidden
    for mid in forbidden:
        mid2name.setdefault(mid, next(nm for k, (m, nm) in classes.items() if m == mid))

    boxes = defaultdict(list)  # (split, img) -> [row]
    for split, url in BOX_CSV.items():
        path = stream_filter(split, url, wanted)
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                boxes[(split, row["ImageID"])].append(row)
    print(f"Ảnh có ít nhất 1 lớp cần: {len(boxes):,}", flush=True)

    labels_of = {k: {r["LabelName"] for r in v} for k, v in boxes.items()}

    def good_box(r):
        area = (float(r["XMax"]) - float(r["XMin"])) * (float(r["YMax"]) - float(r["YMin"]))
        return area >= MIN_AREA and r["IsGroupOf"] == "0" and r["IsDepiction"] == "0"

    cands = defaultdict(set)  # mid -> {(split, img)}
    for k, rows in boxes.items():
        for r in rows:
            if good_box(r):
                cands[r["LabelName"]].add(k)

    rng = random.Random(SEED)
    chosen = {}  # (split, img) -> (group, class)
    for g, res, cap in groups:
        for mid, nm in res:
            pool = sorted(k for k in cands[mid] if k not in chosen)
            if g in ("other", "unseen", "hand"):
                pool = [k for k in pool if not (labels_of[k] & forbidden)]
            rng.shuffle(pool)
            for k in pool[: EXTRA_CAP.get(nm, cap)]:
                chosen[k] = (g, nm)
    print(f"Chọn {len(chosen):,} ảnh", flush=True)

    jobs = []
    for split, img in sorted(chosen):
        d = IMG / split
        d.mkdir(parents=True, exist_ok=True)
        jobs.append((split, img, d / f"{img}.jpg"))
    stats = {"ok": 0, "skip": 0, "fail": 0}
    failed = set()
    with ThreadPoolExecutor(16) as ex:
        for n, (job, res) in enumerate(zip(jobs, ex.map(fetch, jobs)), 1):
            stats[res] += 1
            if res == "fail":
                failed.add((job[0], job[1]))
            if n % 500 == 0:
                print(f"{n}/{len(jobs)} {stats}", flush=True)
    print("Ảnh:", stats, flush=True)

    ok = sorted(k for k in chosen if k not in failed)
    cols = ["ImageID", "Split", "LabelName", "DisplayName", "XMin", "XMax", "YMin", "YMax",
            "IsOccluded", "IsTruncated", "IsGroupOf", "IsDepiction", "IsInside"]
    with open(ROOT / "annotations.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for split, img in ok:
            for r in boxes[(split, img)]:
                w.writerow({**r, "Split": split, "DisplayName": mid2name.get(r["LabelName"], "")})
    with open(ROOT / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "image_id", "split", "group", "pick_class"])
        for split, img in ok:
            w.writerow([f"images/{split}/{img}.jpg", img, split, *chosen[(split, img)]])
    print("Xong Open Images.", flush=True)


if __name__ == "__main__":
    main()
