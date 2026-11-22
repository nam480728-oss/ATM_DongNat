"""T3 — Đánh giá một lần train: mAP chính thức, quét ngưỡng conf, ma trận nhầm lẫn, theo nguồn / kích thước,
tỉ lệ từ chối vật lạ (unseen_test), tốc độ, thư viện ảnh lỗi -> models/model/<tên>/danh_gia/BAO_CAO_TRAIN.md

  python models/scripts/Train/02_danh_gia.py <tên>            đánh giá trên VAL (+ unseen), CHỌN ngưỡng vận hành
  python models/scripts/Train/02_danh_gia.py <tên> --test     đánh giá TEST bằng ngưỡng đã chọn trên val
                                                               (chỉ chạy 1 lần cho model được chốt)
"""
import argparse
import csv
import json
import time
from collections import Counter, defaultdict

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from _chung import CLASSES, DATA_DIR, fmt_time, load_cfg, read_progress, read_status, run_dir

COLORS = {0: (0, 190, 0), 1: (30, 144, 255), 2: (230, 40, 40)}
GT_COLOR = (255, 215, 0)
VI = {"plastic": "nhựa", "metal": "kim loại", "other": "other"}


def iou(a, b):
    ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / u if u > 0 else 0.0


def load_gt(split):
    out = {}
    for p in sorted((DATA_DIR / "labels" / split).glob("*.txt")):
        boxes = []
        for l in p.read_text(encoding="utf-8").splitlines():
            if l.strip():
                c, cx, cy, w, h = l.split()
                cx, cy, w, h = map(float, (cx, cy, w, h))
                boxes.append((int(c), [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]))
        out[p.stem] = boxes
    return out


def predict(model, paths, conf=0.05, bs=16):
    """Dự đoán theo từng nhóm 16 ảnh (truyền cả danh sách 1 lần -> Ultralytics gộp thành 1 batch, tràn VRAM)."""
    from pathlib import Path
    out = {}
    for k in range(0, len(paths), bs):
        chunk = paths[k:k + bs]
        for path, r in zip(chunk, model.predict(chunk, conf=conf, iou=0.7, imgsz=640, device=0, verbose=False)):
            b = r.boxes
            out[Path(path).stem] = [(int(c), float(s), x) for c, s, x in
                                    zip(b.cls.tolist(), b.conf.tolist(), b.xyxyn.tolist())]
    return out


def greedy(preds, gts, thr):
    """preds [(cls, conf, xyxy)], gts [(cls, xyxy)] cùng lớp -> (cờ TP từng pred, tập gt đã khớp)."""
    used, flags = set(), []
    for _, _, pb in sorted(preds, key=lambda p: -p[1]):
        best, bi = thr, -1
        for gi, (_, gb) in enumerate(gts):
            if gi not in used:
                v = iou(pb, gb)
                if v >= best:
                    best, bi = v, gi
        flags.append(bi >= 0)
        if bi >= 0:
            used.add(bi)
    return flags, used


