"""B7 — Tự kiểm tra dữ liệu đã xử lý + train thử 3 epoch (chỉ để chắc YOLO đọc được dữ liệu).

Chạy:  python models/scripts/Xu_Ly_Du_Lieu/07_kiem_tra.py [--no-train]
Ghi kết quả vào cuối models/data_da_xu_ly/BAO_CAO.md (mục "Kiểm tra tự động").
"""
import csv
import random
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

import imagehash
import numpy as np
from PIL import Image

from common import CLASSES, OUT, SEED, WORK, log

SMOKE_N = 3000
SMOKE_EPOCHS = 3


def check_image(p):
    try:
        with Image.open(p) as im:
            im.verify()
        with Image.open(p) as im:
            return None if min(im.size) >= 64 else f"ảnh quá nhỏ {im.size}"
    except Exception as e:
        return f"không mở được: {type(e).__name__}"


def check_label(p):
    errs = []
    lines = [l for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
    for l in lines:
        v = l.split()
        if len(v) != 5:
            errs.append("sai số cột")
            continue
        c, cx, cy, w, h = int(v[0]), *map(float, v[1:])
        if c not in (0, 1, 2):
            errs.append("id nhãn lạ")
        if not (0 < w <= 1 and 0 < h <= 1) or cx - w / 2 < -1e-4 or cx + w / 2 > 1 + 1e-4 \
                or cy - h / 2 < -1e-4 or cy + h / 2 > 1 + 1e-4:
            errs.append("toạ độ ngoài ảnh")
    return errs, [int(l.split()[0]) for l in lines if len(l.split()) == 5]


def run_checks():
    res = []
    imgs = {p.stem: p for p in (OUT / "images").glob("*.jpg")}
    lbls = {p.stem: p for p in (OUT / "labels").glob("*.txt")}
    res.append(("Mỗi ảnh có đúng 1 file nhãn và ngược lại", imgs.keys() == lbls.keys(),
                f"{len(imgs)} ảnh, {len(lbls)} nhãn; thiếu nhãn {len(imgs.keys() - lbls.keys())}, "
                f"nhãn thừa {len(lbls.keys() - imgs.keys())}"))
    with ThreadPoolExecutor(8) as ex:
        bad_img = [(k, e) for k, e in zip(imgs, ex.map(check_image, imgs.values())) if e]
    res.append(("Mọi ảnh mở được, cạnh ≥ 64 px", not bad_img, f"lỗi {len(bad_img)}: {bad_img[:3]}"))
    bad_lbl, cls_cnt, bg = Counter(), Counter(), 0
    for p in lbls.values():
        errs, cl = check_label(p)
        bad_lbl.update(errs)
        cls_cnt.update(cl)
        bg += not cl
    res.append(("Nhãn đúng định dạng YOLO, id ∈ {0,1,2}, box nằm trong ảnh", not bad_lbl, str(dict(bad_lbl)) or "0 lỗi"))
    cat = list(csv.DictReader(open(OUT / "catalog.csv", encoding="utf-8")))
    res.append(("catalog.csv khớp thư mục images", {r["id"] for r in cat} == imgs.keys(), f"{len(cat)} dòng"))
    zoom_ok = all(r["parent"] in imgs for r in cat if r["parent"])
    res.append(("Ảnh zoom có ảnh gốc đi kèm (cùng split_key)", zoom_ok,
                f"{sum(bool(r['parent']) for r in cat)} ảnh zoom"))
    # vật lạ không lọt vào train
    unseen = list((OUT / "unseen_test" / "images").glob("*.jpg"))
    leak_id = [p.stem for p in unseen if p.stem in imgs]
    with ThreadPoolExecutor(8) as ex:
        hu = np.array([int(h, 16) for h in ex.map(_phash, unseen)], dtype=np.uint64)
    ht = np.array([int(r["phash"], 16) for r in cat if r.get("phash")], dtype=np.uint64)
    # pHash ≤ 4 trên ~10 triệu cặp có thể trùng ngẫu nhiên -> xác nhận lại bằng dHash ≤ 8
    near = 0
    if len(ht):
        cand = np.argwhere(np.bitwise_count(hu[:, None] ^ ht[None, :]) <= 4)
        ids = [r["id"] for r in cat if r.get("phash")]
        hits = {int(i) for i, j in cand if _dhash(unseen[i]) - _dhash(OUT / "images" / f"{ids[j]}.jpg") <= 8}
        near = len(hits)
    res.append(("Không ảnh vật lạ (unseen_test) nào nằm trong images/ (theo id và theo pHash)",
                not leak_id and near == 0, f"{len(unseen)} ảnh unseen; trùng id {len(leak_id)}, gần trùng {near}"))
    # ko_ro
    ko = OUT / "ko_ro"
    if (ko / "_map.csv").is_file():
        m = list(csv.DictReader(open(ko / "_map.csv", encoding="utf-8")))
        files = {p.name for p in ko.rglob("*.jpg")}
        res.append(("ko_ro: mỗi ảnh cắt có dòng trong _map.csv", {r["file"] for r in m} == files,
                    f"{len(m)} ảnh cắt"))
        pend_in = [r["image_id"] for r in m if r["image_id"] in imgs]
        res.append(("Ảnh chờ phân loại tay chưa nằm trong images/", not pend_in, f"{len(set(r['image_id'] for r in m))} ảnh gốc"))
    dp = OUT / "other_du_phong"
    if (dp / "images").is_dir():
        dp_ids = {p.stem for p in (dp / "images").glob("*.jpg")}
        dp_cls = Counter(int(l.split()[0]) for p in (dp / "labels").glob("*.txt")
                         for l in p.read_text(encoding="utf-8").splitlines() if l.strip())
        res.append(("other_du_phong: không trùng images/, chỉ chứa nhãn other",
                    not (dp_ids & imgs.keys()) and set(dp_cls) <= {2},
                    f"{len(dp_ids)} ảnh, {sum(dp_cls.values())} box; trùng images/ {len(dp_ids & imgs.keys())}; "
                    f"nhãn {dict(dp_cls)}"))
    stats = {CLASSES[k]: v for k, v in sorted(cls_cnt.items())}
    return res, stats, bg, len(imgs)


def _phash(p):
    with Image.open(p) as im:
        return str(imagehash.phash(im))


def _dhash(p):
    with Image.open(p) as im:
        return imagehash.dhash(im)


def smoke_train():
    from ultralytics import YOLO

    cat = list(csv.DictReader(open(OUT / "catalog.csv", encoding="utf-8")))
    keys = sorted({r["split_key"] for r in cat})
    rng = random.Random(SEED)
    rng.shuffle(keys)
    val_keys = set(keys[: len(keys) // 10])
    rng.shuffle(cat)
    cat = cat[:SMOKE_N]
    d = WORK / "smoke"
    d.mkdir(parents=True, exist_ok=True)
    tr = [str(OUT / "images" / f"{r['id']}.jpg") for r in cat if r["split_key"] not in val_keys]
    va = [str(OUT / "images" / f"{r['id']}.jpg") for r in cat if r["split_key"] in val_keys]
    (d / "train.txt").write_text("\n".join(tr), encoding="utf-8")
    (d / "val.txt").write_text("\n".join(va), encoding="utf-8")
    (d / "data.yaml").write_text(
        f"path: {d.as_posix()}\ntrain: train.txt\nval: val.txt\nnames:\n" +
        "".join(f"  {i}: {n}\n" for i, n in enumerate(CLASSES)), encoding="utf-8")
    model = YOLO("yolo11n.yaml")
    model.train(data=str(d / "data.yaml"), epochs=SMOKE_EPOCHS, imgsz=640, batch=16, workers=4, device=0,
                project=str(d), name="run", exist_ok=True, plots=False, verbose=False, seed=0)
    rows = list(csv.DictReader(open(d / "run" / "results.csv", encoding="utf-8")))
    rows = [{k.strip(): v for k, v in r.items()} for r in rows]
    loss = [float(r["train/box_loss"]) + float(r["train/cls_loss"]) for r in rows]
    for p in (OUT / "labels").parent.glob("*.cache"):
        p.unlink()
    return len(tr), len(va), loss, rows[-1]


def main():
    log("B7: kiểm tra dữ liệu...")
    res, stats, bg, n = run_checks()
    L = ["", "## 4. Kiểm tra tự động", "", "| Kiểm tra | Kết quả | Chi tiết |", "|---|---|---|"]
    for name, ok, det in res:
        L.append(f"| {name} | {'✅' if ok else '❌'} | {det} |")
        log(f"  {'OK ' if ok else 'LỖI'} {name}: {det}")
    L += ["", f"Tổng box theo nhãn: {stats}; ảnh nền (không box): {bg} / {n} ảnh.", ""]
    if "--no-train" not in sys.argv:
        log("B7: train thử YOLO11n 3 epoch...")
        ntr, nva, loss, last = smoke_train()
        ok = loss[-1] < loss[0]
        L += ["### Train thử (chỉ kiểm tra dữ liệu đọc được, không phải model thật)", "",
              f"- YOLO11n từ đầu, {SMOKE_EPOCHS} epoch, {ntr} ảnh train / {nva} ảnh val (lấy ngẫu nhiên, chia theo split_key).",
              f"- Loss (box+cls) theo epoch: {', '.join(f'{x:.3f}' for x in loss)} -> {'giảm ✅' if ok else 'KHÔNG giảm ❌'}",
              f"- mAP50 sau {SMOKE_EPOCHS} epoch: {float(last['metrics/mAP50(B)']):.3f} (thấp là bình thường vì train rất ít).", ""]
        log(f"  loss: {loss} -> {'giảm' if ok else 'KHÔNG giảm'}")
    rep = OUT / "BAO_CAO.md"
    txt = rep.read_text(encoding="utf-8")
    txt = re.split(r"\n## 4\. Kiểm tra tự động", txt)[0].rstrip("\n") + "\n"
    rep.write_text(txt + "\n".join(L), encoding="utf-8")
    log("B7 xong.")


if __name__ == "__main__":
    main()
