"""B11 — Rà soát nhãn sau train lần 1: tìm box nghi gán sai trong train/val/test.

Hai nguồn chấm độc lập cho MỌI box:
  1. CLIP ViT-L/14, phân loại 3 lớp với bộ mô tả mới (plastic / metal / other rộng).
  2. Model y11s_1118_01 (đã train): box dự đoán khớp IoU >= 0,5 với box nhãn -> lớp + độ tự tin.
Box bị nghi khi:
  - nhãn other  mà CLIP cho plastic/metal >= CLIP_T, hoặc y11s đoán plastic/metal >= YOLO_T
  - nhãn plastic mà CLIP cho plastic < CLIP_LOW và lớp khác >= CLIP_T, hoặc y11s đoán lớp khác >= YOLO_T
  - nhãn metal  tương tự.
Xuất ảnh cắt (khung đỏ quanh vật) vào data_da_xu_ly/khong_ro/<nhãn hiện tại>/ để anh/chị phân loại tay.
Tên file: <máy nghi là>__<split>__<image_id>__b<k>.jpg ; bảng tra: khong_ro/_map.csv
KHÔNG sửa nhãn — việc áp dụng làm ở bước sau, sau khi anh/chị phân loại xong.

Chạy:
  python 11_ra_soat_nhan.py --diem     # chấm điểm (CLIP + y11s), lưu _ghi_chep/ra_soat_diem.csv
  python 11_ra_soat_nhan.py --thong-ke # đếm số box nghi theo ngưỡng
  python 11_ra_soat_nhan.py --xuat     # xuất ảnh cắt vào khong_ro/
"""
import argparse
import csv
import json
import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")
MODELS = Path(__file__).resolve().parents[2]
D = MODELS / "data_da_xu_ly"
OUT = D / "khong_ro"
SCORE = D / "_ghi_chep" / "ra_soat_diem.csv"
CLIP_W = MODELS / "tools" / "clip" / "ViT-L-14.pt"
YOLO_W = MODELS / "model" / "best.pt"   # model hiện tại (lần 3 y11s_1119_02); lúc chạy B11 dùng lần 1 y11s_1118_01 (đã xóa)
N = ["plastic", "metal", "other"]
SPLITS = ["train", "val", "test"]

CLIP_T = 0.50      # lớp khác nhãn được CLIP cho >= 0,5 -> nghi
CLIP_LOW = 0.25    # với nhãn plastic/metal: CLIP cho đúng lớp đó < 0,25 mới tính là nghi
YOLO_T = 0.40      # y11s đoán lớp khác với độ tự tin >= 0,4 -> nghi
SKIP_SRC = {"dw"}  # Drinking Waste: nhãn theo thư mục gốc, soi mẫu thấy box bị nghi đều đúng -> không đưa ra soát

PROMPTS = {
    "plastic": ["a plastic bottle", "a clear plastic water bottle", "a plastic soda bottle", "a plastic juice bottle",
                "a plastic milk jug", "a plastic detergent bottle", "a plastic shampoo bottle",
                "a plastic spray bottle", "a plastic cup", "a plastic food container", "a plastic yogurt cup",
                "a crushed plastic bottle"],
    "metal": ["an aluminum soda can", "an aluminum beer can", "a crushed aluminum can", "a steel food can",
              "a tin can", "a metal aerosol spray can", "a paint can", "an energy drink can"],
    "other": ["a glass bottle", "a wine bottle", "a glass beer bottle", "a glass jar", "a drinking glass",
              "a bottle cap", "a metal lid", "aluminum foil", "an aluminum food tray", "a pop tab", "a beer keg",
              "a cardboard box", "a piece of paper", "a paper cup", "a drink carton", "a plastic bag",
              "a plastic wrapper", "a chip bag", "a styrofoam container", "a cigarette butt", "food",
              "a fruit", "a shoe", "clothes", "a battery", "an electronic device", "a toy", "a person",
              "a human hand", "a plant", "a rock", "a pile of trash", "a metal spoon", "a ceramic mug",
              "a book", "a bag"],
}


def all_boxes():
    """[(split, image_id, k, cls, cx, cy, w, h)] cho mọi box."""
    out = []
    for sp in SPLITS:
        for lp in sorted((D / "labels" / sp).glob("*.txt")):
            for k, ln in enumerate(x for x in lp.read_text().split("\n") if x.strip()):
                c, *v = ln.split()
                out.append((sp, lp.stem, k, int(c), *map(float, v)))
    return out


