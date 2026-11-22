"""B5 — Làm sạch box + tạo ảnh zoom cận.

  - Box có cạnh < 12 px (quy về 640): bỏ box. Nếu là nhựa/kim loại/không rõ -> tô xám vùng đó
    (để ảnh không còn chai/lon mà thiếu nhãn).
  - Ảnh còn box "ko_ro" -> trạng thái "pending" (chờ anh/chị phân loại tay).
  - Ảnh zoom cận: với ảnh có box nhựa/kim loại nhỏ (cạnh dài < 25% ảnh), cắt thêm 1 ảnh vuông quanh vật
    sao cho vật chiếm 30–60% khung. Các box khác bị cắt mất > 40% -> nếu là nhựa/kim loại thì không tạo zoom.
Chạy:  python models/scripts/Xu_Ly_Du_Lieu/05_box_zoom.py
Vào: _work/cat_04.jsonl   Ra: _work/cat_05.jsonl, _work/img_fix/, _work/img_zoom/
"""
import copy
import random
from collections import Counter

from PIL import Image, ImageDraw

from common import MIN_BOX_PX, WORK, box_px640, clip01, ioa, log, read_jsonl, write_jsonl

TARGET = {"plastic", "metal"}
GRAY = (114, 114, 114)
ZOOM_SMALL = 0.25
MIN_CROP_PX = 160
ZOOM_SRC = {"taco", "oi", "coco", "rf"}  # không zoom Drinking Waste/Garbage12 (nền trơn, ảnh cận sẵn)
DROP_ALL_TINY_SRC = {"rf"}  # anh/chị duyệt 18/11: bỏ ảnh rf mà mọi vật đều quá nhỏ


def gray_fill(r, boxes):
    im = Image.open(r["file"]).convert("RGB")
    W, H = im.size
    dr = ImageDraw.Draw(im)
    for b in boxes:
        x0, y0, x1, y1 = b["xyxy"]
        pw, ph = (x1 - x0) * 0.1, (y1 - y0) * 0.1
        dr.rectangle([(x0 - pw) * W, (y0 - ph) * H, (x1 + pw) * W, (y1 + ph) * H], fill=GRAY)
    dst = WORK / "img_fix" / f"{r['id']}.jpg"
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, quality=95)
    r["file"] = str(dst)
    r["flags"].append(f"tô xám {len(boxes)} box quá nhỏ")


def make_zoom(r):
    rng = random.Random(r["id"])
    W, H = r["w"], r["h"]
    small = [b for b in r["boxes"] if b["cls"] in TARGET
             and max((b["xyxy"][2] - b["xyxy"][0]) * W, (b["xyxy"][3] - b["xyxy"][1]) * H) / max(W, H) < ZOOM_SMALL]
    if not small:
        return None
    b = max(small, key=lambda b: (b["xyxy"][2] - b["xyxy"][0]) * (b["xyxy"][3] - b["xyxy"][1]))
    bw, bh = (b["xyxy"][2] - b["xyxy"][0]) * W, (b["xyxy"][3] - b["xyxy"][1]) * H
    S = max(bw, bh) / rng.uniform(0.3, 0.6)
    if S < MIN_CROP_PX or S > min(W, H):
        return None
    cx = (b["xyxy"][0] + b["xyxy"][2]) / 2 * W + rng.uniform(-0.1, 0.1) * S
    cy = (b["xyxy"][1] + b["xyxy"][3]) / 2 * H + rng.uniform(-0.1, 0.1) * S
    x0 = min(max(0, cx - S / 2), W - S)
    y0 = min(max(0, cy - S / 2), H - S)
    crop = [x0 / W, y0 / H, (x0 + S) / W, (y0 + S) / H]
    new = []
    for o in r["boxes"]:
        vis = ioa(o["xyxy"], crop)
        if vis <= 0:
            continue
        if vis < 0.6:
            if o["cls"] != "other":
                return None
            continue
        x = [(o["xyxy"][0] - crop[0]) / (crop[2] - crop[0]), (o["xyxy"][1] - crop[1]) / (crop[3] - crop[1]),
             (o["xyxy"][2] - crop[0]) / (crop[2] - crop[0]), (o["xyxy"][3] - crop[1]) / (crop[3] - crop[1])]
        new.append({**o, "xyxy": clip01(x)})
    im = Image.open(r["file"]).convert("RGB").crop((round(x0), round(y0), round(x0 + S), round(y0 + S)))
    z = copy.deepcopy(r)
    z.update(id=r["id"] + "__zoom", boxes=new, parent=r["id"], w=im.width, h=im.height, flags=["ảnh zoom cận"])
    dst = WORK / "img_zoom" / f"{z['id']}.jpg"
    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, quality=95)
    z["file"] = str(dst)
    return z


def main():
    recs = read_jsonl(WORK / "cat_04.jsonl")
    st = Counter()
    zooms = []
    for r in recs:
        if r["drop"]:
            continue
        keep, tiny_fill = [], []
        for b in r["boxes"]:
            b["xyxy"] = clip01(b["xyxy"])
            x = b["xyxy"]
            if x[2] - x[0] <= 0 or x[3] - x[1] <= 0:
                continue
            if box_px640(x, r["w"], r["h"]) < MIN_BOX_PX:
                st["box quá nhỏ bị bỏ"] += 1
                if b["cls"] != "other":
                    tiny_fill.append(b)
                continue
            keep.append(b)
        r["boxes"] = keep
        if r["src"] in DROP_ALL_TINY_SRC and tiny_fill and not keep:
            # ảnh Roboflow chụp từ trên cao: mọi lon đều < 12 px -> chỉ còn nền tô xám, vô ích cho camera cận cảnh
            r["drop"] = "rf: mọi vật đều quá nhỏ (ảnh chụp từ xa)"
            st["ảnh rf bỏ vì mọi vật quá nhỏ"] += 1
            continue
        if tiny_fill:
            gray_fill(r, tiny_fill)
            st["ảnh bị tô xám vùng nhỏ"] += 1
        assert not any(b["cls"].startswith("?") for b in r["boxes"]), r["id"]
        r["status"] = "pending" if any(b["cls"] == "ko_ro" for b in r["boxes"]) else "ok"
        st[f"ảnh {r['status']}"] += 1
        if r["status"] == "ok" and r["src"] in ZOOM_SRC:
            z = make_zoom(r)
            if z:
                z["status"] = "ok"
                zooms.append(z)
    st["ảnh zoom cận tạo thêm"] = len(zooms)
    write_jsonl(WORK / "cat_05.jsonl", recs + zooms)
    for k, v in sorted(st.items()):
        log(f"  {k}: {v}")
    log("B5 xong.")


if __name__ == "__main__":
    main()
