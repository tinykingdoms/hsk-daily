"""넷리파이 드롭에 끌어다 놓을 폴더를 만든다.

publish/ 에 웹에 필요한 파일만 복사한다. tools/ 와 .git/ 은 올리지 않는다.
sw.js 의 캐시 이름에는 문항 내용의 해시를 박는다. 문항을 고치고 다시 올리면
이름이 저절로 달라져서, CACHE 를 손으로 올리는 것을 잊어도 폰에 옛 문항이
남지 않는다.

    python tools/pack.py
"""

import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path

# 윈도우 콘솔 코드페이지에 따라 한글 출력이 깨지거나 터진다. 출력만 UTF-8 로 고정한다.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "publish"

FILES = ["index.html", "app.css", "manifest.webmanifest"]
DIRS = ["js", "data", "icons"]


def main():
    # 검증을 통과하지 못한 문항은 올리지 않는다.
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "check.py")], cwd=ROOT, env=env)
    if r.returncode != 0:
        print("\n검증이 통과하지 않았다. publish/ 를 만들지 않는다.")
        return 1

    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()

    for f in FILES:
        shutil.copy2(ROOT / f, OUT / f)
    for d in DIRS:
        shutil.copytree(ROOT / d, OUT / d)

    # sw.js 를 뺀 나머지 전부의 해시. 경로까지 넣어 파일을 지운 것도 잡는다.
    h = hashlib.sha256()
    for p in sorted(OUT.rglob("*")):
        if p.is_file():
            h.update(p.relative_to(OUT).as_posix().encode())
            h.update(p.read_bytes())
    tag = h.hexdigest()[:8]

    sw = (ROOT / "sw.js").read_text(encoding="utf-8")
    old = 'const CACHE = "hsk-daily-6";'
    if old not in sw:
        print("sw.js 의 CACHE 줄을 찾지 못했다. pack.py 를 고쳐야 한다.")
        return 1
    sw = sw.replace(old, f'const CACHE = "hsk-daily-{tag}";')
    (OUT / "sw.js").write_text(sw, encoding="utf-8", newline="\n")

    n = sum(1 for p in OUT.rglob("*") if p.is_file())
    kb = sum(p.stat().st_size for p in OUT.rglob("*") if p.is_file()) / 1024
    print(f"\npublish/ 준비 완료. 파일 {n}개, {kb:.0f}KB, 캐시 이름 hsk-daily-{tag}")
    print("이 폴더를 app.netlify.com/drop 에 끌어다 놓으면 된다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
