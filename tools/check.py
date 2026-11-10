"""문항 검증. data/*.json 을 읽어서 다음을 확인한다.

1. 어휘 범위  모든 중국어 문항 텍스트를 공식 어휘표로 분절해서 5급을 넘는 단어가 있으면 실패
2. 한자 범위  5급 누적 认读字 1,527자를 벗어난 글자가 있으면 실패
3. 구조       유형별 필수 필드가 비어 있으면 실패 (특히 단락 배열의 연결 단서)

python tools/check.py
"""

import sys

# 윈도우 콘솔 코드페이지에 따라 한글 출력이 깨지거나 터진다. 출력만 UTF-8 로 고정한다.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
# 폴더를 넘기면 그 폴더만 본다. 새 문항을 합치기 전에 따로 돌려 볼 때 쓴다.
DATA = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "data"
PARTIAL = DATA != ROOT / "data"

MAX_LEVEL = 5

CJK = re.compile(r"[㐀-䶿一-鿿]")
PUNCT = set("，。、；：？！“”‘’（）《》〈〉…—－·【】「」0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
            " \n\t.,!?:;'\"()%~/-")

errors = []
warnings = []
unknown_tokens = {}


def fail(where, msg):
    errors.append(f"{where}: {msg}")


def warn(where, msg):
    warnings.append(f"{where}: {msg}")


words = json.loads((TOOLS / "hsk-words.json").read_text("utf-8"))["levels"]
hanzi = json.loads((TOOLS / "hsk-hanzi.json").read_text("utf-8"))
readable = set(hanzi["readThrough5"])
wl_path = TOOLS / "whitelist.json"
whitelist = json.loads(wl_path.read_text("utf-8")) if wl_path.exists() else {}
ok_path = TOOLS / "substring-ok.json"
SUBSTRING_OK = json.loads(ok_path.read_text("utf-8")) if ok_path.exists() else {}
MAXLEN = max(len(w) for w in words)


def level_of(tok):
    if tok in whitelist:
        return 0
    return words.get(tok)


def segment(text):
    """등급 초과 토큰이 가장 적게 나오는 분절을 고른다.

    최장일치로 끊으면 '看不下去' 가 '看 / 不下 / 去' 로 갈라져서 7급 단어 '不下' 가
    없는 자리에 생긴다. 그래서 1순위를 '초과 토큰 최소', 2순위를 '토막 적게',
    3순위를 '긴 단어 선호' 로 둔다.
    """
    n = len(text)
    INF = (10**9, 0, 0)
    best = [INF] * (n + 1)
    back = [None] * (n + 1)
    best[0] = (0, 0, 0)
    for i in range(n):
        if best[i] == INF:
            continue
        bad, pieces, neglen = best[i]
        if not CJK.match(text[i]):
            cost = (bad, pieces, neglen)
            if cost < best[i + 1]:
                best[i + 1] = cost
                back[i + 1] = (i, text[i], 0)
            continue
        for ln in range(1, min(MAXLEN, n - i) + 1):
            cand = text[i : i + ln]
            if not all(CJK.match(c) for c in cand):
                break
            lvl = level_of(cand)
            if lvl is None:
                if ln > 1:
                    continue
                lvl, extra = None, 0
            cost = (
                bad + (1 if (lvl is not None and lvl > MAX_LEVEL) else 0),
                pieces + 1,
                neglen - ln * ln,
            )
            if cost < best[i + ln]:
                best[i + ln] = cost
                back[i + ln] = (i, cand, lvl)
    out = []
    pos = n
    while pos > 0 and back[pos]:
        prev, tok, lvl = back[pos]
        out.append((tok, lvl))
        pos = prev
    return list(reversed(out))


