"""B1 — Chuẩn hóa 7 nguồn về 1 catalog chung + ánh xạ nhãn + giới hạn số ảnh.

Chạy:  python models/scripts/Xu_Ly_Du_Lieu/01_chuan_hoa.py
Ra:    _work/cat_01.jsonl, _work/unseen.jsonl, _work/img/<nguồn>/<id>.jpg (ảnh xoay EXIF, cạnh dài ≤ 1280)
"""
import csv
import json
import os
import random
import re
import shutil
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

from common import (COCO_CAP_PER_CLASS, COCO_DROP, COCO_OTHER, DW_CAP, DW_MAP, DW_NAMES, G12_CAP_OTHER,
                    G12_TARGET, MAX_SIDE, OI_AUX, OI_CAP_KEEP_ALL, OI_CAP_OTHER, OI_NONE, OI_TARGET, RAW,
                    RF_MAP, SEED, TACO_MAP, WORK, clip01, log, parse_yolo_line, safe_id, write_jsonl)

IMG_DIR = WORK / "img"


def rec(src, group, raw_path, rid, boxes, split_key=None, **kw):
    return {"id": rid, "src": src, "group": group, "raw": str(raw_path), "file": None, "w": None, "h": None,
            "boxes": boxes, "aux": kw.pop("aux", []), "detect": kw.pop("detect", None),
            "scan": kw.pop("scan", False), "split_key": split_key or rid, "drop": None, "flags": [], **kw}


def B(cls, src_cls, xyxy):
    return {"cls": cls, "src_cls": src_cls, "xyxy": clip01(xyxy)}


# ---------------- từng nguồn ----------------
def load_dw(rng):
    d = RAW / "kaggle/drinking_waste/Images_of_Waste/YOLO_imgs"
    by_cls = defaultdict(list)
    bad = Counter()
    for f in sorted(os.listdir(d)):
        if not f.lower().endswith(".jpg"):
            pass
            continue
        lbl = d / (f[:-4] + ".txt")
        if not lbl.is_file():
            bad["thiếu nhãn"] += 1
            continue
        boxes = []
        for line in lbl.read_text(encoding="utf-8").split("\n"):
            pr = parse_yolo_line(line)
            if pr:
                boxes.append(B(DW_MAP[pr[0]], DW_NAMES[pr[0]], pr[1]))
        if not boxes:
            bad["nhãn rỗng"] += 1
            continue
        prefix = re.match(r"[A-Za-z]+", f).group(0)
        if prefix not in DW_NAMES.values() and prefix != "mix":
            bad["tên lạ"] += 1
            continue
        if prefix != "mix" and any(b["src_cls"] != prefix for b in boxes):
            bad["ID lớp lệch tên file"] += 1
            continue
        if Image.open(d / f).getexif().get(274, 1) != 1:
            bad["ảnh có cờ xoay EXIF"] += 1
            continue
        by_cls[prefix].append(rec("dw", f"dw:{prefix}", d / f, safe_id("dw", f[:-4]), boxes))
    out = []
    for k, v in sorted(by_cls.items()):
        rng.shuffle(v)
        out += v[:DW_CAP]
        log(f"  dw {k}: {len(v)} ảnh hợp lệ -> giữ {min(len(v), DW_CAP)}")
    log(f"  dw bỏ: {dict(bad)}")
    return out


def load_g12(rng):
    d = RAW / "kaggle/garbage12/garbage_classification"
    out = []
    for c in sorted(os.listdir(d)):
        fs = sorted(os.listdir(d / c))
        if c not in G12_TARGET:
            rng.shuffle(fs)
            fs = fs[:G12_CAP_OTHER]
        for f in fs:
            out.append(rec("g12", f"g12:{c}", d / c / f, safe_id("g12", c, f[:-4]), [], detect=c, scan=True))
        log(f"  g12 {c}: {len(fs)}")
    return out