def eval_at(gt, pr, t, thr, meta=None):
    """P/R từng lớp + (tùy chọn) theo nguồn, theo kích thước, ma trận nhầm lẫn, lỗi từng ảnh."""
    cnt = {c: Counter() for c in range(3)}
    by_src = defaultdict(lambda: {c: Counter() for c in range(3)})
    by_size = defaultdict(Counter)
    conf_m = np.zeros((4, 4), dtype=int)  # hàng: GT plastic/metal/other/nền ; cột: đoán plastic/metal/other/bỏ sót
    err = {}
    for i, gts in gt.items():
        ps = [p for p in pr.get(i, []) if p[1] >= t]
        n_err, fp_conf = 0, 0.0
        for c in range(3):
            pc = [p for p in ps if p[0] == c]
            gc = [g for g in gts if g[0] == c]
            flags, used = greedy(pc, gc, thr)
            tp, fp, fn = sum(flags), len(flags) - sum(flags), len(gc) - len(used)
            cnt[c].update(tp=tp, fp=fp, fn=fn)
            n_err += fp + fn
            if fp:
                fp_conf = max([fp_conf] + [p[1] for p, f in zip(sorted(pc, key=lambda p: -p[1]), flags) if not f])
            if meta:
                by_src[meta[i]["src"]][c].update(tp=tp, fp=fp, fn=fn)
                if c in (0, 1):
                    W, H = meta[i]["wh"]
                    s = 640 / max(W, H)
                    for gi, (_, gb) in enumerate(gc):
                        a = (gb[2] - gb[0]) * W * s * (gb[3] - gb[1]) * H * s
                        k = "nhỏ (<32²)" if a < 32 ** 2 else "vừa" if a < 96 ** 2 else "lớn (>96²)"
                        by_size[(CLASSES[c], k)].update(tp=gi in used, n=1)
        # ma trận nhầm lẫn: ghép không phân biệt lớp
        used = set()
        for pc_, _, pb in sorted(ps, key=lambda p: -p[1]):
            best, bi = thr, -1
            for gi, (_, gb) in enumerate(gts):
                if gi not in used and iou(pb, gb) >= best:
                    best, bi = iou(pb, gb), gi
            if bi >= 0:
                used.add(bi)
                conf_m[gts[bi][0], pc_] += 1
            else:
                conf_m[3, pc_] += 1
        for gi, (gc_, _) in enumerate(gts):
            if gi not in used:
                conf_m[gc_, 3] += 1
        err[i] = (n_err, fp_conf)
    pr_ = {}
    for c in range(3):
        tp, fp, fn = cnt[c]["tp"], cnt[c]["fp"], cnt[c]["fn"]
        # không đoán khung nào mà vẫn có vật -> precision 0 (không tính là "đạt")
        pr_[CLASSES[c]] = {"P": tp / (tp + fp) if tp + fp else (0.0 if tp + fn else 1.0),
                           "R": tp / (tp + fn) if tp + fn else 1.0,
                           "tp": tp, "fp": fp, "fn": fn}
    return pr_, by_src, by_size, conf_m, err


def reject_rate(unseen_pr, unseen_cls, t):
    ok = Counter()
    tot = Counter()
    for i, c in unseen_cls.items():
        tot[c] += 1
        ok[c] += not any(p[0] in (0, 1) and p[1] >= t for p in unseen_pr.get(i, []))
    return sum(ok.values()) / max(1, sum(tot.values())), {c: ok[c] / tot[c] for c in sorted(tot)}