def overlevel_substrings(text):
    """분절에 잡히지 않아도 글 안에 등급 초과 단어가 통째로 들어 있으면 짚어 준다.

    '看不下去' 안의 '不下' 처럼 실제로는 그 단어가 아닌 경우가 있어서 오류가 아니라
    경고로 내보낸다. 사람이 한 번 보고 whitelist 에 이유를 적거나 문장을 고친다.
    """
    covered = []
    for phrase in SUBSTRING_OK:
        start = text.find(phrase)
        while start != -1:
            covered.append((start, start + len(phrase)))
            start = text.find(phrase, start + 1)

    hits = set()
    for i in range(len(text)):
        for ln in range(2, min(MAXLEN, len(text) - i) + 1):
            cand = text[i : i + ln]
            if not all(CJK.match(c) for c in cand):
                break
            lvl = words.get(cand)
            if cand in whitelist or lvl is None or lvl <= MAX_LEVEL:
                continue
            if any(a <= i and i + ln <= b for a, b in covered):
                continue
            hits.add((cand, lvl))
    return hits


def check_chinese(where, text):
    if not text or not text.strip():
        fail(where, "빈 텍스트")
        return
    for ch in text:
        if CJK.match(ch):
            if ch not in readable and ch not in whitelist:
                fail(where, f"5급 认读字 범위 밖의 글자 '{ch}'")
        elif ch not in PUNCT:
            warn(where, f"낯선 문자 {ch!r}")
    for tok, lvl in segment(text):
        if lvl is None:
            unknown_tokens.setdefault(tok, []).append(where)
        elif lvl > MAX_LEVEL:
            fail(where, f"'{tok}' 은 {lvl}급 단어 (5급 범위 초과)")
    for tok, lvl in overlevel_substrings(text):
        warn(where, f"'{tok}'({lvl}급) 이 글 안에 보인다. 실제로 그 단어면 고쳐야 한다")


def load(name):
    path = DATA / name
    if not path.exists():
        if not PARTIAL:
            fail(name, "파일이 없다")
        return None
    return json.loads(path.read_text("utf-8"))


# ---------------------------------------------------------------- 어순 배열
def check_order(doc):
    seen = set()
    for it in doc["items"]:
        w = f"order/{it.get('id', '?')}"
        if it["id"] in seen:
            fail(w, "id 중복")
        seen.add(it["id"])
        n = len(it["chunks"])
        if n < 4:
            fail(w, f"조각이 {n}개뿐 (4개 이상)")
        for i, c in enumerate(it["chunks"]):
            check_chinese(f"{w}/chunk{i}", c)
        if len(it["roles"]) != n:
            fail(w, f"roles {len(it['roles'])}개, chunks {n}개 (길이가 같아야 한다)")
        for i, r in enumerate(it["roles"]):
            if not r.strip():
                fail(w, f"roles[{i}] 가 비었다")
        if not it.get("rules"):
            fail(w, "rules 가 비었다 (어긋난 자리에 붙일 규칙이 없으면 해설을 만들 수 없다)")
        if not it.get("answers"):
            fail(w, "answers 가 비었다")
        for k, ans in enumerate(it["answers"]):
            if sorted(ans) != list(range(n)):
                fail(w, f"answers[{k}] 가 0..{n - 1} 의 순열이 아니다: {ans}")
        if not it.get("ko", "").strip():
            fail(w, "ko (한국어 뜻) 가 비었다")
        if not it.get("pinyin", "").strip():
            fail(w, "pinyin 이 비었다")
        if not it.get("grammar"):
            fail(w, "grammar 태그가 비었다")
        s = it.get("sentence", "")
        if not s:
            fail(w, "sentence (완성 문장) 가 비었다")
        elif re.sub(r"[，。、；：？！]", "", s) != "".join(it["chunks"]):
            fail(
                w,
                "sentence 에서 문장부호를 떼면 chunks 를 이어 붙인 것과 같아야 한다: "
                f"{re.sub(r'[，。、；：？！]', '', s)} != {''.join(it['chunks'])}",
            )


