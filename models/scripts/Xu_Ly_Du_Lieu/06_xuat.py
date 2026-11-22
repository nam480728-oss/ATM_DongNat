"""B6 — Xuất dữ liệu sạch (CHƯA chia train/val/test) vào models/data_da_xu_ly/.

  images/<id>.jpg + labels/<id>.txt   (YOLO: "cls cx cy w h", 0=plastic 1=metal 2=other; ảnh nền = file rỗng)
  classes.txt                         tên nhãn theo thứ tự id
  catalog.csv                         thông tin từng ảnh (nguồn, số box từng nhãn, split_key để chia tập sau)
  unseen_test/images + danh_sach.csv  600 ảnh vật lạ (KHÔNG train)
  ko_ro/                              ảnh cắt từng vật không chắc + _map.csv + HUONG_DAN.txt
  review/index.html                   trang xem ảnh có vẽ box
  BAO_CAO.md                          thống kê
Chạy:  python models/scripts/Xu_Ly_Du_Lieu/06_xuat.py
"""
import csv
import json
import random
import shutil
from collections import Counter, defaultdict

from PIL import Image, ImageDraw

from common import CLASSES, OUT, SEED, WORK, crop_box, log, read_jsonl, write_jsonl

KO_RO_DIRS = ["plastic", "metal", "other", "bo"]
SUG = {"plastic": "p", "metal": "m", "other": "o"}
DECISIONS = WORK / "ko_ro_quyet_dinh.csv"  # kết quả phân loại tay (B8 ghi), giữ lại qua mọi lần chạy lại


def load_decisions():
    """{(image_id, box_index): (cls, xyxy)} từ file quyết định phân loại tay."""
    if not DECISIONS.is_file():
        return {}
    return {(r["image_id"], int(r["box_index"])): (r["cls"], [float(r[k]) for k in ("x0", "y0", "x1", "y1")])
            for r in csv.DictReader(open(DECISIONS, encoding="utf-8"))}


def apply_decisions(all_recs):
    """Áp quyết định tay vào các ảnh pending. Ảnh có đủ quyết định -> ok (+ ảnh zoom) hoặc bị bỏ (bo)."""
    import importlib
    zoom = importlib.import_module("05_box_zoom")
    dec = load_decisions()
    st, extra = Counter(), []
    for r in all_recs:
        if r["drop"] or r.get("status") != "pending":
            continue
        ko = [k for k, b in enumerate(r["boxes"]) if b["cls"] == "ko_ro"]
        ds = []
        for k in ko:
            d = dec.get((r["id"], k))
            if d and max(abs(a - b) for a, b in zip(d[1], r["boxes"][k]["xyxy"])) > 1e-3:
                st["quyết định lệch box (bỏ qua)"] += 1
                d = None
            ds.append(d[0] if d else None)
        if None in ds:
            continue
        if "bo" in ds:
            r["drop"] = "anh/chị chọn bỏ (ko_ro/bo)"
            st["ảnh bỏ theo phân loại tay"] += 1
            continue
        for k, d in zip(ko, ds):
            r["boxes"][k]["cls"] = d
            r["boxes"][k]["src_cls"] += " +tay"
        r["status"] = "ok"
        r["flags"] = r["flags"] + ["nhãn phân loại tay"]
        st["ảnh nhận nhãn phân loại tay"] += 1
        if r["src"] in zoom.ZOOM_SRC:
            z = zoom.make_zoom(r)
            if z:
                z["status"] = "ok"
                extra.append(z)
    st["ảnh zoom thêm từ ảnh phân loại tay"] = len(extra)
    return all_recs + extra, st


def yolo_lines(boxes):
    out = []
    for b in boxes:
        x0, y0, x1, y1 = b["xyxy"]
        out.append(f"{CLASSES.index(b['cls'])} {(x0 + x1) / 2:.6f} {(y0 + y1) / 2:.6f} {x1 - x0:.6f} {y1 - y0:.6f}")
    return "\n".join(out) + ("\n" if out else "")