def tram(gt, pr, un_pr, t_pm, t_o, thr, n_me):
    """Mô phỏng quyết định của trạm (app/station/controller.py `_process`):
    có box other ≥ t_o -> trả cả mẻ; không có -> nhận cả mẻ, trả tiền theo box nhựa/kim loại ≥ t_pm."""
    o_tot = o_hit = o_pm = 0      # vật other: tổng / bị bắt thành other / bị gọi nhầm là nhựa-kim loại
    pm_tot = pm_false = 0          # vật nhựa/kim loại: tổng / bị box other giả đè lên (làm trả nhầm cả mẻ)
    img = Counter()
    for i, gts in gt.items():
        ps = pr.get(i, [])
        po = [p for p in ps if p[0] == 2 and p[1] >= t_o]
        ppm = [p for p in ps if p[0] in (0, 1) and p[1] >= t_pm]
        if not any(c == 2 for c, _ in gts):
            # ảnh sạch: box other không đè lên vật nào = other giả trên NỀN (cũng làm trả cả mẻ)
            img["nen_gia"] += any(all(iou(p[2], gb) < thr for _, gb in gts) for p in po)
        for c, gb in gts:
            if c == 2:
                o_tot += 1
                if any(iou(p[2], gb) >= thr for p in po):
                    o_hit += 1
                elif any(iou(p[2], gb) >= thr for p in ppm):
                    o_pm += 1
            else:
                pm_tot += 1
                pm_false += any(iou(p[2], gb) >= thr for p in po)
        rej = bool(po)
        if any(c == 2 for c, _ in gts):
            img["co_rac"] += 1
            img["co_rac_tra"] += rej
        else:
            img["sach"] += 1
            img["sach_nhan"] += not rej
            if not rej:
                ok = True
                for c in (0, 1):
                    pc, gc = [p for p in ppm if p[0] == c], [g for g in gts if g[0] == c]
                    flags, used = greedy(pc, gc, thr)
                    ok &= all(flags) and len(used) == len(gc)
                img["sach_dem_dung"] += ok
    catch = o_hit / max(1, o_tot)
    f = pm_false / max(1, pm_tot)
    bg = img["nen_gia"] / max(1, img["sach"])   # 1 mẻ = 1 khung hình khay -> tính 1 lần cho cả mẻ
    un_catch = sum(any(p[0] == 2 and p[1] >= t_o for p in v) for v in un_pr.values()) / max(1, len(un_pr))
    return {"t_o": t_o, "bat_rac": catch, "rac_thanh_nhua_kl": o_pm / max(1, o_tot), "so_rac": o_tot,
            "other_gia_tren_vat": f, "so_vat_nhua_kl": pm_tot, "other_gia_tren_nen": bg,
            "anh_co_rac_tra": img["co_rac_tra"] / max(1, img["co_rac"]), "so_anh_co_rac": img["co_rac"],
            "anh_sach_nhan": img["sach_nhan"] / max(1, img["sach"]), "so_anh_sach": img["sach"],
            "anh_sach_dem_dung": img["sach_dem_dung"] / max(1, img["sach"]),
            "vat_la_bat_other": un_catch,
            "me_sach_nhan": (1 - f) ** n_me * (1 - bg),
            "me_1_rac_tra": 1 - (1 - catch) * (1 - f) ** (n_me - 1) * (1 - bg)}


def font(sz):
    for f in ("arial.ttf", "C:/Windows/Fonts/arial.ttf"):
        try:
            return ImageFont.truetype(f, sz)
        except Exception:
            pass
    return ImageFont.load_default()