# -------------------------------------------------------------- 단락 배열
def check_sequence(doc):
    seen = set()
    for st in doc["sets"]:
        w = f"sequence/{st.get('id', '?')}"
        if st["id"] in seen:
            fail(w, "id 중복")
        seen.add(st["id"])
        segs = st["segments"]
        if len(segs) != 5:
            fail(w, f"토막글이 {len(segs)}개 (실제 시험은 5개)")
        for k, v in segs.items():
            check_chinese(f"{w}/{k}", v)
            if len(v) < 25:
                warn(f"{w}/{k}", f"{len(v)}자뿐, 너무 짧다")
        ans = st["answer"]
        if sorted(ans) != sorted(segs.keys()):
            fail(w, f"answer {ans} 가 토막글 키 {sorted(segs)} 와 맞지 않는다")
        if not st.get("first", "").strip():
            fail(w, "first (맨 앞이 그것인 이유) 가 비었다")
        links = st.get("links", [])
        if len(links) != len(ans) - 1:
            fail(w, f"links 가 {len(links)}개, {len(ans) - 1}개 있어야 한다")
        for i, ln in enumerate(links):
            lw = f"{w}/link{i}"
            if i < len(ans) - 1 and (ln.get("from"), ln.get("to")) != (ans[i], ans[i + 1]):
                fail(lw, f"{ln.get('from')}->{ln.get('to')} 가 정답 순서와 다르다")
            if not ln.get("cue", "").strip():
                fail(lw, "cue 가 비었다. 단서를 못 쓰겠으면 순서가 유일하지 않은 문항이다")
            if ln.get("mark") and ln["mark"] not in segs.get(ln["to"], ""):
                fail(lw, f"mark '{ln['mark']}' 가 토막글 {ln['to']} 안에 없다")
        if not st.get("ko", "").strip():
            fail(w, "ko (전체 번역) 가 비었다")


# ------------------------------------------------------------- 단문 빈칸
def check_cloze(doc):
    seen = set()
    for ps in doc["passages"]:
        w = f"cloze/{ps.get('id', '?')}"
        if ps["id"] in seen:
            fail(w, "id 중복")
        seen.add(ps["id"])
        text = ps["text"]
        check_chinese(f"{w}/text", re.sub(r"\{\{\d+\}\}", "", text))
        holes = [int(m) for m in re.findall(r"\{\{(\d+)\}\}", text)]
        nos = [b["no"] for b in ps["blanks"]]
        if holes != sorted(nos):
            fail(w, f"본문의 빈칸 {holes} 와 blanks 의 번호 {nos} 가 맞지 않는다")
        for b in ps["blanks"]:
            bw = f"{w}/blank{b['no']}"
            opts = b["options"]
            if len(opts) != 4:
                fail(bw, f"선택지가 {len(opts)}개 (4개여야 한다)")
            oks = [o for o in opts if o.get("ok")]
            if len(oks) != 1:
                fail(bw, f"정답으로 표시된 선택지가 {len(oks)}개")
            for o in opts:
                check_chinese(f"{bw}/{o['t']}", o["t"])
                if not o.get("note", "").strip():
                    fail(bw, f"선택지 '{o['t']}' 의 note 가 비었다")
        if not ps.get("ko", "").strip():
            fail(w, "ko (전체 번역) 가 비었다")


# ----------------------------------------------------------------- 쓰기
def check_writing(doc):
    seen = set()
    for it in doc["items"]:
        w = f"writing/{it.get('id', '?')}"
        if it["id"] in seen:
            fail(w, "id 중복")
        seen.add(it["id"])
        check_chinese(f"{w}/prompt", it["prompt"])
        check_chinese(f"{w}/model", it["model"])
        if it["kind"] == "fourPanel":
            if it.get("minChars") != 100:
                fail(w, "4컷 작문은 minChars 100")
            if len(it.get("panels", [])) != 4:
                fail(w, "panels 가 4개여야 한다")
            for i, p in enumerate(it.get("panels", [])):
                check_chinese(f"{w}/panel{i}", p["scene"])
                if not p.get("sceneKo", "").strip():
                    fail(f"{w}/panel{i}", "sceneKo 가 비었다")
        elif it["kind"] == "topic":
            if it.get("minChars") != 200:
                fail(w, "주제 작문은 minChars 200")
        else:
            fail(w, f"모르는 kind '{it['kind']}'")
        if len(re.findall(CJK, it["model"])) < it["minChars"]:
            fail(w, f"모범답안이 {len(re.findall(CJK, it['model']))}자, {it['minChars']}자 이상이어야 한다")
        if not it.get("checklist"):
            fail(w, "checklist 가 비었다")
        if not it.get("promptKo", "").strip():
            fail(w, "promptKo 가 비었다")


