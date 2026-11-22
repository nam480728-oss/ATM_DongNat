"""B9 — Cân bằng nhãn `other` (anh/chị duyệt 18/11/2026).

CHỈ xét ảnh "chỉ có other" (mọi box đều là other). Ảnh có plastic/metal, ảnh nền, unseen_test: KHÔNG đụng tới.
Mục tiêu: tổng box other toàn bộ dữ liệu ≈ TARGET_OTHER.
  1. Bỏ ảnh mờ: độ mờ Crété-Roffet đo trên vùng vật lớn nhất ≥ BLUR_T
  2. Ảnh trùng/gần trùng (cùng split_key = pHash ≤ 8, cùng video): giữ 1 ảnh nét nhất
  3. Vật giống hệt kiểu dáng (CLIP cosine ≥ SIM_T trên vùng vật lớn nhất): giữ 1 ảnh nét nhất
  4. Còn dư -> bỏ ảnh đông vật (≥ 10 box) trước, rồi lấy ngẫu nhiên đều theo nhóm (ưu tiên giữ ảnh dễ nhầm)
Ảnh bị bỏ -> models/data_da_xu_ly/other_du_phong/ (images, labels, danh_sach.csv) — không xóa.
Danh sách bỏ lưu ở _work/other_bo.csv; B6 luôn áp dụng lại khi chạy lại.
Chạy:  python models/scripts/Xu_Ly_Du_Lieu/09_can_bang_other.py --feat   (tính đặc trưng, ~vài phút, có cache)
       python models/scripts/Xu_Ly_Du_Lieu/09_can_bang_other.py          (lọc + xuất lại B6)
"""
import csv
import importlib
import json
import random
import sys
from collections import Counter, defaultdict

import numpy as np
from PIL import Image
from skimage.measure import blur_effect

from common import SEED, TOOLS, WORK, crop_box, log, open_rgb, read_jsonl

xuat = importlib.import_module("06_xuat")

TARGET_OTHER = 5500
BLUR_T = 0.58        # độ mờ Crété-Roffet; chọn sau khi soi mẫu (≥ 0,6 gần như toàn ảnh nhòe)
SIM_T = 0.92         # CLIP cosine; ≥ 0,92 đa số là cùng vật/cùng mẫu (soi mẫu 18/11)
CROWD = 10
FEAT = WORK / "other_feat.npz"
BO = WORK / "other_bo.csv"
# nhóm "dễ nhầm" với plastic/metal -> ưu tiên giữ khi cân bằng
HARD_GROUPS = {"dw:Glass", "oi:plastic_candidate", "oi:can_candidate", "g12:brown-glass", "g12:green-glass",
               "g12:white-glass", "g12:battery", "g12:metal", "g12:plastic", "taco"}


def current_ok():
    all_recs, _ = xuat.apply_decisions(read_jsonl(WORK / "cat_05.jsonl"))
    return [r for r in all_recs if not r["drop"] and r.get("status") == "ok"]


def other_only(recs):
    return [r for r in recs if r["boxes"] and all(b["cls"] == "other" for b in r["boxes"])]


def main_box(r):
    return max(r["boxes"], key=lambda b: (b["xyxy"][2] - b["xyxy"][0]) * (b["xyxy"][3] - b["xyxy"][1]))


def blurriness(im, r):
    """Độ mờ Crété-Roffet (0 = nét, 1 = rất mờ) trên vùng vật lớn nhất, đo ở cỡ ảnh model thấy (cạnh dài 640).
    (Phương sai Laplacian và CLIP đã thử: chấm sai vật bề mặt trơn -> không dùng.)"""
    s = 640 / max(im.size)
    if s < 1:
        im = im.resize((round(im.width * s), round(im.height * s)), Image.LANCZOS)
    c = np.asarray(crop_box(im, main_box(r)["xyxy"], 0.1).convert("L"), dtype=np.float64)
    return 1.0 if min(c.shape) < 8 else float(blur_effect(c))


def compute_feat():
    import clip
    import torch
    oo = other_only(current_ok())
    log(f"B9: tính độ mờ + CLIP cho {len(oo)} ảnh chỉ có other...")
    model, pre = clip.load(str(TOOLS / "clip" / "ViT-L-14.pt"), device="cuda")
    model.eval()
    ids, blur, embs, buf = [], [], [], []

    def flush():
        with torch.no_grad():
            f = model.encode_image(torch.stack(buf).cuda().half()).float()
        embs.append((f / f.norm(dim=-1, keepdim=True)).cpu().numpy().astype(np.float16))
        buf.clear()

    for k, r in enumerate(oo):
        im = open_rgb(r["file"], transpose=False)
        c = crop_box(im, main_box(r)["xyxy"], 0.1)
        ids.append(r["id"])
        blur.append(blurriness(im, r))
        buf.append(pre(c))
        if len(buf) >= 64:
            flush()
        if (k + 1) % 2000 == 0:
            log(f"  {k + 1}/{len(oo)}")
    if buf:
        flush()
    np.savez(FEAT, ids=np.array(ids), blur=np.array(blur, dtype=np.float32), emb=np.concatenate(embs))
    log(f"  lưu {FEAT.name}")


