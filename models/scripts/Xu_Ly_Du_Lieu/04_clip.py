"""B4 — CLIP ViT-L/14 (công cụ offline) quyết nhãn cho mọi box "?<task>".

Luật: điểm lớp thắng ≥ CLIP_MIN_P và hơn lớp nhì ≥ CLIP_MIN_MARGIN -> nhận nhãn đó.
  - task "scan" (box tìm thêm ở B3): nhựa/kim loại chắc chắn -> thêm box; other chắc chắn -> bỏ box (không phải chai/lon)
  - task khác (bottle, can, g12plastic): nhận nhãn CLIP (kể cả other, vd. chai thủy tinh)
  - không chắc -> "ko_ro" (anh/chị phân loại tay)
Chạy:  python models/scripts/Xu_Ly_Du_Lieu/04_clip.py
Vào: _work/cat_03.jsonl   Ra: _work/cat_04.jsonl
"""
from collections import Counter, defaultdict

import clip
import torch

from common import (CLIP_MIN_MARGIN, CLIP_MIN_P, CLIP_TASKS, SCAN_ACCEPT_P, TOOLS, WORK, crop_box, log, open_rgb, read_jsonl,
                    write_jsonl)

BATCH = 64


def main():
    recs = read_jsonl(WORK / "cat_03.jsonl")
    jobs = [(r, b) for r in recs if not r["drop"] for b in r["boxes"] if b["cls"].startswith("?")]
    log(f"B4: CLIP cho {len(jobs)} box...")
    model, pre = clip.load(str(TOOLS / "clip" / "ViT-L-14.pt"), device="cuda")
    model.eval()
    txt = {}
    with torch.no_grad():
        for task, cls_prompts in CLIP_TASKS.items():
            names, prompts = [], []
            for c, ps in cls_prompts.items():
                for p in ps:
                    names.append(c)
                    prompts.append(f"a photo of {p}.")
            f = model.encode_text(clip.tokenize(prompts).cuda()).float()
            txt[task] = (names, f / f.norm(dim=-1, keepdim=True))

    by_file = defaultdict(list)
    for r, b in jobs:
        by_file[r["file"]].append(b)
    files = list(by_file)
    st = Counter()
    buf = []

    def flush():
        ims = torch.stack([x[1] for x in buf]).cuda().half()
        with torch.no_grad():
            f = model.encode_image(ims).float()
        f = f / f.norm(dim=-1, keepdim=True)
        for (b, _), fv in zip(buf, f):
            task = b["cls"][1:]
            names, tf = txt[task]
            logits = 100 * fv @ tf.T
            cls_names = list(CLIP_TASKS[task])
            per = torch.stack([logits[[i for i, n in enumerate(names) if n == c]].max() for c in cls_names])
            p = per.softmax(0).tolist()
            prob = dict(zip(cls_names, p))
            order = sorted(prob, key=prob.get, reverse=True)
            top, second = order[0], (prob[order[1]] if len(order) > 1 else 0)
            b["clip"] = {k: round(v, 3) for k, v in prob.items()}
            sure = prob[top] >= CLIP_MIN_P and prob[top] - second >= CLIP_MIN_MARGIN
            if task == "scan" and top != "other":
                sure = prob[top] >= SCAN_ACCEPT_P
            if not sure:
                b["cls"], b["suggest"] = "ko_ro", top
            elif task == "scan" and top == "other":
                b["cls"] = "DEL"
            else:
                b["cls"] = top
            st[(task, "không rõ" if not sure else ("bỏ box" if b["cls"] == "DEL" else top))] += 1
        buf.clear()

    for k, fp in enumerate(files):
        im = open_rgb(fp, transpose=False)
        for b in by_file[fp]:
            buf.append((b, pre(crop_box(im, b["xyxy"], 0.1))))
            if len(buf) >= BATCH:
                flush()
        if (k + 1) % 2000 == 0:
            log(f"  {k + 1}/{len(files)} ảnh")
    if buf:
        flush()
    for r in recs:
        r["boxes"] = [b for b in r["boxes"] if b["cls"] != "DEL"]
    write_jsonl(WORK / "cat_04.jsonl", recs)
    for k, v in sorted(st.items()):
        log(f"  {k[0]:10s} -> {k[1]}: {v}")
    log("B4 xong.")


if __name__ == "__main__":
    main()
