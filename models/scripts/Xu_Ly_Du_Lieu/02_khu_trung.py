"""B2 — Khử trùng lặp bằng pHash + gom nhóm ảnh gần giống (split_key) để chia tập sau này không rò rỉ.

Chạy:  python models/scripts/Xu_Ly_Du_Lieu/02_khu_trung.py
Vào:   _work/cat_01.jsonl     Ra: _work/cat_02.jsonl, _work/dedupe_pairs.csv
Luật:  khoảng cách pHash ≤ DUP  -> trùng, giữ 1 ảnh (ưu tiên ảnh nhiều box, nguồn nhãn tốt)
       khoảng cách pHash ≤ NEAR -> cùng split_key (không xóa)
"""
import csv
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor

import imagehash
import numpy as np
from PIL import Image

from common import WORK, log, read_jsonl, write_jsonl

DUP, NEAR = 4, 8
SRC_PRIO = {"rf": 0, "dw": 1, "taco": 2, "oi": 3, "coco": 4, "g12": 5}


def phash(r):
    with Image.open(r["file"]) as im:
        return int(str(imagehash.phash(im)), 16)


class UF:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        a, b = self.find(a), self.find(b)
        if a != b:
            self.p[max(a, b)] = min(a, b)


def main():
    recs = read_jsonl(WORK / "cat_01.jsonl")
    live = [r for r in recs if not r["drop"]]
    log(f"B2: tính pHash {len(live)} ảnh...")
    with ThreadPoolExecutor(8) as ex:
        hs = np.array(list(ex.map(phash, live)), dtype=np.uint64)
    n = len(live)
    dup, near = UF(n), UF(n)
    pairs = []
    for i in range(0, n, 2000):
        d = np.bitwise_count(hs[i:i + 2000, None] ^ hs[None, :])
        a, b = np.nonzero(d <= NEAR)
        for x, y in zip(a + i, b):
            if x < y:
                near.union(x, y)
                if d[x - i, y] <= DUP:
                    dup.union(x, y)
                    pairs.append((live[x]["id"], live[y]["id"], int(d[x - i, y])))
    # split_key gốc (video, ảnh gốc Roboflow) cũng gom chung
    by_key = defaultdict(list)
    for i, r in enumerate(live):
        by_key[r["split_key"]].append(i)
    for idx in by_key.values():
        for j in idx[1:]:
            near.union(idx[0], j)

    groups = defaultdict(list)
    for i in range(n):
        groups[dup.find(i)].append(i)
    removed = Counter()
    for idx in groups.values():
        if len(idx) == 1:
            continue
        idx.sort(key=lambda i: (-len(live[i]["boxes"]), SRC_PRIO[live[i]["src"]], -(live[i]["w"] * live[i]["h"])))
        keep = live[idx[0]]
        for i in idx[1:]:
            live[i]["drop"] = f"trùng với {keep['id']}"
            removed[(live[i]["src"], keep["src"])] += 1
    sizes = Counter()
    for i, r in enumerate(live):
        r["split_key"] = f"g{near.find(i)}"
        r["phash"] = f"{int(hs[i]):016x}"
        sizes[r["split_key"]] += 1
    write_jsonl(WORK / "cat_02.jsonl", recs)
    with open(WORK / "dedupe_pairs.csv", "w", newline="", encoding="utf-8") as f:
        csv.writer(f).writerows([("a", "b", "dist"), *pairs])
    log(f"  cặp trùng: {len(pairs)}; ảnh bị bỏ (nguồn bỏ <- nguồn giữ): {dict(removed)}")
    big = sizes.most_common(5)
    log(f"  số nhóm split_key: {len(sizes)}; 5 nhóm to nhất: {big}")
    log("B2 xong.")


if __name__ == "__main__":
    main()