def decide():
    recs = current_ok()
    oo = {r["id"]: r for r in other_only(recs)}
    keep_other = sum(b["cls"] == "other" for r in recs if r["id"] not in oo for b in r["boxes"])
    budget = TARGET_OTHER - keep_other
    z = np.load(FEAT)
    ids = [i for i in z["ids"].tolist()]
    assert set(ids) == set(oo), "cache đặc trưng cũ — chạy lại với --feat"
    blur = dict(zip(ids, z["blur"].tolist()))
    sharp = {i: -v for i, v in blur.items()}  # nét hơn = độ mờ thấp hơn
    emb = {i: e for i, e in zip(ids, z["emb"].astype(np.float32))}
    log(f"B9: {len(oo)} ảnh chỉ-other ({sum(len(r['boxes']) for r in oo.values())} box); "
        f"box other ở ảnh khác giữ nguyên: {keep_other}; ngân sách ảnh chỉ-other: {budget} box")
    reason = {}
    # 1. mờ
    for i in ids:
        if blur[i] >= BLUR_T:
            reason[i] = "mờ"
    # 2. trùng / gần trùng (cùng split_key)
    grp = defaultdict(list)
    for i in ids:
        if i not in reason:
            grp[oo[i]["split_key"]].append(i)
    for g in grp.values():
        g.sort(key=lambda i: -sharp[i])
        for i in g[1:]:
            reason[i] = "trùng"
    # 3. giống hệt kiểu dáng: duyệt theo độ nét giảm dần, giữ ảnh nếu không giống ảnh đã giữ
    cand = sorted((i for i in ids if i not in reason), key=lambda i: -sharp[i])
    kept, kept_mat = [], np.zeros((0, len(next(iter(emb.values())))), dtype=np.float32)
    for i in cand:
        e = emb[i]
        if len(kept) and float((kept_mat @ e).max()) >= SIM_T:
            reason[i] = "giống ảnh khác"
            continue
        kept.append(i)
        kept_mat = np.vstack([kept_mat, e[None]])
    # 4. cân bằng
    nbox = lambda i: len(oo[i]["boxes"])
    total = sum(nbox(i) for i in kept)
    log(f"  sau lọc chất lượng: {len(kept)} ảnh, {total} box")
    if total > budget:
        for i in sorted(kept, key=lambda i: -nbox(i)):
            if total <= budget or nbox(i) < CROWD:
                break
            reason[i] = "cân bằng: ảnh đông vật"
            total -= nbox(i)
        rest = [i for i in kept if i not in reason]
        rng = random.Random(SEED)
        by_g = defaultdict(list)
        for i in rest:
            by_g[oo[i]["group"]].append(i)
        for g in by_g.values():
            rng.shuffle(g)
        # chọn vòng tròn theo nhóm; nhóm dễ nhầm được 2 lượt mỗi vòng
        order, groups = [], sorted(by_g)
        while any(by_g.values()):
            for g in groups:
                for _ in range(2 if g in HARD_GROUPS else 1):
                    if by_g[g]:
                        order.append(by_g[g].pop())
        acc = 0
        for i in order:
            if acc + nbox(i) <= budget:
                acc += nbox(i)
            else:
                reason[i] = "cân bằng"
        total = acc
    else:
        log("  !! sau lọc chất lượng đã ≤ ngân sách — không cắt thêm")
    with open(BO, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "ly_do", "do_mo", "so_box", "nguon", "nhom"])
        for i, why in reason.items():
            w.writerow([i, why, f"{blur[i]:.3f}", nbox(i), oo[i]["src"], oo[i]["group"]])
    st = Counter(reason.values())
    log(f"  bỏ: {dict(st)}; box bỏ: { {k: sum(nbox(i) for i in reason if reason[i] == k) for k in st} }")
    log(f"  giữ {len(ids) - len(reason)} ảnh chỉ-other, {total} box -> tổng other ≈ {total + keep_other}")


if __name__ == "__main__":
    if "--feat" in sys.argv:
        compute_feat()
    else:
        decide()
        xuat.main()
