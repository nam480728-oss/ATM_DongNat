"""B15 — Rà soát trước train lần 3 (19/11, anh/chị chốt phương án A):
  1) vật bị gán 2 nhãn khác nhau (2 box IoU > 0,7): bỏ box sai theo bảng SUA (đã xem ảnh), ảnh không rõ -> bỏ ảnh
  2) box trùng cùng nhãn (IoU > 0,7): giữ 1 box
Chạy: python models/scripts/Xu_Ly_Du_Lieu/15_sua_nhan_chong.py [--thu]
"""
import argparse
import csv
import importlib.util
import itertools
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
HERE = Path(__file__).resolve().parent
D = HERE.parents[1] / "data_da_xu_ly"
GC = D / "_ghi_chep"
IOU = 0.7
# ảnh -> lớp cần bỏ khỏi cặp box chồng nhau (0 plastic, 1 metal, 2 other)
SUA = {
    "taco__batch_1_000092": 2, "taco__batch_1_000092__zoom": 2,     # hộp sữa chua nhựa: bỏ box other (nắp)
    "taco__batch_12_000046": 2,                                      # mảnh nhựa nhỏ: bỏ other
    "taco__batch_2_000010": 2, "taco__batch_2_000010__zoom": 2,     # ly nhựa: bỏ other
    "taco__batch_3_IMG_4876": 2,                                     # khay nhựa: bỏ other
    "oi__c2c747f698ebd308": 1, "oi__aeae1748585190df": 1,           # chai bia THỦY TINH: bỏ metal
}
BO_ANH = {"oi__c2a8a077ee745efe": "rà soát: chai Cachaça vừa plastic vừa other, không rõ lon hay chai thủy tinh"}


def iou(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    i = ix * iy
    u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - i
    return i / u if u > 0 else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--thu", action="store_true")
    a = ap.parse_args()
    spec = importlib.util.spec_from_file_location("b12", HERE / "12_ap_dung_khong_ro.py")
    b12 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(b12)
    fields, rows = b12.read_catalog()
    log, n_sua, n_trung, khac = [], 0, 0, []
    for r in rows:
        sp, i = r["split"], r["id"]
        if i in BO_ANH:
            continue
        lp = D / "labels" / sp / f"{i}.txt"
        L = [l for l in lp.read_text().splitlines() if l.strip()]
        B = []
        for l in L:
            c, x, y, w, h = l.split()
            x, y, w, h = map(float, (x, y, w, h))
            B.append((int(c), [x - w / 2, y - h / 2, x + w / 2, y + h / 2]))
        bo = set()
        for (j, (c1, b1)), (k, (c2, b2)) in itertools.combinations(enumerate(B), 2):
            if j in bo or k in bo or iou(b1, b2) <= IOU:
                continue
            if c1 == c2:
                bo.add(k)
                n_trung += 1
                log.append([sp, i, "trung_cung_lop", L[k]])
            elif i in SUA and SUA[i] in (c1, c2):
                kk = j if c1 == SUA[i] else k
                bo.add(kk)
                n_sua += 1
                log.append([sp, i, "chong_khac_lop", L[kk]])
            else:
                khac.append(i)
        if bo and not a.thu:
            lp.write_text("\n".join(l for m, l in enumerate(L) if m not in bo) + "\n")
    print(f"bỏ box trùng cùng lớp: {n_trung} | bỏ box sai nhãn (chồng khác lớp): {n_sua} | chưa xử lý: {khac}")
    ids = b12.family(set(BO_ANH), rows) & {r["id"] for r in rows}
    print(f"bỏ ảnh: {sorted(ids)}")
    if a.thu:
        return
    rows = b12.drop_images(ids, lambda i: BO_ANH.get(i, "cùng họ zoom với ảnh bị bỏ"), fields, rows)
    b12.recount(rows)
    b12.write_catalog(fields, rows)
    with open(GC / "ra_soat_b15.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["split", "image_id", "loai", "dong_nhan_bi_bo"])
        w.writerows(log)
    for p in (D / "labels").glob("*.cache"):
        p.unlink()
    print(f"Xong. Còn {len(rows)} ảnh.")


if __name__ == "__main__":
    main()
