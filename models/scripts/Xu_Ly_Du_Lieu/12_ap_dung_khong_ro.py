"""B12 — Áp dụng kết quả phân loại tay trong data_da_xu_ly/khong_ro/ (xuất bởi B11).

Quy ước (anh/chị chốt 19/11):
  - ảnh còn trong thư mục = nhãn của box (thư mục khác nhãn cũ -> đổi nhãn)
  - ảnh nằm trong khong_ro/bo/ hoặc ĐÃ BỊ XÓA -> bỏ hẳn ảnh gốc
  - ảnh gốc bị bỏ thì bỏ luôn cả "họ" zoom (ảnh zoom cắt từ nó / ảnh gốc của ảnh zoom) vì cùng vật, cùng nhãn sai
Ảnh bị bỏ được chuyển sang data_da_xu_ly/_da_loai/<split>/ (images + labels), catalog.csv cập nhật.
Nhật ký: _ghi_chep/khong_ro_quyet_dinh.csv, _ghi_chep/da_loai.csv

Chạy:  python 12_ap_dung_khong_ro.py [--thu]   (--thu: chỉ in thống kê, không sửa)
"""
import argparse
import csv
import shutil
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
D = Path(__file__).resolve().parents[2] / "data_da_xu_ly"
KR = D / "khong_ro"
GC = D / "_ghi_chep"
N = ["plastic", "metal", "other"]


def read_catalog():
    with open(D / "catalog.csv", encoding="utf-8") as f:
        rd = csv.DictReader(f)
        return rd.fieldnames, list(rd)


def write_catalog(fields, rows):
    with open(D / "catalog.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)


def drop_images(ids, reason, fields, rows, dry=False):
    """Chuyển ảnh + nhãn sang _da_loai/, xóa dòng catalog, ghi nhật ký. Trả về rows còn lại."""
    by = {r["id"]: r for r in rows}
    log = []
    for iid in sorted(ids):
        r = by[iid]
        sp = r["split"]
        if not dry:
            for sub, ext in (("images", ".jpg"), ("labels", ".txt")):
                src = D / sub / sp / f"{iid}{ext}"
                dst = D / "_da_loai" / sub / sp / f"{iid}{ext}"
                dst.parent.mkdir(parents=True, exist_ok=True)
                if src.exists():
                    shutil.move(str(src), str(dst))
        log.append([sp, iid, r["src"], r["group"], reason(iid) if callable(reason) else reason])
    if not dry:
        new = not (GC / "da_loai.csv").exists()
        with open(GC / "da_loai.csv", "a", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            if new:
                w.writerow(["split", "image_id", "src", "group", "ly_do"])
            w.writerows(log)
    return [r for r in rows if r["id"] not in ids]


def family(ids, rows):
    """Mở rộng tập ảnh bỏ sang ảnh zoom con / ảnh gốc cha (cùng vật)."""
    parent = {r["id"]: r["parent"] for r in rows if r["parent"]}
    kids = {}
    for c, p in parent.items():
        kids.setdefault(p, set()).add(c)
    out = set(ids)
    for i in ids:
        out |= kids.get(i, set())
        if i in parent:
            out.add(parent[i])
    return out


def recount(rows):
    for r in rows:
        lp = D / "labels" / r["split"] / f"{r['id']}.txt"
        cs = [int(x.split()[0]) for x in lp.read_text().split("\n") if x.strip()]
        r["n_plastic"], r["n_metal"], r["n_other"] = (str(cs.count(k)) for k in range(3))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--thu", action="store_true")
    dry = ap.parse_args().thu
    fields, rows = read_catalog()
    mp = list(csv.DictReader(open(KR / "_map.csv", encoding="utf-8")))
    where = {}
    for d in KR.iterdir():
        if d.is_dir():
            for f in d.rglob("*.jpg"):
                where[f.name] = d.name
    st = Counter()
    relabel = {}   # (split, id, box) -> new cls
    drop = {}      # id -> lý do
    dec = []
    for r in mp:
        loc = where.get(r["file"])
        if loc is None or loc == "bo":
            act = "bo_anh"
            drop[r["image_id"]] = f"phân loại tay khong_ro: box {r['box']} ({r['nhan_cu']}) bị {'xóa' if loc is None else 'đưa vào bo'}"
        elif loc in N and loc != r["nhan_cu"]:
            act = f"doi_{loc}"
            relabel[(r["split"], r["image_id"], int(r["box"]))] = N.index(loc)
        elif loc in N:
            act = "giu"
        else:
            sys.exit(f"!! thư mục lạ trong khong_ro: {loc}")
        st[(r["nhan_cu"], act)] += 1
        dec.append([r["file"], r["split"], r["image_id"], r["box"], r["nhan_cu"], r["may_nghi"], act])
    for k, v in sorted(st.items()):
        print(f"  {k[0]:7s} -> {k[1]:10s}: {v}")
    fam = family(set(drop), rows)
    extra = fam - set(drop)
    print(f"Ảnh gốc bỏ: {len(drop)} + {len(extra)} ảnh cùng họ zoom = {len(fam)}")
    print(f"Box đổi nhãn: {len(relabel)}")
    if dry:
        return
    # đổi nhãn (bỏ qua ảnh sắp bị loại)
    for (sp, iid, k), c in relabel.items():
        if iid in fam:
            continue
        lp = D / "labels" / sp / f"{iid}.txt"
        ls = [x for x in lp.read_text().split("\n") if x.strip()]
        p = ls[k].split()
        ls[k] = " ".join([str(c)] + p[1:])
        lp.write_text("\n".join(ls) + "\n")
    with open(GC / "khong_ro_quyet_dinh.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "split", "image_id", "box", "nhan_cu", "may_nghi", "quyet_dinh"])
        w.writerows(dec)
    shutil.copy(KR / "_map.csv", GC / "khong_ro_map.csv")
    rows = drop_images(fam, lambda i: drop.get(i, "cùng họ zoom với ảnh bị bỏ (khong_ro)"), fields, rows)
    recount(rows)
    write_catalog(fields, rows)
    print("Đã áp dụng. Còn", len(rows), "ảnh.")


if __name__ == "__main__":
    main()
