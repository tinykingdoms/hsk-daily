"""단어 등급 조회.  python tools/level.py 变成 改成 区域 ..."""

import json
import sys
from pathlib import Path

words = json.loads((Path(__file__).parent / "hsk-words.json").read_text("utf-8"))["levels"]
hanzi = json.loads((Path(__file__).parent / "hsk-hanzi.json").read_text("utf-8"))
readable = set(hanzi["readThrough5"])

for w in sys.argv[1:]:
    lvl = words.get(w)
    bad = [c for c in w if c not in readable]
    mark = "OK " if (lvl is not None and lvl <= 5 and not bad) else "NO "
    note = f"{lvl}급" if lvl is not None else "어휘표에 없음"
    if bad:
        note += f" / 认读字 밖의 글자: {''.join(bad)}"
    print(f"{mark}{w}\t{note}")