def draw_errors(split, gt, pr, t, err, meta, out_dir, n):
    out_dir.mkdir(parents=True, exist_ok=True)
    for p in out_dir.glob("*.jpg"):
        p.unlink()
    worst = sorted((i for i in err if err[i][0] > 0), key=lambda i: (-err[i][0], -err[i][1]))[:n]
    f = font(16)
    rows = []
    for k, i in enumerate(worst):
        im = Image.open(DATA_DIR / "images" / split / f"{i}.jpg").convert("RGB")
        s = 900 / max(im.size)
        if s < 1:
            im = im.resize((round(im.width * s), round(im.height * s)))
        W, H = im.size
        d = ImageDraw.Draw(im)
        for c, b in gt[i]:
            d.rectangle([b[0] * W, b[1] * H, b[2] * W, b[3] * H], outline=GT_COLOR, width=5)
            d.text((b[0] * W + 3, b[3] * H - 20), f"ĐÚNG: {VI[CLASSES[c]]}", fill=GT_COLOR, font=f,
                   stroke_width=2, stroke_fill=(0, 0, 0))
        for c, cf, b in pr.get(i, []):
            if cf >= t:
                d.rectangle([b[0] * W, b[1] * H, b[2] * W, b[3] * H], outline=COLORS[c], width=2)
                d.text((b[0] * W + 3, b[1] * H + 2), f"ĐOÁN: {VI[CLASSES[c]]} {cf:.2f}", fill=COLORS[c], font=f,
                       stroke_width=2, stroke_fill=(0, 0, 0))
        im.save(out_dir / f"{k + 1:03d}_{i}.jpg", quality=88)
        rows.append([f"{k + 1:03d}_{i}.jpg", meta[i]["src"], err[i][0]])
    with open(out_dir / "danh_sach.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["file", "nguon", "so_loi"])
        w.writerows(rows)
    return len(worst)


def speed(weights, paths):
    from ultralytics import YOLO
    res = {}
    for dev, n in (("0", 200), ("cpu", 30)):
        model = YOLO(str(weights))  # model riêng cho mỗi thiết bị (dùng chung GPU->CPU bị lỗi inference tensor)
        ms = []
        for k, path in enumerate(paths[:n + 10]):  # từng ảnh một, giống webcam
            r = model.predict(path, imgsz=640, conf=0.25, device=dev, verbose=False)[0]
            if k >= 10:  # bỏ 10 ảnh khởi động
                ms.append(sum(r.speed.values()))
        res["GPU" if dev == "0" else "CPU"] = {"ms": float(np.mean(ms)), "fps": 1000 / float(np.mean(ms))}
    return res


def plot_sweep(rows, t_op, path, goals):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    ts = [r["t"] for r in rows]
    fig, ax = plt.subplots(figsize=(9, 5))
    for k, lab, st in (("P_plastic", "Precision nhựa", "-"), ("R_plastic", "Recall nhựa", "--"),
                       ("P_metal", "Precision kim loại", "-"), ("R_metal", "Recall kim loại", "--"),
                       ("tu_choi", "Từ chối đúng vật lạ", ":")):
        ax.plot(ts, [r[k] for r in rows], st, marker="o", ms=3, label=lab)
    ax.axvline(t_op, color="k", lw=1)
    ax.text(t_op, 0.02, f" ngưỡng chọn {t_op:.2f}", transform=ax.get_xaxis_transform())
    for g in (goals["precision_plastic_metal"], goals["recall_plastic_metal"], goals["tu_choi_vat_la"]):
        ax.axhline(g, color="gray", lw=0.6, ls=":")
    ax.set_xlabel("ngưỡng conf")
    ax.set_ylim(0, 1.02)
    ax.grid(alpha=0.3)
    ax.legend(loc="lower left", fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("ten")
    ap.add_argument("--test", action="store_true")
    ap.add_argument("--trong-so", default="best", choices=["best", "last"])
    a = ap.parse_args()
    from ultralytics import YOLO
    cfg = load_cfg(run_dir(a.ten) / "cau_hinh.yaml") if (run_dir(a.ten) / "cau_hinh.yaml").is_file() else load_cfg()
    dg = {**load_cfg()["danh_gia"], **cfg["danh_gia"]}  # lần train cũ thiếu khóa mới -> lấy từ cau_hinh.yaml hiện tại
    goals = dg["muc_tieu"]
    split = "test" if a.test else "val"
    out = run_dir(a.ten) / "danh_gia"
    out.mkdir(parents=True, exist_ok=True)
    w = run_dir(a.ten) / "weights" / f"{a.trong_so}.pt"
    model = YOLO(str(w))
    t0 = time.time()

    def tick(msg):
        print(f"  [{fmt_time(time.time() - t0)}] {msg}", flush=True)

    print(f"T3: đánh giá {a.ten} ({w.name}) trên {split}")

    # 1) mAP chính thức của Ultralytics (+ biểu đồ PR, ma trận nhầm lẫn)
    m = model.val(data=cfg["data"], split=split, imgsz=640, batch=16, conf=0.001, iou=0.7, device=0, workers=2,
                  plots=True, project=str(out), name=split, exist_ok=True, verbose=False)
    ap50 = {CLASSES[int(c)]: float(v) for c, v in zip(m.box.ap_class_index, m.box.ap50)}
    ap = {CLASSES[int(c)]: float(v) for c, v in zip(m.box.ap_class_index, m.box.ap)}
    official = {"mAP50": float(m.box.map50), "mAP50_95": float(m.box.map), "AP50": ap50, "AP50_95": ap}
    tick(f"mAP chính thức: mAP50 {official['mAP50']:.3f}, mAP50-95 {official['mAP50_95']:.3f}")

    # 2) dự đoán 1 lần ở conf thấp, rồi quét ngưỡng
    gt = load_gt(split)
    cat = {r["id"]: r for r in csv.DictReader(open(DATA_DIR / "catalog.csv", encoding="utf-8"))}
    meta = {}
    for i in gt:
        with Image.open(DATA_DIR / "images" / split / f"{i}.jpg") as im:
            meta[i] = {"src": cat[i]["src"], "wh": im.size}
    paths = [str(DATA_DIR / "images" / split / f"{i}.jpg") for i in gt]
    pr = predict(model, paths)
    un_rows = list(csv.DictReader(open(DATA_DIR / "unseen_test" / "danh_sach.csv", encoding="utf-8")))
    from pathlib import Path
    un_cls = {Path(r["file"]).stem: r["class"] for r in un_rows}
    un_pr = predict(model, [str(DATA_DIR / "unseen_test" / r["file"]) for r in un_rows])
    tick(f"dự đoán {len(pr)} ảnh {split} + {len(un_pr)} ảnh vật lạ")
    sweep = []
    for t in dg["conf_quet"]:
        p, *_ = eval_at(gt, pr, t, dg["iou"])
        rj, _ = reject_rate(un_pr, un_cls, t)
        sweep.append({"t": t, "P_plastic": p["plastic"]["P"], "R_plastic": p["plastic"]["R"],
                      "P_metal": p["metal"]["P"], "R_metal": p["metal"]["R"],
                      "P_other": p["other"]["P"], "R_other": p["other"]["R"], "tu_choi": rj})

    # 3) ngưỡng vận hành: chọn trên VAL, dùng lại cho TEST
    if a.test:
        kv = json.loads((out / "ketqua_val.json").read_text(encoding="utf-8"))
        t_op, chon = kv["nguong"], "lấy từ đánh giá val"
    else:
        okr = [r for r in sweep if min(r["P_plastic"], r["P_metal"]) >= goals["precision_plastic_metal"]
               and r["tu_choi"] >= goals["tu_choi_vat_la"]]
        if okr:
            t_op, chon = okr[0]["t"], "ngưỡng thấp nhất đạt precision nhựa/kim loại và từ chối vật lạ"
        else:
            best = max(sweep, key=lambda r: min(r["P_plastic"], r["P_metal"], r["tu_choi"],
                                                r["R_plastic"], r["R_metal"]))
            t_op, chon = best["t"], "KHÔNG ngưỡng nào đạt đủ -> chọn ngưỡng cân bằng nhất (chỉ số thấp nhất cao nhất)"
    tick(f"quét {len(sweep)} ngưỡng")
    prc, by_src, by_size, cm, err = eval_at(gt, pr, t_op, dg["iou"], meta)
    rj, rj_cls = reject_rate(un_pr, un_cls, t_op)
    # 3b) chấm theo trạm: ngưỡng riêng cho other (thấp = bắt rác chắc hơn, nhưng dễ trả nhầm mẻ sạch)
    tg = dg["muc_tieu_tram"]
    tr_sweep = [tram(gt, pr, un_pr, t_op, to, dg["iou"], dg["me_so_vat"]) for to in dg["conf_other_quet"]]
    if a.test:
        t_o = kv["tram"]["t_o"]
        tr = tram(gt, pr, un_pr, t_op, t_o, dg["iou"], dg["me_so_vat"])
    else:
        ok = [r for r in tr_sweep if r["me_sach_nhan"] >= tg["me_sach_nhan"]]
        tr = ok[0] if ok else max(tr_sweep, key=lambda r: r["me_sach_nhan"])
    tick(f"chấm theo trạm: ngưỡng other {tr['t_o']:.2f}, bắt rác {tr['bat_rac']:.1%}, "
         f"mẻ sạch {dg['me_so_vat']} vật được nhận {tr['me_sach_nhan']:.1%}")
    plot_sweep(sweep, t_op, out / f"quet_nguong_{split}.png", goals)
    n_err = draw_errors(split, gt, pr, t_op, err, meta, out / f"loi_{split}", dg["so_anh_loi"])
    tick(f"vẽ {n_err} ảnh lỗi")
    spd = speed(w, paths)
    tick("đo tốc độ")
    res = {
        "ten": a.ten, "trong_so": w.name, "tap": split, "so_anh": len(gt), "nguong": t_op, "cach_chon_nguong": chon,
        "chinh_thuc": official, "pr": prc, "quet": sweep, "tu_choi": rj, "tu_choi_theo_loai": rj_cls,
        "ma_tran": cm.tolist(), "tram": tr, "tram_quet": tr_sweep,
        "me_so_vat": dg["me_so_vat"], "toc_do": spd, "so_anh_loi": n_err,
        "theo_nguon": {s: {CLASSES[c]: dict(v[c]) for c in range(3)} for s, v in by_src.items()},
        "theo_kich_thuoc": {f"{k[0]}|{k[1]}": dict(v) for k, v in by_size.items()},
        "thoi_gian": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    (out / f"ketqua_{split}.json").write_text(json.dumps(res, ensure_ascii=False, indent=1), encoding="utf-8")
    write_report(a.ten, goals, tg)
    print(f"  ngưỡng {t_op:.2f} ({chon}); P nhựa {prc['plastic']['P']:.3f} R {prc['plastic']['R']:.3f} | "
          f"P kim loại {prc['metal']['P']:.3f} R {prc['metal']['R']:.3f} | từ chối vật lạ {rj:.1%} | "
          f"GPU {spd['GPU']['fps']:.0f} FPS")
    print(f"T3 xong ({fmt_time(time.time() - t0)}): {out / 'BAO_CAO_TRAIN.md'}")


def write_report(name, goals, tg=None):
    out = run_dir(name) / "danh_gia"
    R = {s: json.loads((out / f"ketqua_{s}.json").read_text(encoding="utf-8"))
         for s in ("val", "test") if (out / f"ketqua_{s}.json").is_file()}
    st, prog = read_status(name), read_progress(name)
    L = [f"# Báo cáo train — {name}", ""]
    if prog:
        best = max(prog, key=lambda x: x["fitness"])
        L += ["## 1. Quá trình train", "",
              f"- Trạng thái: **{st.get('trang_thai', '?')}**, {prog[-1]['epoch']}/{prog[-1]['epochs']} epoch, "
              f"tổng {fmt_time(prog[-1]['da_chay_giay'])} (bắt đầu {st.get('bat_dau', '?')}).",
              f"- Epoch tốt nhất: **{best['epoch']}** (val mAP50 {best['mAP50']:.3f}, mAP50-95 {best['mAP50_95']:.3f}).",
              "- Biểu đồ: `../results.png` (loss, mAP theo epoch), `../confusion_matrix*.png`, `../BoxPR_curve.png`.", ""]
    L += ["## 2. Tiêu chí đạt", "", "| Chỉ số | Mục tiêu | " + " | ".join(R) + " |", "|---|---|" + "---|" * len(R)]

    def row(label, goal, f, fmt="{:.3f}"):
        cells = []
        for r in R.values():
            v = f(r)
            cells.append(f"{fmt.format(v)} {'✅' if v >= goal else '❌'}")
        return f"| {label} | ≥ {fmt.format(goal)} | " + " | ".join(cells) + " |"

    L.append(row("mAP50 (3 lớp)", goals["map50"], lambda r: r["chinh_thuc"]["mAP50"]))
    for c in ("plastic", "metal"):
        L.append(row(f"Precision {VI[c]} (ngưỡng vận hành)", goals["precision_plastic_metal"], lambda r, c=c: r["pr"][c]["P"]))
        L.append(row(f"Recall {VI[c]} (ngưỡng vận hành)", goals["recall_plastic_metal"], lambda r, c=c: r["pr"][c]["R"]))
    L.append(row("Từ chối đúng vật lạ (unseen_test)", goals["tu_choi_vat_la"], lambda r: r["tu_choi"], "{:.1%}"))
    L.append(row("Tốc độ GPU (khung hình/giây)", goals["fps"], lambda r: r["toc_do"]["GPU"]["fps"], "{:.0f}"))
    L += ["", f"Ngưỡng conf vận hành: **{next(iter(R.values()))['nguong']:.2f}** — "
              f"{next(iter(R.values()))['cach_chon_nguong']}. Tốc độ CPU tham khảo: "
              f"{next(iter(R.values()))['toc_do']['CPU']['fps']:.1f} khung hình/giây.", ""]
    for s, r in R.items():
        o = r["chinh_thuc"]
        L += [f"## {'3' if s == 'val' else '4'}. Chi tiết tập {s} ({r['so_anh']} ảnh, trọng số {r['trong_so']})", "",
              f"**mAP chính thức (Ultralytics):** mAP50 {o['mAP50']:.3f}, mAP50-95 {o['mAP50_95']:.3f}. "
              + ", ".join(f"AP50 {VI[c]} {o['AP50'].get(c, 0):.3f}" for c in CLASSES)
              + f". Biểu đồ PR / ma trận nhầm lẫn: `{s}/`.", "",
              f"**Ở ngưỡng {r['nguong']:.2f}:**", "", "| Nhãn | Precision | Recall | Đúng | Báo nhầm | Bỏ sót |",
              "|---|---|---|---|---|---|"]
        for c in CLASSES:
            p = r["pr"][c]
            L.append(f"| {VI[c]} | {p['P']:.3f} | {p['R']:.3f} | {p['tp']} | {p['fp']} | {p['fn']} |")
        cm = r["ma_tran"]
        hdr = ["nhựa", "kim loại", "other", "bỏ sót"]
        L += ["", "**Ma trận nhầm lẫn** (hàng = nhãn đúng, cột = model đoán):", "",
              "| Đúng \\ Đoán | " + " | ".join(hdr) + " |", "|---|---|---|---|---|"]
        for k, lab in enumerate(["nhựa", "kim loại", "other", "nền (không có vật)"]):
            L.append(f"| {lab} | " + " | ".join(str(v) if not (k == 3 and j == 3) else "—" for j, v in enumerate(cm[k])) + " |")
        L += ["", "**Theo nguồn dữ liệu:**", "", "| Nguồn | P nhựa | R nhựa | P kim loại | R kim loại | R other |",
              "|---|---|---|---|---|---|"]

        def pr_(d):
            P = d["tp"] / (d["tp"] + d["fp"]) if d.get("tp", 0) + d.get("fp", 0) else float("nan")
            Rc = d["tp"] / (d["tp"] + d["fn"]) if d.get("tp", 0) + d.get("fn", 0) else float("nan")
            return P, Rc

        for src, v in sorted(r["theo_nguon"].items()):
            pp, rp = pr_(v["plastic"])
            pm, rm = pr_(v["metal"])
            _, ro = pr_(v["other"])
            L.append(f"| {src} | " + " | ".join("—" if x != x else f"{x:.2f}" for x in (pp, rp, pm, rm, ro)) + " |")
        L += ["", "**Recall theo kích thước vật** (cạnh quy về ảnh 640):", "", "| Nhãn | Kích thước | Số vật | Recall |",
              "|---|---|---|---|"]
        for k, v in sorted(r["theo_kich_thuoc"].items()):
            c, sz = k.split("|")
            L.append(f"| {VI[c]} | {sz} | {v['n']} | {v.get('tp', 0) / v['n']:.2f} |")
        L += ["", f"**Từ chối đúng vật lạ:** {r['tu_choi']:.1%} — "
              + ", ".join(f"{k} {v:.0%}" for k, v in sorted(r["tu_choi_theo_loai"].items(), key=lambda x: x[1])), "",
              f"**Quét ngưỡng:** biểu đồ `quet_nguong_{s}.png`", "",
              "| conf | P nhựa | R nhựa | P kim loại | R kim loại | Từ chối vật lạ |", "|---|---|---|---|---|---|"]
        for q in r["quet"]:
            L.append(f"| {q['t']:.2f}{' ◀' if q['t'] == r['nguong'] else ''} | {q['P_plastic']:.3f} | {q['R_plastic']:.3f} | "
                     f"{q['P_metal']:.3f} | {q['R_metal']:.3f} | {q['tu_choi']:.1%} |")
        L += ["", f"**Ảnh lỗi:** {r['so_anh_loi']} ảnh sai nhiều nhất trong `loi_{s}/` (khung vàng = nhãn đúng, "
                  f"khung màu = model đoán: xanh lá nhựa, xanh dương kim loại, đỏ other).",
              f"**Tốc độ:** GPU {r['toc_do']['GPU']['ms']:.1f} ms/ảnh ({r['toc_do']['GPU']['fps']:.0f} FPS), "
              f"CPU {r['toc_do']['CPU']['ms']:.0f} ms/ảnh.", ""]
        if "tram" in r:
            t, n, g = r["tram"], r["me_so_vat"], tg or {}
            L += [f"## {'5' if s == 'val' else '6'}. Chấm theo trạm ({s})", "",
                  f"Mô phỏng `controller._process`: ảnh có box other ≥ ngưỡng other → **trả cả mẻ**; không có → nhận "
                  f"cả mẻ, trả tiền theo box nhựa/kim loại ≥ {r['nguong']:.2f}. Mẻ {n} vật là **ước tính**: "
                  f"(1 − other giả trên từng chai/lon)^{n} × (1 − other giả trên nền), coi các vật độc lập.", "",
                  f"Ngưỡng other: **{t['t_o']:.2f}** (thấp nhất mà mẻ sạch {n} vật được nhận ≥ "
                  f"{g.get('me_sach_nhan', 0):.0%}; không ngưỡng nào đạt thì lấy ngưỡng có tỉ lệ nhận cao nhất).", "",
                  "| Chỉ số | Mục tiêu | Kết quả |", "|---|---|---|",
                  f"| Bắt được rác (từng vật other, {t['so_rac']} vật) | ≥ {g.get('bat_rac', 0):.0%} | {t['bat_rac']:.1%} |",
                  f"| Rác bị gọi nhầm là nhựa/kim loại | — | {t['rac_thanh_nhua_kl']:.1%} |",
                  f"| Chai/lon bị box other giả đè lên ({t['so_vat_nhua_kl']} vật) | — | {t['other_gia_tren_vat']:.1%} |",
                  f"| Ảnh sạch có box other giả trên nền ({t['so_anh_sach']} ảnh) | — | "
                  f"{t.get('other_gia_tren_nen', float('nan')):.1%} |",
                  f"| Ảnh có rác bị trả đúng ({t['so_anh_co_rac']} ảnh) | — | {t['anh_co_rac_tra']:.1%} |",
                  f"| Ảnh sạch được nhận ({t['so_anh_sach']} ảnh) | — | {t['anh_sach_nhan']:.1%} |",
                  f"| Ảnh sạch được nhận **và đếm đúng hết** chai/lon | — | {t['anh_sach_dem_dung']:.1%} |",
                  f"| Vật lạ (unseen) bị bắt thành other | — | {t['vat_la_bat_other']:.1%} |",
                  f"| Ước tính: mẻ sạch {n} vật được nhận | ≥ {g.get('me_sach_nhan', 0):.0%} | {t['me_sach_nhan']:.1%} |",
                  f"| Ước tính: mẻ {n} vật lẫn 1 rác bị trả | ≥ {g.get('me_1_rac_tra', 0):.0%} | {t['me_1_rac_tra']:.1%} |",
                  "", "**Quét ngưỡng other:**", "",
                  f"| conf other | Bắt rác | Chai/lon bị other đè | Other giả trên nền | Mẻ sạch {n} vật nhận | "
                  f"Mẻ lẫn 1 rác bị trả | Vật lạ bắt thành other |", "|---|---|---|---|---|---|---|"]
            for q in r["tram_quet"]:
                L.append(f"| {q['t_o']:.2f}{' ◀' if q['t_o'] == t['t_o'] else ''} | {q['bat_rac']:.1%} | "
                         f"{q['other_gia_tren_vat']:.1%} | {q.get('other_gia_tren_nen', float('nan')):.1%} | "
                         f"{q['me_sach_nhan']:.1%} | {q['me_1_rac_tra']:.1%} | "
                         f"{q['vat_la_bat_other']:.1%} |")
            L.append("")
    (out / "BAO_CAO_TRAIN.md").write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    main()
