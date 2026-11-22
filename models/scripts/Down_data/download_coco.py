"""Tải một PHẦN COCO 2017 (train) làm nguồn đa dạng cho nhãn `other` + ảnh có người (nền/tay).

Chạy:  python models/scripts/Down_data/download_coco.py
Kết quả trong models/data/coco/:
  meta/instances_train2017.json   nhãn gốc COCO (giải nén từ annotations zip)
  images/<id>.jpg                 ảnh đã chọn
  subset_annotations.json         nhãn COCO của riêng các ảnh đã chọn (đủ mọi box trong ảnh)
  manifest.csv                    file,image_id,group,pick_class
Quy tắc chọn:
  - Bỏ mọi ảnh chứa bottle / cup / wine glass / bowl (dễ lẫn nhựa / thủy tinh).
  - 60 lớp đồ vật thường gặp (bỏ 4 lớp trên + 16 lớp to/ngoài đường như xe buýt, hươu...).
  - Mỗi lớp tối đa PER_CLASS ảnh, vật của lớp đó chiếm >= 3% diện tích ảnh.
  - Thêm PERSON_IMAGES ảnh chỉ có người (không có lớp nào trong 60 lớp) làm ảnh nền/tay.
Chạy lại an toàn: ảnh đã có thì bỏ qua; danh sách chọn cố định nhờ seed.
"""
import csv
import json
import random
import sys
import zipfile
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding="utf-8")
ROOT = Path(__file__).resolve().parents[2] / "data" / "coco"
META = ROOT / "meta"
IMG = ROOT / "images"
ANN_ZIP_URL = "http://images.cocodataset.org/annotations/annotations_trainval2017.zip"
IMG_URL = "http://images.cocodataset.org/train2017/{:012d}.jpg"

PER_CLASS = 70
PERSON_IMAGES = 400
MIN_AREA_FRAC = 0.03
SEED = 42

FORBIDDEN = {"bottle", "cup", "wine glass", "bowl"}
SKIP_CLASSES = {
    "airplane", "bus", "train", "truck", "boat", "elephant", "bear", "zebra", "giraffe",
    "horse", "cow", "sheep", "fire hydrant", "stop sign", "parking meter", "traffic light",
}


def download_file(url, dst):
    tmp = dst.with_suffix(dst.suffix + ".part")
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.replace(dst)


def ensure_annotations():
    META.mkdir(parents=True, exist_ok=True)
    js = META / "instances_train2017.json"
    if js.is_file():
        return js
    z = META / "annotations_trainval2017.zip"
    if not z.is_file():
        print("Tải annotations COCO (~250 MB)...", flush=True)
        download_file(ANN_ZIP_URL, z)
    with zipfile.ZipFile(z) as zf:
        for name in ("annotations/instances_train2017.json", "annotations/instances_val2017.json"):
            with zf.open(name) as src, open(META / Path(name).name, "wb") as out:
                while chunk := src.read(1 << 20):
                    out.write(chunk)
    z.unlink()
    return js


def fetch(item):
    img_id, dst = item
    if dst.is_file() and dst.stat().st_size > 1000:
        return "skip"
    for _ in range(3):
        try:
            r = requests.get(IMG_URL.format(img_id), timeout=60)
            if r.status_code == 200 and len(r.content) > 1000:
                dst.write_bytes(r.content)
                return "ok"
        except requests.RequestException:
            pass
    return "fail"


def main():
    js = ensure_annotations()
    print("Đọc annotations...", flush=True)
    coco = json.loads(js.read_text(encoding="utf-8"))
    cats = {c["id"]: c["name"] for c in coco["categories"]}
    imgs = {im["id"]: im for im in coco["images"]}
    by_img = defaultdict(list)
    for a in coco["annotations"]:
        by_img[a["image_id"]].append(a)

    forbidden_ids = {i for i, n in cats.items() if n in FORBIDDEN}
    keep_cats = {i: n for i, n in cats.items() if n not in FORBIDDEN | SKIP_CLASSES | {"person"}}
    person_id = next(i for i, n in cats.items() if n == "person")

    candidates = defaultdict(list)  # cat_id -> [img_id]
    person_only = []
    for img_id, anns in by_img.items():
        cids = {a["category_id"] for a in anns}
        if cids & forbidden_ids:
            continue
        im = imgs[img_id]
        area = im["width"] * im["height"]
        big = {a["category_id"] for a in anns if a["area"] >= MIN_AREA_FRAC * area and not a["iscrowd"]}
        for cid in big & keep_cats.keys():
            candidates[cid].append(img_id)
        if cids == {person_id} and person_id in big:
            person_only.append(img_id)

    rng = random.Random(SEED)
    chosen = {}  # img_id -> (group, class)
    for cid in sorted(keep_cats):
        pool = sorted(i for i in candidates[cid] if i not in chosen)
        rng.shuffle(pool)
        for i in pool[:PER_CLASS]:
            chosen[i] = ("other", keep_cats[cid])
    person_only.sort()
    rng.shuffle(person_only)
    for i in person_only[:PERSON_IMAGES]:
        chosen.setdefault(i, ("person_bg", "person"))
    print(f"Chọn {len(chosen)} ảnh ({len(keep_cats)} lớp + người)", flush=True)

    IMG.mkdir(parents=True, exist_ok=True)
    jobs = [(i, IMG / f"{i:012d}.jpg") for i in sorted(chosen)]
    stats = {"ok": 0, "skip": 0, "fail": 0}
    failed = []
    with ThreadPoolExecutor(16) as ex:
        for n, ((i, _), res) in enumerate(zip(jobs, ex.map(fetch, jobs)), 1):
            stats[res] += 1
            if res == "fail":
                failed.append(i)
            if n % 250 == 0:
                print(f"{n}/{len(jobs)} {stats}", flush=True)
    print("Ảnh:", stats, flush=True)

    ok_ids = {i for i in chosen if i not in failed}
    subset = {
        "info": {"source": "COCO 2017 train subset for ATM Dong Nat", "seed": SEED},
        "licenses": coco.get("licenses", []),
        "categories": coco["categories"],
        "images": [imgs[i] for i in sorted(ok_ids)],
        "annotations": [a for i in sorted(ok_ids) for a in by_img[i]],
    }
    (ROOT / "subset_annotations.json").write_text(json.dumps(subset), encoding="utf-8")
    with open(ROOT / "manifest.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "image_id", "group", "pick_class"])
        for i in sorted(ok_ids):
            w.writerow([f"images/{i:012d}.jpg", i, *chosen[i]])
    print("Xong COCO.", flush=True)


if __name__ == "__main__":
    main()