OTHER_BO = WORK / "other_bo.csv"  # B9 cân bằng other: danh sách ảnh chỉ-other bị chuyển sang dự phòng


def apply_other_bo(all_recs):
    """Đánh dấu bỏ các ảnh trong other_bo.csv. Chốt an toàn: chỉ bỏ ảnh mà MỌI box đều là other."""
    if not OTHER_BO.is_file():
        return []
    why = {r["id"]: r["ly_do"] for r in csv.DictReader(open(OTHER_BO, encoding="utf-8"))}
    out = []
    for r in all_recs:
        if r["id"] in why and not r["drop"] and r.get("status") == "ok":
            if not r["boxes"] or any(b["cls"] != "other" for b in r["boxes"]):
                log(f"  !! {r['id']} có plastic/metal hoặc không có box -> KHÔNG bỏ")
                continue
            r["drop"] = f"cân bằng other: {why[r['id']]}"
            out.append(r)
    return out


def export_du_phong(recs):
    d = OUT / "other_du_phong"
    if d.exists():
        shutil.rmtree(d)
    (d / "images").mkdir(parents=True)
    (d / "labels").mkdir()
    for r in recs:
        shutil.copyfile(r["file"], d / "images" / f"{r['id']}.jpg")
        (d / "labels" / f"{r['id']}.txt").write_text(yolo_lines(r["boxes"]), encoding="utf-8")
    with open(d / "danh_sach.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "ly_do", "so_box_other", "src", "group", "split_key"])
        for r in recs:
            w.writerow([r["id"], r["drop"].removeprefix("cân bằng other: "), len(r["boxes"]), r["src"], r["group"],
                        r["split_key"]])


def export_ok(recs):
    img_d, lbl_d = OUT / "images", OUT / "labels"
    for d in (img_d, lbl_d):
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
    for r in recs:
        shutil.copyfile(r["file"], img_d / f"{r['id']}.jpg")
        (lbl_d / f"{r['id']}.txt").write_text(yolo_lines(r["boxes"]), encoding="utf-8")
    (OUT / "classes.txt").write_text("\n".join(CLASSES) + "\n", encoding="utf-8")


def export_catalog(recs, path):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["id", "src", "group", "n_plastic", "n_metal", "n_other", "split_key", "parent", "phash", "flags", "raw"])
        for r in recs:
            c = Counter(b["cls"] for b in r["boxes"])
            w.writerow([r["id"], r["src"], r["group"], c["plastic"], c["metal"], c["other"], r["split_key"],
                        r.get("parent", ""), r.get("phash", ""), "; ".join(r["flags"]), r["raw"]])


