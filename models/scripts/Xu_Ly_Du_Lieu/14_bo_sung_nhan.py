"""B14 — Bổ sung nhãn còn sót + bỏ ảnh cảnh (sau train lần 2, anh/chị chốt 19/11: làm bước 1–2 mục 12.7).

Vì sao: trạm nhận 10–15 vật/mẻ, có 1 vật other là trả cả mẻ. Train lần 2 chỉ bắt được 18–19% vật other trong ảnh
nhiều vật, vì nhiều ảnh nhiều vật còn vật CHƯA gán nhãn (Open Images / COCO / Roboflow chỉ gán vài loại)
-> model học rằng những vật đó là "nền".

1. Ứng viên sót nhãn (chỉ nguồn nhiều vật: taco, oi, coco, rf):
   - model y11s_1119_01 (conf >= 0,25) + YOLO-World (từ vựng rác/đồ vật, conf >= 0,25) -> box không trùng nhãn nào
   - CLIP đề xuất: plastic / metal / other / khong_gan (nền, bàn ghế, người, tay, một phần của vật...)
2. Ảnh cảnh (coco, oi không có chai/lon): CLIP cả ảnh là "người"/"cảnh" hoặc mọi box other < 1% ảnh -> đề xuất bỏ.

Xuất ra data_da_xu_ly/bo_sung/ để anh/chị duyệt:
  plastic/ metal/ other/ khong_gan/   mỗi ảnh = 1 vật ứng viên (khung ĐỎ), khung VÀNG = nhãn đã có
                                      kéo sang thư mục đúng; xóa ảnh hoặc kéo vào bo/ = bỏ hẳn ảnh gốc
  _anh_canh_se_bo/                    ảnh cảnh sẽ bị bỏ; muốn giữ ảnh nào -> kéo sang _anh_canh_giu/
Chạy:
  python 14_bo_sung_nhan.py --quet      # chạy model + YOLO-World + CLIP -> _ghi_chep/bo_sung_ung_vien.csv, anh_canh.csv
  python 14_bo_sung_nhan.py --xuat      # xuất ảnh để duyệt
  python 14_bo_sung_nhan.py --ap-dung [--thu]
"""
import argparse
import csv
import importlib.util
import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
MODELS = HERE.parents[1]
D = MODELS / "data_da_xu_ly"
OUT = D / "bo_sung"
GC = D / "_ghi_chep"
CAND = GC / "bo_sung_ung_vien.csv"
SCENE = GC / "anh_canh.csv"
RUN_W = MODELS / "model" / "best.pt"   # model hiện tại (lần 3 y11s_1119_02); lúc chạy B14 dùng lần 2 y11s_1119_01 (đã xóa)
YW_W = MODELS / "tools" / "yolov8x-worldv2.pt"
CLIP_W = MODELS / "tools" / "clip" / "ViT-L-14.pt"
N = ["plastic", "metal", "other"]
LABELS = N + ["khong_gan"]
SPLITS = ["train", "val", "test"]
SRC = {"taco", "oi", "coco", "rf"}
CONF = 0.25
MIN_AREA = 0.002          # box nhỏ hơn 0,2% ảnh: bỏ qua (quá xa, không giống cảnh trạm)
SCENE_SMALL = 0.01        # ảnh cảnh: mọi box other < 1% ảnh

YW_VOCAB = ["bottle", "plastic bottle", "can", "aluminum can", "cup", "paper cup", "box", "cardboard box", "carton",
            "bag", "plastic bag", "paper", "wrapper", "glass", "jar", "bottle cap", "lid", "straw",
            "food container", "battery", "cigarette", "phone", "book", "toy", "shoe", "clothing", "food", "fruit",
            "spoon", "fork", "container", "packet", "tray", "mug", "bowl"]

_b11 = importlib.util.spec_from_file_location("b11", HERE / "11_ra_soat_nhan.py")
b11 = importlib.util.module_from_spec(_b11)
_b11.loader.exec_module(b11)
PROMPTS = {k: [p for p in v if p not in ("a person", "a human hand", "a plant", "a rock")]
           for k, v in b11.PROMPTS.items()}
