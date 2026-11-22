"""B3 — YOLO-World (công cụ offline, không nằm trong model cuối):
  1. Vẽ box cho Garbage12 (chỉ có nhãn thư mục).
  2. Soát chai/lon CHƯA được gán nhãn trong ảnh (COCO, Open Images, TACO, Garbage12).
Mọi box tìm thêm được gắn "?scan" để CLIP (B4) quyết: nhựa / kim loại / bỏ qua / không rõ.

Chạy:  python models/scripts/Xu_Ly_Du_Lieu/03_phat_hien.py
Vào: _work/cat_02.jsonl   Ra: _work/det_raw.jsonl (cache phát hiện), _work/cat_03.jsonl
"""
import json
from collections import Counter, defaultdict

from common import (G12_TARGET, G12_VOCAB, SCAN_VOCAB, TOOLS, WORK, box_px640, iou, ioa, log, read_jsonl,
                    write_jsonl)

G12_MIN = 0.05    # điểm tối thiểu cho box chính của Garbage12 (nhãn lấy theo thư mục, mọi từ khóa đều tính)
SCAN_MIN = 0.25   # điểm tối thiểu để coi là "có thể là chai/lon chưa gán"
SCAN_MIN_G12 = 0.50  # Garbage12 gần như 1 vật/ảnh -> chỉ lấy box nghi rất chắc
BATCH = 16


def vocab_for(r):
    if r["detect"]:
        extra = [v for v in SCAN_VOCAB if v not in G12_VOCAB[r["detect"]]]
        return tuple(G12_VOCAB[r["detect"]] + extra)
    return tuple(SCAN_VOCAB)


def run_detection(recs):
    from ultralytics import YOLOWorld

    cache_p = WORK / "det_raw.jsonl"
    cache = {}
    if cache_p.is_file():
        for line in open(cache_p, encoding="utf-8"):
            d = json.loads(line)
            cache[d["id"]] = d["det"]
    todo = [r for r in recs if r["id"] not in cache]
    log(f"  cần chạy YOLO-World: {len(todo)} ảnh (đã có cache {len(cache)})")
    if not todo:
        return cache
    by_vocab = defaultdict(list)
    for r in todo:
        by_vocab[vocab_for(r)].append(r)
    done = 0
    with open(cache_p, "a", encoding="utf-8") as fo:
        for vocab, rs in by_vocab.items():
            model = YOLOWorld(str(TOOLS / "yolov8x-worldv2.pt"))  # nạp lại: set_classes lỗi khi model đã ở GPU
            model.set_classes(list(vocab))
            for i in range(0, len(rs), BATCH):
                chunk = rs[i:i + BATCH]
                res = model.predict([r["file"] for r in chunk], conf=0.05, iou=0.5, imgsz=640, device=0,
                                    verbose=False, max_det=30)
                for r, p in zip(chunk, res):
                    det = [{"label": vocab[int(c)], "score": round(float(s), 3), "xyxy": [round(v, 4) for v in b]}
                           for c, s, b in zip(p.boxes.cls.tolist(), p.boxes.conf.tolist(), p.boxes.xyxyn.tolist())]
                    cache[r["id"]] = det
                    fo.write(json.dumps({"id": r["id"], "det": det}) + "\n")
                done += len(chunk)
                if done % 2000 < BATCH:
                    log(f"  {done}/{len(todo)}")
    return cache


def nms(dets, thr=0.5):
    keep = []
    for d in sorted(dets, key=lambda d: -d["score"]):
        if all(iou(d["xyxy"], k["xyxy"]) < thr for k in keep):
            keep.append(d)
    return keep


def is_new(cand, boxes):
    """cand chưa trùng box nào đã có."""
    for b in boxes:
        if iou(cand, b["xyxy"]) >= 0.4 or ioa(cand, b["xyxy"]) >= 0.6:
            return False
        if b["cls"] != "other" and ioa(b["xyxy"], cand) >= 0.8:
            return False
    return True


def main():
    recs = read_jsonl(WORK / "cat_02.jsonl")
    live = [r for r in recs if not r["drop"] and (r["detect"] or r["scan"])]
    log(f"B3: YOLO-World trên {len(live)} ảnh...")
    cache = run_detection(live)
    st = Counter()
    for r in live:
        dets = cache[r["id"]]
        if r["detect"]:
            main_d = [d for d in dets if d["score"] >= G12_MIN]
            if not main_d:
                r["drop"] = "g12: không tìm thấy vật"
                st["g12 không thấy vật -> bỏ"] += 1
                continue
            best = max(main_d, key=lambda d: d["score"] * (0.5 + (d["xyxy"][2] - d["xyxy"][0]) * (d["xyxy"][3] - d["xyxy"][1])))
            r["boxes"].append({"cls": G12_TARGET.get(r["detect"], "other"), "src_cls": f"g12:{r['detect']}",
                               "xyxy": best["xyxy"], "score": best["score"]})
            st["g12 có box"] += 1
        cands = []
        for d in dets:
            if d["label"] not in SCAN_VOCAB or d["score"] < (SCAN_MIN_G12 if r["detect"] else SCAN_MIN):
                continue
            b = d["xyxy"]
            if (b[2] - b[0]) * (b[3] - b[1]) > 0.8 or box_px640(b, r["w"], r["h"]) < 12:
                continue
            cands.append({"cls": "?scan", "src_cls": f"yw:{d['label']}", "xyxy": b, "score": d["score"]})
        for a in r.get("aux", []):
            cands.append({**a, "src_cls": f"oi:{a['src_cls']}", "score": 1.0})
        added = 0
        for c in nms(cands):
            if is_new(c["xyxy"], r["boxes"]):
                r["boxes"].append(c)
                added += 1
        if added:
            st[f"{r['src']}: ảnh có box nghi chai/lon chưa gán"] += 1
            st[f"{r['src']}: số box nghi"] += added
    write_jsonl(WORK / "cat_03.jsonl", recs)
    for k, v in sorted(st.items()):
        log(f"  {k}: {v}")
    log("B3 xong.")


if __name__ == "__main__":
    main()