def load_rf():
    out = []
    for pj in ["bottle-can-detector", "tin-and-aluminum-cans"]:
        d = RAW / "roboflow" / pj
        names = {}
        lines = (d / "data.yaml").read_text(encoding="utf-8").split("\n")
        i = lines.index("names:") + 1
        while i < len(lines) and lines[i].startswith("- "):
            names[len(names)] = lines[i][2:].strip()
            i += 1
        seen = {}
        for sp in ["train", "valid", "test"]:
            for f in sorted(os.listdir(d / sp / "images")):
                stem = re.split(r"_(jpg|jpeg|png)\.rf\.", f)[0]
                if stem in seen:
                    continue  # bản nhân của cùng ảnh gốc
                lbl = d / sp / "labels" / (os.path.splitext(f)[0] + ".txt")
                boxes = []
                for line in lbl.read_text(encoding="utf-8").split("\n") if lbl.is_file() else []:
                    pr = parse_yolo_line(line)
                    if pr:
                        boxes.append(B(RF_MAP[names[pr[0]]], names[pr[0]], pr[1]))
                vid = re.match(r"(VID_\d+_\d+)", stem)
                key = safe_id("rf", pj, vid.group(1) if vid else stem)
                seen[stem] = rec("rf", f"rf:{pj}", d / sp / "images" / f, safe_id("rf", pj, stem), boxes, key)
        out += seen.values()
        log(f"  rf {pj}: {len(seen)} ảnh gốc (sau khi bỏ bản nhân)")
    return out


def load_taco():
    ann = json.loads((RAW / "taco/annotations.json").read_text(encoding="utf-8"))
    cats = {c["id"]: c["name"] for c in ann["categories"]}
    by = defaultdict(list)
    for a in ann["annotations"]:
        by[a["image_id"]].append(a)
    out = []
    for im in ann["images"]:
        W, H = im["width"], im["height"]
        boxes = []
        for a in by[im["id"]]:
            x, y, w, h = a["bbox"]
            nm = cats[a["category_id"]]
            boxes.append(B(TACO_MAP.get(nm, "other"), nm, [x / W, y / H, (x + w) / W, (y + h) / H]))
        p = RAW / "taco/images" / im["file_name"]
        out.append(rec("taco", "taco", p, safe_id("taco", im["file_name"].rsplit(".", 1)[0]), boxes, scan=True,
                       ann_wh=[W, H]))
    log(f"  taco: {len(out)}")
    return out


def load_coco(rng):
    sub = json.loads((RAW / "coco/subset_annotations.json").read_text(encoding="utf-8"))
    cats = {c["id"]: c["name"] for c in sub["categories"]}
    by = defaultdict(list)
    for a in sub["annotations"]:
        by[a["image_id"]].append(a)
    man = {int(r["image_id"]): r for r in csv.DictReader(open(RAW / "coco/manifest.csv", encoding="utf-8"))}
    per = defaultdict(list)
    dropped = 0
    for im in sub["images"]:
        names = {cats[a["category_id"]] for a in by[im["id"]]}
        if names & COCO_DROP:
            dropped += 1
            continue
        W, H = im["width"], im["height"]
        boxes = []
        for a in by[im["id"]]:
            nm = cats[a["category_id"]]
            if nm in COCO_OTHER and not a["iscrowd"]:
                x, y, w, h = a["bbox"]
                boxes.append(B("other", nm, [x / W, y / H, (x + w) / W, (y + h) / H]))
        m = man[im["id"]]
        r = rec("coco", f"coco:{m['group']}", RAW / "coco" / m["file"], safe_id("coco", im["id"]), boxes,
                scan=True, ann_wh=[W, H])
        per[(m["group"], m["pick_class"])].append(r)
    out = []
    for (g, c), v in sorted(per.items()):
        rng.shuffle(v)
        out += v if g == "person_bg" else v[:COCO_CAP_PER_CLASS]
    log(f"  coco: {len(out)} (bỏ {dropped} ảnh có đồng hồ — lớp unseen)")
    return out