# ------------------------------------------------------------- 긴 지문 읽기
def check_reading(doc):
    seen = set()
    for ps in doc["passages"]:
        w = f"reading/{ps.get('id', '?')}"
        if ps["id"] in seen:
            fail(w, "id 중복")
        seen.add(ps["id"])

        text = ps.get("text", "")
        check_chinese(f"{w}/text", "".join(text.splitlines()))
        n = len(re.findall(CJK, text))
        if not 280 <= n <= 420:
            fail(w, f"본문이 {n}자. 280자에서 420자 사이여야 한다")

        paras = [p for p in text.splitlines() if p.strip()]
        koParas = [p for p in ps.get("ko", "").splitlines() if p.strip()]
        if len(paras) < 3:
            fail(w, f"단락이 {len(paras)}개. 세 개 이상이어야 한다")
        if len(koParas) != len(paras):
            fail(w, f"번역 단락이 {len(koParas)}개, 본문은 {len(paras)}개")

        flat = re.sub(r"\s", "", text)
        qs = ps.get("questions", [])
        if len(qs) != 4:
            fail(w, f"문항이 {len(qs)}개. 네 개여야 한다")
        for q in qs:
            qw = f"{w}/q{q.get('no', '?')}"
            check_chinese(f"{qw}/q", q.get("q", ""))
            if not q.get("qKo", "").strip():
                fail(qw, "qKo 가 비었다")
            # 근거 문장을 본문에서 그대로 가져오게 해서, 본문에 없는 답을 막는다
            where = re.sub(r"\s", "", q.get("where", ""))
            if not where:
                fail(qw, "where 가 비었다. 근거 문장을 못 쓰겠으면 본문이 답하지 않는 문항이다")
            elif where not in flat:
                fail(qw, f"where 가 본문에 그대로 있지 않다: {q['where'][:30]}")
            opts = q.get("options", [])
            if len(opts) != 4:
                fail(qw, f"선택지가 {len(opts)}개 (4개여야 한다)")
            oks = [o for o in opts if o.get("ok")]
            if len(oks) != 1:
                fail(qw, f"정답으로 표시된 선택지가 {len(oks)}개")
            for o in opts:
                check_chinese(f"{qw}/{o.get('t', '?')}", o.get("t", ""))
                if not o.get("note", "").strip():
                    fail(qw, f"선택지 '{o.get('t')}' 의 note 가 비었다")
        nos = [q.get("no") for q in qs]
        if nos != [1, 2, 3, 4]:
            fail(w, f"문항 번호가 {nos}. 1 2 3 4 여야 한다")
        if not ps.get("topic", "").strip():
            fail(w, "topic 이 비었다")


def main():
    counts = {}
    for name, fn, key in [
        ("order.json", check_order, "items"),
        ("sequence.json", check_sequence, "sets"),
        ("cloze.json", check_cloze, "passages"),
        ("writing.json", check_writing, "items"),
        ("reading.json", check_reading, "passages"),
    ]:
        doc = load(name)
        if doc is None:
            continue
        fn(doc)
        counts[name] = len(doc[key])

    print("문항 수")
    for k, v in counts.items():
        print(f"  {k:16} {v}")

    if unknown_tokens:
        multi = {k: v for k, v in unknown_tokens.items() if len(k) > 1}
        singles = sorted(k for k in unknown_tokens if len(k) == 1)
        print(f"\n어휘표에 없는 조각 {len(unknown_tokens)}종 (글자 단위 검사는 통과)")
        for k in sorted(multi)[:40]:
            print(f"  {k}  <- {multi[k][0]}")
        if singles:
            print("  단일 글자:", "".join(singles))

    if warnings:
        print(f"\n경고 {len(warnings)}건")
        for w in warnings[:30]:
            print("  ", w)

    if errors:
        print(f"\n오류 {len(errors)}건")
        for e in errors:
            print("  ", e)
        print("\n검증 실패")
        return 1
    print("\n검증 통과")
    return 0


if __name__ == "__main__":
    sys.exit(main())