def xyxy(b):
    cx, cy, w, h = b[4:8]
    return [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0.0


def crop(im, bx, m):
    W, H = im.size
    x0, y0, x1, y1 = bx
    bw, bh = (x1 - x0) * W, (y1 - y0) * H
    c = (max(0, int(x0 * W - m * bw)), max(0, int(y0 * H - m * bh)),
         min(W, int(x1 * W + m * bw)), min(H, int(y1 * H + m * bh)))
    return im.crop((c[0], c[1], max(c[2], c[0] + 1), max(c[3], c[1] + 1))), c


def score():
    import clip
    import torch
    from ultralytics import YOLO

    boxes = all_boxes()
    by_img = {}
    for b in boxes:
        by_img.setdefault((b[0], b[1]), []).append(b)
    print(f"{len(boxes)} box trong {len(by_img)} ảnh")

    # 1) y11s
    yolo = YOLO(str(YOLO_W))
    ypred = {}
    keys = list(by_img)
    for i in range(0, len(keys), 16):
        chunk = keys[i:i + 16]
        res = yolo.predict([str(D / "images" / sp / f"{iid}.jpg") for sp, iid in chunk], conf=0.05, iou=0.7,
                           imgsz=640, verbose=False, half=True)
        for key, r in zip(chunk, res):
            ypred[key] = [(int(c), float(s), list(map(float, xy)))
                          for c, s, xy in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist(), r.boxes.xyxyn.tolist())]
        if (i // 16) % 100 == 0:
            print(f"  y11s {i}/{len(keys)}", flush=True)
    del yolo
    torch.cuda.empty_cache()

    # 2) CLIP
    model, pre = clip.load(str(CLIP_W), device="cuda")
    model.eval()
    names, prompts = [], []
    for c, ps in PROMPTS.items():
        for p in ps:
            names.append(c)
            prompts.append(f"a photo of {p}.")
    with torch.no_grad():
        tf = model.encode_text(clip.tokenize(prompts).cuda()).float()
    tf = tf / tf.norm(dim=-1, keepdim=True)
    idx = {c: [i for i, n in enumerate(names) if n == c] for c in N}
    cprob = {}
    buf = []

    def flush():
        ims = torch.stack([x[1] for x in buf]).cuda().half()
        with torch.no_grad():
            f = model.encode_image(ims).float()
        f = f / f.norm(dim=-1, keepdim=True)
        lg = 100 * f @ tf.T
        per = torch.stack([lg[:, idx[c]].max(1).values for c in N], 1).softmax(1).tolist()
        for (key, _), p in zip(buf, per):
            cprob[key] = p
        buf.clear()

    for j, (key, bs) in enumerate(by_img.items()):
        im = Image.open(D / "images" / key[0] / f"{key[1]}.jpg").convert("RGB")
        for b in bs:
            buf.append(((b[0], b[1], b[2]), pre(crop(im, xyxy(b), 0.1)[0])))
            if len(buf) >= 64:
                flush()
        if j % 2000 == 0:
            print(f"  CLIP {j}/{len(by_img)} ảnh", flush=True)
    if buf:
        flush()

    # 3) ghi bảng điểm
    with open(SCORE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["split", "image_id", "box", "cls", "cx", "cy", "w", "h",
                    "clip_plastic", "clip_metal", "clip_other", "yolo_cls", "yolo_conf"])
        for b in boxes:
            g = xyxy(b)
            best = max(((iou(g, p[2]), p) for p in ypred[(b[0], b[1])]), key=lambda t: (t[0] >= 0.5, t[1][1]),
                       default=(0, None))
            yc, ys = ("", "") if best[1] is None or best[0] < 0.5 else (N[best[1][0]], f"{best[1][1]:.3f}")
            p = cprob[(b[0], b[1], b[2])]
            w.writerow([b[0], b[1], b[2], N[b[3]], *[f"{v:.6f}" for v in b[4:8]], *[f"{v:.3f}" for v in p], yc, ys])
    print("Đã lưu", SCORE)


def suspects():
    src = {r["id"]: r["src"] for r in csv.DictReader(open(D / "catalog.csv", encoding="utf-8"))}
    out = []
    for r in csv.DictReader(open(SCORE, encoding="utf-8")):
        if src[r["image_id"]] in SKIP_SRC:
            continue
        c = r["cls"]
        p = {k: float(r[f"clip_{k}"]) for k in N}
        yc, ys = r["yolo_cls"], float(r["yolo_conf"] or 0)
        why = []
        alt = max((k for k in N if k != c), key=p.get)
        if p[alt] >= CLIP_T and (c == "other" or p[c] < CLIP_LOW):
            why.append(("clip", alt, p[alt]))
        if yc and yc != c and ys >= YOLO_T:
            why.append(("y11s", yc, ys))
        if c == "other":
            why = [x for x in why if x[1] != "other"]
        if why:
            guess = max(why, key=lambda x: x[2])[1]
            r["nghi"], r["ly_do"] = guess, ";".join(f"{a}:{b}:{s:.2f}" for a, b, s in why)
            out.append(r)
    return out


def stats(sus):
    cat = {r["id"]: r for r in csv.DictReader(open(D / "catalog.csv", encoding="utf-8"))}
    tot = Counter(r["cls"] for r in csv.DictReader(open(SCORE, encoding="utf-8")))
    print(f"Box nghi: {len(sus)} / {sum(tot.values())}")
    for c in N:
        s = [r for r in sus if r["cls"] == c]
        print(f"  nhãn {c:7s}: {len(s):5d} / {tot[c]}  | máy nghi là: {dict(Counter(r['nghi'] for r in s))}")
        print(f"      theo nguồn: {dict(Counter(cat[r['image_id']]['src'] for r in s).most_common())}")
        print(f"      theo split: {dict(Counter(r['split'] for r in s))}"
              f" | chỉ CLIP {sum('y11s' not in r['ly_do'] for r in s)}, chỉ y11s {sum('clip' not in r['ly_do'] for r in s)},"
              f" cả hai {sum('clip' in r['ly_do'] and 'y11s' in r['ly_do'] for r in s)}")


def export(sus):
    if any(any((OUT / c).glob("*.jpg")) for c in N):
        sys.exit("!! khong_ro đã có ảnh -> không ghi đè (có thể anh/chị đang phân loại)")
    for c in N:
        (OUT / c).mkdir(parents=True, exist_ok=True)
    rows = []
    for j, r in enumerate(sus):
        im = Image.open(D / "images" / r["split"] / f"{r['image_id']}.jpg").convert("RGB")
        b = (0, 0, 0, 0, *map(float, (r["cx"], r["cy"], r["w"], r["h"])))
        bx = xyxy(b)
        c, (cx0, cy0, _, _) = crop(im, bx, 0.35)
        W, H = im.size
        ImageDraw.Draw(c).rectangle([bx[0] * W - cx0, bx[1] * H - cy0, bx[2] * W - cx0, bx[3] * H - cy0],
                                    outline=(255, 0, 0), width=max(2, int(max(c.size) / 150)))
        if max(c.size) < 224:
            s = 224 / max(c.size)
            c = c.resize((max(1, round(c.width * s)), max(1, round(c.height * s))), Image.LANCZOS)
        c.thumbnail((512, 512))
        name = f"{r['nghi']}__{r['split']}__{r['image_id']}__b{r['box']}.jpg"
        c.save(OUT / r["cls"] / name, quality=92)
        rows.append([name, r["split"], r["image_id"], r["box"], r["cls"], r["cx"], r["cy"], r["w"], r["h"],
                     r["nghi"], r["ly_do"]])
        if j % 500 == 0:
            print(f"  {j}/{len(sus)}", flush=True)
    with open(OUT / "_map.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "split", "image_id", "box", "nhan_cu", "cx", "cy", "w", "h", "may_nghi", "ly_do"])
        w.writerows(rows)
    (OUT / "HUONG_DAN.txt").write_text(
        "PHÂN LOẠI TAY CÁC BOX NGHI GÁN SAI\n"
        "==================================\n"
        "- Mỗi ảnh là 1 vật (khung đỏ). Ảnh đang nằm trong thư mục = NHÃN HIỆN TẠI của vật.\n"
        "- Tiền tố tên file (plastic__ / metal__ / other__) = máy NGHI vật thật ra là lớp đó.\n"
        "- Nhãn đúng khác thư mục hiện tại -> kéo ảnh sang thư mục đúng (plastic / metal / other).\n"
        "- Nhãn hiện tại đã đúng -> để nguyên.\n"
        "- Muốn bỏ hẳn cả ảnh gốc (vật không xác định được, box hỏng) -> tạo thư mục 'bo' và kéo vào.\n"
        "- KHÔNG đổi tên file. Xong thì nhắn để mình áp dụng.\n", encoding="utf-8")
    print(f"Đã xuất {len(rows)} ảnh vào {OUT}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--diem", action="store_true")
    ap.add_argument("--thong-ke", action="store_true")
    ap.add_argument("--xuat", action="store_true")
    a = ap.parse_args()
    if a.diem:
        score()
    if a.thong_ke or a.xuat:
        s = suspects()
        stats(s)
        if a.xuat:
            export(s)