def load_oi(rng):
    d = RAW / "openimages"
    man = list(csv.DictReader(open(d / "manifest.csv", encoding="utf-8")))
    boxes_by = defaultdict(list)
    for r in csv.DictReader(open(d / "annotations.csv", encoding="utf-8")):
        boxes_by[r["ImageID"]].append(r)
    unseen_cls = {r["pick_class"] for r in man if r["group"] == "unseen"}
    other_cls = {r["pick_class"] for r in man if r["group"] == "other"}
    out, unseen = [], []
    per = defaultdict(list)
    bad = Counter()
    for m in man:
        iid, g = m["image_id"], m["group"]
        p = d / m["file"]
        if g == "unseen":
            unseen.append({"id": safe_id("oi", iid), "raw": str(p), "class": m["pick_class"]})
            continue
        rows = boxes_by[iid]
        names = {r["DisplayName"] for r in rows}
        if names & unseen_cls:
            bad["có vật thuộc lớp unseen"] += 1
            continue
        if any(r["DisplayName"] in OI_TARGET and (r["IsGroupOf"] == "1" or r["IsDepiction"] == "1") for r in rows):
            bad["chai/lon dạng nhóm hoặc hình vẽ"] += 1
            continue
        boxes, aux = [], []
        for r in rows:
            nm = r["DisplayName"]
            xyxy = [float(r["XMin"]), float(r["YMin"]), float(r["XMax"]), float(r["YMax"])]
            if nm in OI_TARGET:
                boxes.append(B(OI_TARGET[nm], nm, xyxy))
            elif nm in OI_AUX:
                aux.append(B("?scan", nm, xyxy))
            elif nm in OI_NONE or r["IsDepiction"] == "1":
                continue
            elif nm in other_cls:
                boxes.append(B("other", nm, xyxy))
        per[(g, m["pick_class"])].append(rec("oi", f"oi:{g}", p, safe_id("oi", iid), boxes, aux=aux, scan=True))
    for (g, c), v in sorted(per.items()):
        rng.shuffle(v)
        cap = OI_CAP_OTHER if g == "other" and c not in OI_CAP_KEEP_ALL else None
        out += v[:cap] if cap else v
    log(f"  oi: {len(out)} ảnh train, {len(unseen)} ảnh unseen; bỏ: {dict(bad)}")
    return out, unseen


# ---------------- ảnh ----------------
def materialize(r):
    """Xoay EXIF, đổi RGB, thu nhỏ; trả về r đã có file/w/h hoặc r['drop']."""
    dst = IMG_DIR / r["src"] / f"{r['id']}.jpg"
    try:
        if dst.is_file() and dst.stat().st_size > 0:
            with Image.open(dst) as im:
                r["w"], r["h"] = im.size
        else:
            from common import open_rgb
            raw = open_rgb(r["raw"])
            W0, H0 = raw.size
            if "ann_wh" in r and [W0, H0] != r["ann_wh"]:
                r["drop"] = "kích thước ảnh lệch nhãn"
                return r
            if min(W0, H0) < 160:
                r["drop"] = "ảnh quá nhỏ"
                return r
            s = MAX_SIDE / max(W0, H0)
            dst.parent.mkdir(parents=True, exist_ok=True)
            if s < 1:
                raw = raw.resize((round(W0 * s), round(H0 * s)), Image.LANCZOS)
                raw.save(dst, quality=95)
            elif str(r["raw"]).lower().endswith((".jpg", ".jpeg")) and Image.open(r["raw"]).getexif().get(274, 1) == 1 \
                    and Image.open(r["raw"]).mode == "RGB":
                shutil.copyfile(r["raw"], dst)
            else:
                raw.save(dst, quality=95)
            r["w"], r["h"] = raw.size
        r["file"] = str(dst)
    except Exception as e:
        r["drop"] = f"ảnh hỏng: {type(e).__name__}"
    return r


def main():
    rng = random.Random(SEED)
    log("B1: đọc các nguồn...")
    recs = load_dw(rng) + load_g12(rng) + load_rf() + load_taco() + load_coco(rng)
    oi, unseen = load_oi(rng)
    recs += oi
    ids = Counter(r["id"] for r in recs)
    assert max(ids.values()) == 1, [k for k, v in ids.items() if v > 1][:5]
    log(f"B1: chuẩn hóa {len(recs)} ảnh (xoay EXIF, thu nhỏ ≤ {MAX_SIDE}px)...")
    with ThreadPoolExecutor(8) as ex:
        done = 0
        for _ in ex.map(materialize, recs):
            done += 1
            if done % 3000 == 0:
                log(f"  {done}/{len(recs)}")
    # box rỗng/ngược
    for r in recs:
        r["boxes"] = [b for b in r["boxes"] if b["xyxy"][2] > b["xyxy"][0] and b["xyxy"][3] > b["xyxy"][1]]
    write_jsonl(WORK / "cat_01.jsonl", recs)
    write_jsonl(WORK / "unseen.jsonl", unseen)
    st = Counter((r["src"], r["drop"] or "ok") for r in recs)
    for k, v in sorted(st.items()):
        log(f"  {k[0]:5s} {k[1]}: {v}")
    log("B1 xong.")


if __name__ == "__main__":
    main()