PROMPTS["khong_gan"] = ["a person", "a human hand", "a human face", "a plant", "a tree", "a rock", "the floor",
                        "the ground", "a wall", "a table", "a shelf", "a chair", "furniture", "a window", "a door",
                        "a building", "a car", "the sky", "a shadow", "a reflection", "a part of a machine",
                        "a refrigerator", "a sink", "a pile of many objects", "grass", "a road"]


def iou(a, b):
    return b11.iou(a, b)


def ioa(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    ar = (a[2] - a[0]) * (a[3] - a[1])
    return ix * iy / ar if ar > 0 else 0.0


def catalog():
    with open(D / "catalog.csv", encoding="utf-8") as f:
        return {r["id"]: r for r in csv.DictReader(f)}


def gt_boxes(sp, iid):
    out = []
    for ln in (D / "labels" / sp / f"{iid}.txt").read_text().split("\n"):
        if ln.strip():
            c, cx, cy, w, h = ln.split()
            cx, cy, w, h = map(float, (cx, cy, w, h))
            out.append((int(c), [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]))
    return out


def is_new(b, gts):
    if (b[2] - b[0]) * (b[3] - b[1]) < MIN_AREA:
        return False
    for _, g in gts:
        if iou(b, g) >= 0.3 or ioa(b, g) >= 0.6 or ioa(g, b) >= 0.8:
            return False
    return True


def detect(model, keys, conf, world=False):
    out = {}
    for i in range(0, len(keys), 16):
        chunk = keys[i:i + 16]
        res = model.predict([str(D / "images" / sp / f"{iid}.jpg") for sp, iid in chunk], conf=conf, iou=0.5,
                            imgsz=640, device=0, verbose=False, half=True, max_det=50)
        for k, r in zip(chunk, res):
            out[k] = [(YW_VOCAB[int(c)] if world else N[int(c)], float(s), list(map(float, x)))
                      for c, s, x in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist(), r.boxes.xyxyn.tolist())]
        if (i // 16) % 50 == 0:
            print(f"  {'YOLO-World' if world else 'y11s'} {i}/{len(keys)}", flush=True)
    return out


def scan():
    import torch
    import clip
    from ultralytics import YOLO, YOLOWorld

    cat = catalog()
    keys = [(r["split"], i) for i, r in cat.items() if r["src"] in SRC]
    print(f"{len(keys)} ảnh nguồn nhiều vật")
    m = YOLO(str(RUN_W))
    p1 = detect(m, keys, CONF)
    del m
    yw = YOLOWorld(str(YW_W))
    yw.set_classes(YW_VOCAB)
    p2 = detect(yw, keys, CONF, world=True)
    del yw
    torch.cuda.empty_cache()

    cands = []
    for k in keys:
        gts = gt_boxes(*k)
        pool = [("y11s", c, s, b) for c, s, b in p1[k]] + [("world", c, s, b) for c, s, b in p2[k]]
        keep = []
        for src, c, s, b in sorted(pool, key=lambda x: (x[0] != "y11s", -x[2])):
            if is_new(b, gts) and all(iou(b, kb[3]) < 0.5 for kb in keep):
                keep.append((src, c, s, b))
        for j, (src, c, s, b) in enumerate(keep):
            cands.append({"split": k[0], "image_id": k[1], "c": j, "may": src, "may_lop": c, "may_conf": s,
                          "x0": b[0], "y0": b[1], "x1": b[2], "y1": b[3]})
    print(f"{len(cands)} ứng viên trong {len({(c['split'], c['image_id']) for c in cands})} ảnh")

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
    idx = {c: [i for i, n in enumerate(names) if n == c] for c in LABELS}
    buf = []

    def flush():
        ims = torch.stack([x[1] for x in buf]).cuda().half()
        with torch.no_grad():
            f = model.encode_image(ims).float()
        f = f / f.norm(dim=-1, keepdim=True)
        lg = 100 * f @ tf.T
        per = torch.stack([lg[:, idx[c]].max(1).values for c in LABELS], 1).softmax(1).tolist()
        for (cd, _), p in zip(buf, per):
            for c, v in zip(LABELS, p):
                cd[f"clip_{c}"] = v
        buf.clear()

    last, im = None, None
    for j, cd in enumerate(cands):
        if last != (cd["split"], cd["image_id"]):
            last = (cd["split"], cd["image_id"])
            im = Image.open(D / "images" / cd["split"] / f"{cd['image_id']}.jpg").convert("RGB")
        buf.append((cd, pre(b11.crop(im, [cd["x0"], cd["y0"], cd["x1"], cd["y1"]], 0.1)[0])))
        if len(buf) >= 64:
            flush()
        if j % 2000 == 0:
            print(f"  CLIP {j}/{len(cands)}", flush=True)
    if buf:
        flush()
    for cd in cands:
        p = {c: cd[f"clip_{c}"] for c in LABELS}
        # đề xuất: model của mình chắc (>= 0,5) thì theo model, còn lại theo CLIP
        cd["de_xuat"] = cd["may_lop"] if cd["may"] == "y11s" and cd["may_conf"] >= 0.5 else max(p, key=p.get)
    fields = ["split", "image_id", "c", "x0", "y0", "x1", "y1", "may", "may_lop", "may_conf",
              *[f"clip_{c}" for c in LABELS], "de_xuat"]
    with open(CAND, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        for cd in cands:
            w.writerow({k: (f"{v:.4f}" if isinstance(v, float) else v) for k, v in cd.items()})
    print("Đã lưu", CAND)

    # ảnh cảnh
    lac = {r["id"]: r for r in csv.DictReader(open(GC / "lac_de_diem.csv", encoding="utf-8"))}
    sc = []
    for i, r in cat.items():
        if r["src"] not in ("coco", "oi") or int(r["n_plastic"]) + int(r["n_metal"]) > 0 or int(r["n_other"]) == 0:
            continue
        g = {k: float(lac[i][k]) for k in ("nguoi", "canh", "nhieu", "tay", "vat")}
        top = max(g, key=g.get)
        gts = gt_boxes(r["split"], i)
        big = max((b[2] - b[0]) * (b[3] - b[1]) for _, b in gts)
        why = []
        if top in ("nguoi", "canh"):
            why.append(f"CLIP cả ảnh: {top} {g[top]:.2f}")
        if big < SCENE_SMALL:
            why.append(f"mọi vật other < 1% ảnh (lớn nhất {big:.2%})")
        if why:
            sc.append([r["split"], i, r["src"], r["group"], r["n_other"], "; ".join(why)])
    with open(SCENE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["split", "image_id", "src", "group", "n_other", "ly_do"])
        w.writerows(sc)
    print(f"Ảnh cảnh đề xuất bỏ: {len(sc)} -> {SCENE}")


def stats():
    cat = catalog()
    cs = list(csv.DictReader(open(CAND, encoding="utf-8")))
    print(f"Ứng viên: {len(cs)} trong {len({(c['split'], c['image_id']) for c in cs})} ảnh")
    print("  đề xuất:", dict(Counter(c["de_xuat"] for c in cs)))
    print("  theo nguồn:", dict(Counter(cat[c["image_id"]]["src"] for c in cs)))
    print("  theo split:", dict(Counter(c["split"] for c in cs)))
    print("  máy tìm ra:", dict(Counter(c["may"] for c in cs)))
    sc = list(csv.DictReader(open(SCENE, encoding="utf-8")))
    print(f"Ảnh cảnh đề xuất bỏ: {len(sc)}", dict(Counter(r["group"] for r in sc)),
          dict(Counter(r["split"] for r in sc)))


def draw_ctx(sp, iid, box, m=0.6):
    im = Image.open(D / "images" / sp / f"{iid}.jpg").convert("RGB")
    W, H = im.size
    c, (cx0, cy0, _, _) = b11.crop(im, box, m)
    d = ImageDraw.Draw(c)
    lw = max(2, int(max(c.size) / 150))
    for _, g in gt_boxes(sp, iid):
        d.rectangle([g[0] * W - cx0, g[1] * H - cy0, g[2] * W - cx0, g[3] * H - cy0], outline=(255, 215, 0),
                    width=max(1, lw // 2))
    d.rectangle([box[0] * W - cx0, box[1] * H - cy0, box[2] * W - cx0, box[3] * H - cy0], outline=(255, 0, 0),
                width=lw)
    if max(c.size) < 300:
        s = 300 / max(c.size)
        c = c.resize((max(1, round(c.width * s)), max(1, round(c.height * s))), Image.LANCZOS)
    c.thumbnail((640, 640))
    return c


def export():
    if OUT.exists() and any(OUT.rglob("*.jpg")):
        sys.exit("!! bo_sung/ đã có ảnh -> không ghi đè (có thể anh/chị đang duyệt)")
    for c in LABELS + ["bo", "_anh_canh_se_bo", "_anh_canh_giu"]:
        (OUT / c).mkdir(parents=True, exist_ok=True)
    cs = list(csv.DictReader(open(CAND, encoding="utf-8")))
    rows = []
    for j, c in enumerate(cs):
        name = f"{c['split']}__{c['image_id']}__c{c['c']}.jpg"
        box = [float(c[k]) for k in ("x0", "y0", "x1", "y1")]
        draw_ctx(c["split"], c["image_id"], box).save(OUT / c["de_xuat"] / name, quality=90)
        rows.append([name, c["split"], c["image_id"], c["c"], *box, c["de_xuat"]])
        if j % 500 == 0:
            print(f"  {j}/{len(cs)}", flush=True)
    with open(OUT / "_map.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "split", "image_id", "c", "x0", "y0", "x1", "y1", "de_xuat"])
        w.writerows(rows)
    sc = list(csv.DictReader(open(SCENE, encoding="utf-8")))
    for r in sc:
        im = Image.open(D / "images" / r["split"] / f"{r['image_id']}.jpg").convert("RGB")
        W, H = im.size
        d = ImageDraw.Draw(im)
        for _, g in gt_boxes(r["split"], r["image_id"]):
            d.rectangle([g[0] * W, g[1] * H, g[2] * W, g[3] * H], outline=(255, 215, 0), width=max(2, W // 300))
        im.thumbnail((640, 640))
        im.save(OUT / "_anh_canh_se_bo" / f"{r['split']}__{r['image_id']}.jpg", quality=88)
    (OUT / "HUONG_DAN.txt").write_text(
        "DUYỆT NHÃN BỔ SUNG + ẢNH CẢNH\n"
        "=============================\n"
        "A. Thư mục plastic / metal / other / khong_gan\n"
        "   - Mỗi ảnh là 1 vật CHƯA có nhãn (khung ĐỎ). Khung VÀNG là vật đã có nhãn, chỉ để tham khảo.\n"
        "   - Thư mục đang chứa ảnh = nhãn máy ĐỀ XUẤT cho khung đỏ.\n"
        "   - Đúng -> để nguyên. Sai -> kéo sang thư mục đúng:\n"
        "       plastic / metal / other : gán nhãn đó cho khung đỏ\n"
        "       khong_gan : không gán gì (nền, bàn ghế, người, tay, chỉ là một phần của vật, khung lệch...)\n"
        "       bo        : bỏ hẳn ảnh gốc (ảnh quá rối, không gán cho đúng được). XÓA ảnh cũng = bỏ ảnh gốc.\n"
        "   - Gợi ý: other = mọi vật có thể bị bỏ vào trạm mà không phải chai nhựa / lon kim loại\n"
        "     (chai thủy tinh, hộp giấy, túi, nắp, cốc giấy, đồ ăn, giày, điện thoại...).\n"
        "B. Thư mục _anh_canh_se_bo\n"
        "   - Ảnh cảnh (người, đường phố, phòng...) chỉ có vật other nhỏ -> SẼ BỎ cả ảnh.\n"
        "   - Ảnh nào muốn giữ -> kéo sang _anh_canh_giu.\n"
        "KHÔNG đổi tên file. Xong thì nhắn để mình áp dụng.\n", encoding="utf-8")
    print(f"Đã xuất {len(rows)} ứng viên + {len(sc)} ảnh cảnh vào {OUT}")


def apply(dry):
    spec = importlib.util.spec_from_file_location("b12", HERE / "12_ap_dung_khong_ro.py")
    b12 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(b12)
    fields, rows = b12.read_catalog()
    mp = list(csv.DictReader(open(OUT / "_map.csv", encoding="utf-8")))
    where = {}
    for c in LABELS + ["bo"]:
        # _nghi_sai/<nhãn>/: ô máy (Claude) đề nghị đổi nhãn, người duyệt xác nhận bằng cách để nguyên
        for p in [*(OUT / c).glob("*.jpg"), *(OUT / "_nghi_sai" / c).glob("*.jpg")]:
            where[p.name] = c
    dec = Counter()
    add, drop, log = {}, {}, []
    for r in mp:
        c = where.get(r["file"], "xoa")
        dec[c] += 1
        log.append([r["file"], r["split"], r["image_id"], r["de_xuat"], c])
        key = (r["split"], r["image_id"])
        if c in N:
            add.setdefault(key, []).append((N.index(c), [float(r[k]) for k in ("x0", "y0", "x1", "y1")]))
        elif c in ("bo", "xoa"):
            drop[r["image_id"]] = "bổ sung nhãn: anh/chị bỏ ảnh (" + ("thư mục bo" if c == "bo" else "xóa ảnh") + ")"
    keep_scene = {p.stem.split("__", 1)[1] for p in (OUT / "_anh_canh_giu").glob("*.jpg")}
    sc = list(csv.DictReader(open(SCENE, encoding="utf-8")))
    n_scene = 0
    for r in sc:
        if r["image_id"] not in keep_scene:
            drop.setdefault(r["image_id"], f"ảnh cảnh: {r['ly_do']}")
            n_scene += 1
    print("Quyết định ứng viên:", dict(dec))
    print(f"Thêm nhãn: {sum(len(v) for v in add.values())} box vào {len(add)} ảnh "
          f"({dict(Counter(N[c] for v in add.values() for c, _ in v))})")
    co = {r["id"] for r in rows}
    da_bo = {i for i in drop if i not in co}          # đã bị loại ở bước trước (không còn trong catalog)
    ids = b12.family(set(drop) - da_bo, rows) & co
    if da_bo:
        print(f"  ({len(da_bo)} ảnh đã bị loại từ trước, bỏ qua)")
    print(f"Bỏ ảnh: {len(drop)} ({n_scene} ảnh cảnh, giữ lại {len(keep_scene)} ảnh cảnh) + họ zoom -> {len(ids)}")
    if dry:
        return
    for (sp, iid), bs in add.items():
        if iid in ids:
            continue
        lp = D / "labels" / sp / f"{iid}.txt"
        txt = lp.read_text().rstrip("\n")
        new = [f"{c} {(b[0] + b[2]) / 2:.6f} {(b[1] + b[3]) / 2:.6f} {b[2] - b[0]:.6f} {b[3] - b[1]:.6f}"
               for c, b in bs]
        lp.write_text("\n".join(([txt] if txt else []) + new) + "\n")
    rows = b12.drop_images(ids, lambda i: drop.get(i, "cùng họ zoom với ảnh bị bỏ"), fields, rows)
    b12.recount(rows)
    b12.write_catalog(fields, rows)
    with open(GC / "bo_sung_quyet_dinh.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "split", "image_id", "de_xuat", "quyet_dinh"])
        w.writerows(log)
    for p in (D / "labels").glob("*.cache"):
        p.unlink()
    print(f"Xong. Còn {len(rows)} ảnh.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--quet", action="store_true")
    ap.add_argument("--xuat", action="store_true")
    ap.add_argument("--ap-dung", action="store_true")
    ap.add_argument("--thu", action="store_true")
    a = ap.parse_args()
    if a.quet:
        scan()
    if a.quet or a.xuat:
        stats()
    if a.xuat:
        export()
    if a.ap_dung:
        apply(a.thu)