def export_unseen():
    d = OUT / "unseen_test"
    (d / "images").mkdir(parents=True, exist_ok=True)
    rows = read_jsonl(WORK / "unseen.jsonl")
    for u in rows:
        dst = d / "images" / f"{u['id']}.jpg"
        if not dst.is_file():
            shutil.copyfile(u["raw"], dst)
    with open(d / "danh_sach.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "class"])
        w.writerows([(f"images/{u['id']}.jpg", u["class"]) for u in rows])
    return Counter(u["class"] for u in rows)


def export_ko_ro(pending):
    d = OUT / "ko_ro"
    if d.exists() and any(any((d / s).glob("*.jpg")) for s in KO_RO_DIRS if (d / s).is_dir()):
        log("  !! ko_ro đã có ảnh được phân loại tay -> KHÔNG ghi đè ko_ro")
        return None
    if d.exists():
        shutil.rmtree(d)
    d.mkdir(parents=True)
    for s in KO_RO_DIRS:
        (d / s).mkdir()
    rows = []
    decided = load_decisions()
    for r in pending:
        im = Image.open(r["file"]).convert("RGB")
        W, H = im.size
        for k, b in enumerate(r["boxes"]):
            if b["cls"] != "ko_ro" or (r["id"], k) in decided:
                continue
            x0, y0, x1, y1 = b["xyxy"]
            bw, bh = (x1 - x0) * W, (y1 - y0) * H
            m = 0.35
            cx0, cy0 = max(0, x0 * W - m * bw - 10), max(0, y0 * H - m * bh - 10)
            cx1, cy1 = min(W, x1 * W + m * bw + 10), min(H, y1 * H + m * bh + 10)
            c = im.crop((int(cx0), int(cy0), int(cx1), int(cy1)))
            ImageDraw.Draw(c).rectangle([x0 * W - cx0, y0 * H - cy0, x1 * W - cx0, y1 * H - cy0],
                                        outline=(255, 0, 0), width=max(2, int(max(c.size) / 150)))
            if max(c.size) < 224:
                s = 224 / max(c.size)
                c = c.resize((round(c.width * s), round(c.height * s)), Image.LANCZOS)
            c.thumbnail((512, 512))
            name = f"{SUG.get(b.get('suggest'), 'o')}__{r['id']}__b{k}.jpg"
            c.save(d / name, quality=92)
            rows.append([name, r["id"], k, *[f"{v:.5f}" for v in b["xyxy"]], b["src_cls"], b.get("suggest", ""),
                         json.dumps(b.get("clip", {}))])
    with open(d / "_map.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "image_id", "box_index", "x0", "y0", "x1", "y1", "nguon_box", "goi_y", "clip"])
        w.writerows(rows)
    (d / "HUONG_DAN.txt").write_text(
        "PHÂN LOẠI TAY CÁC VẬT KHÔNG CHẮC CHẮN\n"
        "=====================================\n"
        "Mỗi ảnh nhỏ = 1 vật, vật cần phân loại nằm trong KHUNG ĐỎ.\n"
        "Kéo từng ảnh vào 1 trong 4 thư mục:\n"
        "  plastic/  đồ nhựa thường ngày (chai, ly, hộp nhựa, bình xịt nhựa)\n"
        "  metal/    lon nhôm, lon thép, bình xịt kim loại, hộp/thùng sơn\n"
        "  other/    mọi thứ khác (thủy tinh, giấy, túi nilon, nắp chai, pin, đồ điện tử...)\n"
        "  bo/       khung đỏ sai/không rõ vật gì/ảnh quá mờ -> bỏ CẢ ảnh gốc\n"
        "Chữ đầu tên file là gợi ý của máy: p = plastic, m = metal, o = other (chỉ để tham khảo).\n"
        "KHÔNG đổi tên file. Có thể để lại ảnh chưa phân loại ở thư mục ko_ro, lần sau làm tiếp.\n"
        "Xong thì báo Claude chạy: python models/scripts/Xu_Ly_Du_Lieu/08_ap_dung_ko_ro.py\n",
        encoding="utf-8")
    return Counter(r[8] for r in rows)


def export_review(recs, path):
    rng = random.Random(SEED)
    by = defaultdict(list)
    for r in recs:
        c = Counter(b["cls"] for b in r["boxes"])
        main = "metal" if c["metal"] else "plastic" if c["plastic"] else "other" if c["other"] else "nen"
        by[(r["src"], main, "zoom" if r.get("parent") else "goc")].append(r)
    sample = []
    for k, v in sorted(by.items()):
        rng.shuffle(v)
        for r in v[:40]:
            sample.append({"id": r["id"], "src": r["src"], "main": k[1], "kind": k[2], "group": r["group"],
                           "b": [[CLASSES.index(b["cls"]), *[round(x, 4) for x in b["xyxy"]]] for b in r["boxes"]]})
    html = """<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Xem dữ liệu đã xử lý</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#f4f4f4}
.bar{position:sticky;top:0;background:#fff;padding:8px;border-radius:8px;box-shadow:0 1px 4px #0002;z-index:9}
.g{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.c{background:#fff;border-radius:6px;padding:4px;width:240px;font-size:11px;color:#444}
.w{position:relative;width:240px}.w img{width:100%;display:block}
.bx{position:absolute;border:2px solid;box-sizing:border-box}
.bx span{position:absolute;top:-14px;left:-2px;font-size:10px;color:#fff;padding:0 2px}
.k0{border-color:#1e88e5}.k0 span{background:#1e88e5}.k1{border-color:#e53935}.k1 span{background:#e53935}
.k2{border-color:#fdd835}.k2 span{background:#9e8a00}
</style></head><body>
<div class="bar">Nguồn <select id="s"></select> Nhãn chính <select id="m"></select> Loại <select id="k"></select>
<span id="n"></span> — <b style="color:#1e88e5">plastic</b> <b style="color:#e53935">metal</b> <b style="color:#9e8a00">other</b></div>
<div class="g" id="g"></div>
<script>
const D=__DATA__;const N=["plastic","metal","other"];
function opts(id,key){const v=["(tất cả)",...new Set(D.map(d=>d[key]))];document.getElementById(id).innerHTML=v.map(x=>`<option>${x}</option>`).join("");document.getElementById(id).onchange=draw}
opts("s","src");opts("m","main");opts("k","kind");
function draw(){const f=["s","m","k"].map(i=>document.getElementById(i).value);const ks=["src","main","kind"];
const L=D.filter(d=>ks.every((k,i)=>f[i]=="(tất cả)"||d[k]==f[i]));document.getElementById("n").textContent=L.length+" ảnh";
document.getElementById("g").innerHTML=L.map(d=>`<div class="c"><div class="w"><img loading="lazy" src="../images/${d.id}.jpg">${d.b.map(b=>`<div class="bx k${b[0]}" style="left:${b[1]*100}%;top:${b[2]*100}%;width:${(b[3]-b[1])*100}%;height:${(b[4]-b[2])*100}%"><span>${N[b[0]]}</span></div>`).join("")}</div>${d.id}<br>${d.group}</div>`).join("")}
draw();
</script></body></html>"""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(html.replace("__DATA__", json.dumps(sample)), encoding="utf-8")
    return len(sample)


def report(recs, all_recs, pending, unseen_cnt, ko_ro_cnt, n_review):
    by_src = defaultdict(Counter)
    tot = Counter()
    for r in recs:
        c = Counter(b["cls"] for b in r["boxes"])
        s = by_src[r["src"]]
        s["ảnh"] += 1
        s["zoom"] += bool(r.get("parent"))
        s["nền"] += not r["boxes"]
        for k in CLASSES:
            s[f"img_{k}"] += bool(c[k])
            s[f"box_{k}"] += c[k]
        tot.update(s.keys() and {})
    drops = Counter((r["src"], r["drop"].split(" ")[0] if r["drop"].startswith("trùng") else r["drop"])
                    for r in all_recs if r["drop"])
    names = {"dw": "Kaggle Drinking Waste", "g12": "Kaggle Garbage 12", "rf": "Roboflow", "taco": "TACO",
             "coco": "COCO", "oi": "Open Images"}
    L = ["# Báo cáo dữ liệu đã xử lý — ATM Đồng Nát", "",
         "Dữ liệu sạch, **chưa chia** train/val/test. Định dạng YOLO: `images/<id>.jpg` + `labels/<id>.txt`, "
         "nhãn `0 plastic`, `1 metal`, `2 other`; ảnh nền có file nhãn rỗng.", "",
         "## 1. Tổng quan", "",
         "| Nguồn | Ảnh | Ảnh có nhựa | Ảnh có kim loại | Ảnh có other | Ảnh nền | Ảnh zoom | Box nhựa | Box kim loại | Box other |",
         "|---|---|---|---|---|---|---|---|---|---|"]
    T = Counter()
    for k in ["dw", "g12", "rf", "taco", "coco", "oi"]:
        s = by_src[k]
        T.update(s)
        L.append(f"| {names[k]} | {s['ảnh']:,} | {s['img_plastic']:,} | {s['img_metal']:,} | {s['img_other']:,} | "
                 f"{s['nền']:,} | {s['zoom']:,} | {s['box_plastic']:,} | {s['box_metal']:,} | {s['box_other']:,} |")
    L.append(f"| **Tổng** | **{T['ảnh']:,}** | **{T['img_plastic']:,}** | **{T['img_metal']:,}** | **{T['img_other']:,}** | "
             f"**{T['nền']:,}** | **{T['zoom']:,}** | **{T['box_plastic']:,}** | **{T['box_metal']:,}** | **{T['box_other']:,}** |")
    L += ["", f"- Ảnh chờ phân loại tay (`ko_ro`): **{len(pending):,} ảnh gốc**, "
          f"**{'?' if ko_ro_cnt is None else sum(ko_ro_cnt.values())} ảnh cắt** "
          f"(gợi ý của máy: {dict(ko_ro_cnt) if ko_ro_cnt else '—'}). Các ảnh này CHƯA có trong `images/`.",
          f"- Tập vật lạ `unseen_test/`: {sum(unseen_cnt.values())} ảnh — {', '.join(f'{k} {v}' for k, v in sorted(unseen_cnt.items()))}.",
          f"- Trang xem ảnh: `review/index.html` ({n_review} ảnh mẫu, lọc theo nguồn / nhãn / ảnh zoom).", "",
          "## 2. Ảnh bị loại", "", "| Nguồn | Lý do | Số ảnh |", "|---|---|---|"]
    for (s, why), n in sorted(drops.items()):
        L.append(f"| {names.get(s, s)} | {why} | {n:,} |")
    L += ["", "## 3. Cách xử lý (tóm tắt)", "",
          "1. Chuẩn hóa: xoay ảnh theo EXIF, thu nhỏ cạnh dài ≤ 1280 px, ánh xạ nhãn theo bảng trong `plan_xu_ly_data.md`.",
          "2. Khử trùng lặp pHash (≤ 4) — giữ 1 ảnh; ảnh gần giống (≤ 8), cùng video, ảnh zoom + ảnh gốc có chung `split_key`.",
          "3. YOLO-World (công cụ offline): vẽ box cho Garbage 12; soát chai/lon chưa gán nhãn.",
          "4. CLIP ViT-L/14 (công cụ offline): quyết chất liệu; không chắc -> `ko_ro`.",
          "5. Box < 12 px (ảnh 640) bị bỏ; nếu là chai/lon thì tô xám vùng đó. Tạo ảnh zoom cận cho vật nhỏ.",
          f"6. Phân loại tay `ko_ro` (lưu ở `_work/ko_ro_quyet_dinh.csv`): {len(load_decisions()):,} box đã có quyết định; "
          f"ảnh nhận nhãn tay có cờ \"nhãn phân loại tay\" trong catalog.csv.",
          "", "Script: `models/scripts/Xu_Ly_Du_Lieu/`. File trung gian: `_work/` (xóa được khi xong).", ""]
    (OUT / "BAO_CAO.md").write_text("\n".join(L), encoding="utf-8")


def main():
    all_recs, st = apply_decisions(read_jsonl(WORK / "cat_05.jsonl"))
    for k, v in sorted(st.items()):
        log(f"  {k}: {v}")
    du_phong = apply_other_bo(all_recs)
    if du_phong:
        log(f"  cân bằng other: chuyển {len(du_phong)} ảnh sang other_du_phong/")
    export_du_phong(du_phong)
    ok = [r for r in all_recs if not r["drop"] and r.get("status") == "ok"]
    pending = [r for r in all_recs if not r["drop"] and r.get("status") == "pending"]
    log(f"B6: xuất {len(ok)} ảnh sạch, {len(pending)} ảnh chờ phân loại tay...")
    export_ok(ok)
    export_catalog(ok, OUT / "catalog.csv")
    write_jsonl(WORK / "pending.jsonl", pending)
    unseen_cnt = export_unseen()
    ko_ro_cnt = export_ko_ro(pending)
    n_review = export_review(ok, OUT / "review" / "index.html")
    report(ok, all_recs, pending, unseen_cnt, ko_ro_cnt, n_review)
    log(f"  ko_ro: {'giữ nguyên' if ko_ro_cnt is None else dict(ko_ro_cnt) or 'trống (đã phân loại hết)'}; "
        f"unseen: {sum(unseen_cnt.values())}")
    log("B6 xong.")


if __name__ == "__main__":
    main()
