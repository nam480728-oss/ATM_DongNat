"""B13 — Lọc ảnh lạc đề / nhiễu (anh/chị chốt 19/11: xóa ảnh người, cảnh không liên quan, ảnh nhiễu;
GIỮ ảnh tay cầm chai/lon và ảnh tay cận cảnh).

CLIP ViT-L/14 chấm cả ảnh theo 5 nhóm: nguoi / canh / nhieu (lạc đề)  vs  tay / vat (đúng chủ đề).
  - Ảnh nền (không box): CHỈ GIỮ khi nhóm thắng là tay/vat và điểm người < T_NGUOI, cảnh < T_CANH; còn lại loại
  - Ảnh có box: giữ hết (vừa duyệt nhãn ở B12; soi mẫu thấy CLIP gọi "nhiễu" nhầm lon/chai có chữ, logo)
Chạy:
  python 13_loc_lac_de.py --diem          # chấm điểm -> _ghi_chep/lac_de_diem.csv
  python 13_loc_lac_de.py --xem OUT.jpg   # ghép ảnh mẫu các nhóm sẽ bị loại / được giữ để soi
  python 13_loc_lac_de.py --xoa           # chuyển ảnh bị loại sang _da_loai/
"""
import argparse
import csv
import importlib.util
import random
import sys
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
D = HERE.parents[1] / "data_da_xu_ly"
CLIP_W = HERE.parents[1] / "tools" / "clip" / "ViT-L-14.pt"
SCORE = D / "_ghi_chep" / "lac_de_diem.csv"
T_NGUOI = 0.15
T_CANH = 0.25
G = {
    "nguoi": ["a person", "a portrait of a person's face", "a group of people", "people standing on a street",
              "a person playing sports", "a baby", "a selfie", "a man wearing a suit", "a woman", "a crowd"],
    "canh": ["a street scene", "a city", "a landscape", "a room interior", "a kitchen", "a living room",
             "a bedroom", "a car", "a bus", "an animal", "a dog", "a cat", "a bird", "a building", "an airplane",
             "a train", "a beach", "a sports field", "a restaurant"],
    "nhieu": ["a drawing", "a cartoon", "an illustration", "a screenshot", "a page of text", "a logo",
              "a very blurry photo", "a collage of many photos", "a poster", "an almost black image",
              "a diagram", "a 3d render"],
    "tay": ["a close-up of a human hand", "a hand holding an object", "a hand holding a bottle",
            "a hand holding a can", "fingers"],
    "vat": ["a close-up photo of an object", "a plastic bottle", "a metal can", "trash", "litter on the ground",
            "a product photo on a white background", "an object on a table", "a pile of garbage", "a glass bottle",
            "a piece of paper", "a shoe", "food on a plate", "clothes", "a cardboard box", "a battery"],
}
OFF = {"nguoi", "canh", "nhieu"}


def catalog():
    with open(D / "catalog.csv", encoding="utf-8") as f:
        rd = csv.DictReader(f)
        return rd.fieldnames, list(rd)


def score():
    import clip
    import torch
    _, rows = catalog()
    model, pre = clip.load(str(CLIP_W), device="cuda")
    model.eval()
    names, prompts = [], []
    for g, ps in G.items():
        for p in ps:
            names.append(g)
            prompts.append(f"a photo of {p}.")
    with torch.no_grad():
        tf = model.encode_text(clip.tokenize(prompts).cuda()).float()
    tf = tf / tf.norm(dim=-1, keepdim=True)
    gs = list(G)
    idx = {g: [i for i, n in enumerate(names) if n == g] for g in gs}
    out, buf = [], []

    def flush():
        ims = torch.stack([b[1] for b in buf]).cuda().half()
        with torch.no_grad():
            f = model.encode_image(ims).float()
        f = f / f.norm(dim=-1, keepdim=True)
        lg = 100 * f @ tf.T
        p = torch.stack([lg[:, idx[g]].max(1).values for g in gs], 1).softmax(1).tolist()
        for (r, _), pp in zip(buf, p):
            out.append([r["split"], r["id"], r["src"], r["group"],
                        int(r["n_plastic"]) + int(r["n_metal"]) + int(r["n_other"]), *[f"{v:.3f}" for v in pp]])
        buf.clear()

    for j, r in enumerate(rows):
        buf.append((r, pre(Image.open(D / "images" / r["split"] / f"{r['id']}.jpg").convert("RGB"))))
        if len(buf) >= 64:
            flush()
        if j % 2000 == 0:
            print(f"  {j}/{len(rows)}", flush=True)
    if buf:
        flush()
    with open(SCORE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["split", "id", "src", "group", "n_box", *gs])
        w.writerows(out)
    print("Đã lưu", SCORE)


def decide():
    res = []
    for r in csv.DictReader(open(SCORE, encoding="utf-8")):
        p = {g: float(r[g]) for g in G}
        top = max(p, key=p.get)
        r["top"], r["p"] = top, p[top]
        if int(r["n_box"]) == 0:
            r["loai"] = not (top in ("tay", "vat") and p["nguoi"] < T_NGUOI and p["canh"] < T_CANH)
        else:
            r["loai"] = False
        res.append(r)
    return res


def stats(res):
    L = [r for r in res if r["loai"]]
    print(f"Sẽ loại {len(L)} / {len(res)} ảnh")
    print("  ảnh nền:", dict(Counter((r["group"], r["top"]) for r in L if r["n_box"] == "0").most_common()))
    print("  ảnh có box:", dict(Counter((r["src"], r["top"]) for r in L if r["n_box"] != "0").most_common()))
    K = [r for r in res if not r["loai"] and r["n_box"] == "0"]
    print("  ảnh nền giữ lại:", len(K), dict(Counter((r["group"], r["top"]) for r in K).most_common()))


def montage(res, out):
    random.seed(0)
    S = 130
    rowsets = [("nền LOẠI người", [r for r in res if r["loai"] and r["n_box"] == "0" and r["top"] == "nguoi"]),
               ("nền LOẠI cảnh", [r for r in res if r["loai"] and r["n_box"] == "0" and r["top"] == "canh"]),
               ("nền LOẠI nhiễu", [r for r in res if r["loai"] and r["n_box"] == "0" and r["top"] == "nhieu"]),
               ("có box LOẠI nhiễu", [r for r in res if r["loai"] and r["n_box"] != "0"]),
               ("nền GIỮ (tay)", [r for r in res if not r["loai"] and r["n_box"] == "0" and r["top"] == "tay"]),
               ("nền GIỮ (vật)", [r for r in res if not r["loai"] and r["n_box"] == "0" and r["top"] == "vat"]),
               ("nền LOẠI dù tay/vật", [r for r in res if r["loai"] and r["n_box"] == "0" and r["top"] in ("tay", "vat")]),
               ("nền GIỮ (tay) 2", [r for r in res if not r["loai"] and r["n_box"] == "0" and r["top"] == "tay"]),
               ("nền GIỮ (vật) 2", [r for r in res if not r["loai"] and r["n_box"] == "0" and r["top"] == "vat"])]
    im = Image.new("RGB", (S * 10, S * len(rowsets)), "white")
    d = ImageDraw.Draw(im)
    for i, (t, L) in enumerate(rowsets):
        for j, r in enumerate(random.sample(L, min(10, len(L)))):
            c = Image.open(D / "images" / r["split"] / f"{r['id']}.jpg").convert("RGB")
            c.thumbnail((S - 4, S - 16))
            im.paste(c, (j * S + 2, i * S + 14))
            d.text((j * S + 2, i * S + 1), f"{r['p']:.2f}", fill="blue")
        d.text((S * 7, i * S + 1), f"{t} ({len(L)})", fill="red")
    im.save(out, quality=85)


def apply(res):
    spec = importlib.util.spec_from_file_location("b12", HERE / "12_ap_dung_khong_ro.py")
    b12 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(b12)
    fields, rows = catalog()
    why = {r["id"]: f"lạc đề/nhiễu: CLIP {r['top']} {r['p']:.2f}" for r in res if r["loai"]}
    ids = b12.family(set(why), rows)
    rows = b12.drop_images(ids, lambda i: why.get(i, "cùng họ zoom với ảnh lạc đề"), fields, rows)
    b12.write_catalog(fields, rows)
    print(f"Đã loại {len(ids)} ảnh. Còn {len(rows)} ảnh.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--diem", action="store_true")
    ap.add_argument("--xem")
    ap.add_argument("--xoa", action="store_true")
    a = ap.parse_args()
    if a.diem:
        score()
    res = decide()
    stats(res)
    if a.xem:
        montage(res, a.xem)
    if a.xoa:
        apply(res)
