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
        for c in it.get("checklist", []):
            if "세어 봤는지" in c or "자를 넘겼는지" in c:
                fail(w, f"글자 수는 채점 화면이 세어 준다. 묻지 않아도 되는 항목이다: {c}")
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
            # 해설은 보기가 무슨 뜻인지 적는 자리다. '본문에 나온다', '본문에 없다' 는
            # 읽으나 마나 한 말이라 자리만 차지한다.
            for o in opts:
                if "본문" in o.get("note", ""):
                    fail(qw, f"선택지 '{o.get('t')}' 의 note 가 해석이 아니라 본문 이야기다")
            # 정답은 본문에서 가져오니 길어지고, 오답은 지어내니 짧아진다. 그대로 두면
            # 본문을 읽지 않고 제일 긴 것만 골라도 맞는다. 그러면 읽기 연습이 아니다.
            if len(oks) == 1:
                ok_t = oks[0].get("t", "")
                others = [o.get("t", "") for o in opts if not o.get("ok")]
                if others and len(ok_t) > max(len(t) for t in others):
                    fail(qw, f"정답이 혼자 가장 긴 보기다. 읽지 않고 길이로 고를 수 있다: {ok_t}")
        nos = [q.get("no") for q in qs]
        if nos != [1, 2, 3, 4]:
            fail(w, f"문항 번호가 {nos}. 1 2 3 4 여야 한다")
        if not ps.get("topic", "").strip():
            fail(w, "topic 이 비었다")

        # 가져갈 말은 이 지문에서 나온 것이어야 한다. 본문에 없는 단어를 외우게 하면
        # 지문을 읽은 것과 상관없는 목록이 된다
        vocab = ps.get("vocab", [])
        if not 6 <= len(vocab) <= 10:
            fail(w, f"주요 어휘가 {len(vocab)}개. 6개에서 10개 사이여야 한다")
        seen_w = set()
        for v in vocab:
            word = v.get("w", "")
            if not word:
                fail(w, "주요 어휘에 단어가 비었다")
            elif word not in flat:
                fail(w, f"주요 어휘 '{word}' 가 본문에 없다")
            if word in seen_w:
                fail(w, f"주요 어휘 '{word}' 가 두 번 나온다")
            seen_w.add(word)
            if not v.get("ko", "").strip():
                fail(w, f"주요 어휘 '{word}' 의 뜻이 비었다")


# ------------------------------------------------- 문제를 푸는 화면
HANGUL = re.compile(r"[가-힣]")

# 문제를 푸는 동안 눈에 들어오는 것을 그리는 자리. 여기에 한국어가 들어가면
# 실제 시험지에 없는 것을 보면서 푸는 것이 된다. 번역이든 요령이든 마찬가지다.
SCREENS = [("js/drill.js", None), ("js/reading.js", "renderReading"), ("js/app.js", "header")]


def strip_comments(src):
    """주석을 지운다.

    제대로 된 자바스크립트 분석기를 쓰지 않는다. 정규식 리터럴과 따옴표 안의
    따옴표에서 바로 틀어진다. 주석 줄을 걸러내는 데에는 이걸로 충분하고,
    틀려도 검사가 느슨해질 뿐 없는 줄을 지어내지는 않는다.
    """
    src = re.sub(r"/\*.*?\*/", "", src, flags=re.S)
    out = []
    for line in src.splitlines():
        t = line.strip()
        if t.startswith("//") or t.startswith("*"):
            out.append("")
            continue
        # 줄 끝에 붙은 주석. 한국어가 들어 있을 때만 떼어낸다
        at = line.find("//")
        if at != -1 and HANGUL.search(line[at:]):
            line = line[:at]
        out.append(line)
    return "\n".join(out)


def one_function(src, name):
    """export function 이름( 부터 칸 없이 닫는 중괄호까지."""
    head = f"function {name}("
    at = src.find(head)
    if at == -1:
        return None
    end = src.find("\n}", at)
    return src[at : end + 2] if end != -1 else src[at:]


def check_screens():
    for rel, fn in SCREENS:
        path = ROOT / rel
        if not path.exists():
            fail(rel, "파일이 없다")
            continue
        src = strip_comments(path.read_text("utf-8"))
        if fn:
            src = one_function(src, fn)
            if src is None:
                fail(rel, f"{fn} 를 찾지 못했다. 검사가 비어 버린다")
                continue
        where = rel if not fn else f"{rel}/{fn}"
        for line in src.splitlines():
            if HANGUL.search(line):
                fail(where, f"문제를 푸는 화면에 한국어가 있다: {line.strip()[:60]}")


# ------------------------------------------------------- 쓰기 점검 규칙
def py_fix(fix):
    """$1 자리표를 파이썬 교체 문법으로 바꾼다. 규칙은 브라우저와 여기가 같이 쓴다."""
    return re.sub(r"\$(\d)", r"\\\1", fix) if fix else fix


def evened(text, west):
    """반각 부호를 전각으로 바꾼 사본. 브라우저쪽과 같은 글에 규칙을 돌리려는 것이다."""
    return "".join(west.get(c, c) for c in text)


def rule_hits(text, r):
    out = []
    for m in re.finditer(r["re"], text):
        if not m.group(0):
            continue
        if r.get("unless"):
            win = text[max(0, m.start() - 6) : m.end()]
            if re.search(r["unless"], win):
                continue
        out.append(m)
    return out


def chinese_bodies(docs):
    """글 한 편으로 볼 수 있는 것. 짝 규칙은 여기에만 돌린다."""
    out = []
    if docs.get("writing.json"):
        for it in docs["writing.json"]["items"]:
            out.append((f"writing/{it['id']}/prompt", it["prompt"]))
            out.append((f"writing/{it['id']}/model", it["model"]))
    if docs.get("reading.json"):
        for ps in docs["reading.json"]["passages"]:
            out.append((f"reading/{ps['id']}/text", ps["text"]))
    if docs.get("cloze.json"):
        for ps in docs["cloze.json"]["passages"]:
            text = ps["text"]
            for b in ps["blanks"]:
                ok = next((o["t"] for o in b["options"] if o.get("ok")), "")
                text = text.replace("{{%d}}" % b["no"], ok)
            out.append((f"cloze/{ps['id']}/text", text))
    if docs.get("sequence.json"):
        for st in docs["sequence.json"]["sets"]:
            joined = "".join(st["segments"].get(k, "") for k in st["answer"])
            out.append((f"sequence/{st['id']}", joined))
    return out


def chinese_fragments(docs):
    """조각글. 글자 몇 개 범위에서 판정되는 규칙만 돌린다."""
    out = []
    if docs.get("writing.json"):
        for it in docs["writing.json"]["items"]:
            for i, pn in enumerate(it.get("panels", [])):
                out.append((f"writing/{it['id']}/panel{i}", pn["scene"]))
    if docs.get("reading.json"):
        for ps in docs["reading.json"]["passages"]:
            for q in ps["questions"]:
                out.append((f"reading/{ps['id']}/q{q['no']}", q["q"]))
                for o in q["options"]:
                    out.append((f"reading/{ps['id']}/q{q['no']}", o["t"]))
    if docs.get("cloze.json"):
        for ps in docs["cloze.json"]["passages"]:
            for b in ps["blanks"]:
                for o in b["options"]:
                    out.append((f"cloze/{ps['id']}/blank{b['no']}", o["t"]))
    if docs.get("order.json"):
        for it in docs["order.json"]["items"]:
            out.append((f"order/{it['id']}", it["sentence"]))
    return out


def check_wrules(doc, docs):
    """쓴 글을 보는 규칙을 검사한다.

    규칙이 애매하면 틀린 표현을 고쳐 준다고 하면서 맞는 표현을 틀렸다고 한다. 그래서
    두 가지를 본다. 규칙마다 적어 둔 bad 를 실제로 잡는가, 그리고 레포 안에 있는
    올바른 중국어 전부에 대해 한 건도 걸리지 않는가. 하나라도 걸리면 그 규칙이 틀렸다.
    """
    west = doc.get("halfwidth") or {}
    if not west:
        fail("wrules", "halfwidth (반각 부호 표) 가 비었다")
    ids = set()
    for r in doc.get("rules", []):
        w = f"wrules/{r.get('id', '?')}"
        if r["id"] in ids:
            fail(w, "id 중복")
        ids.add(r["id"])
        for key in ("re", "why", "level", "bad"):
            if not r.get(key):
                fail(w, f"{key} 가 비었다")
        if r.get("level") not in ("fix", "look"):
            fail(w, f"모르는 level '{r.get('level')}'")
        try:
            re.compile(r["re"])
        except re.error as e:
            fail(w, f"정규식이 깨졌다: {e}")
            continue
        if not rule_hits(r.get("bad", ""), r):
            fail(w, f"bad '{r.get('bad')}' 를 잡지 못한다. 규칙이 작동하지 않는다")
        if r.get("fix"):
            if not r.get("good"):
                fail(w, "fix 가 있으면 good (고친 모양) 도 있어야 한다")
            else:
                got = re.sub(r["re"], py_fix(r["fix"]), r["bad"])
                if got != r["good"]:
                    fail(w, f"고친 결과가 '{got}', good 은 '{r['good']}'")

    for group, kind in (("pairs", "head"), ("counted", "word")):
        for g in doc.get(group, []):
            w = f"wrules/{g.get('id', '?')}"
            if not g.get("bad"):
                fail(w, "bad 가 비었다")
            if not g.get("why"):
                fail(w, "why 가 비었다")
            if group == "pairs" and not g.get("needs"):
                fail(w, "needs 가 비었다")

    bodies = chinese_bodies(docs)
    frags = chinese_fragments(docs)
    clean = 0
    for where, text in bodies + frags:
        flat = evened(text.replace("\n", ""), west)
        clean += 1
        for r in doc.get("rules", []):
            for m in rule_hits(flat, r):
                around = flat[max(0, m.start() - 10) : m.end() + 10]
                fail(
                    f"wrules/{r['id']}",
                    f"옳은 글 {where} 의 '{around}' 를 잡는다. 규칙이 넓다",
                )
    for where, text in bodies:
        flat = text.replace("\n", "")
        for g in doc.get("pairs", []):
            if g["head"] in flat and not any(n in flat for n in g["needs"]):
                fail(f"wrules/{g['id']}", f"옳은 글 {where} 를 잡는다. 규칙이 넓다")
        for g in doc.get("counted", []):
            t = flat
            for st in g.get("strip", []):
                t = t.replace(st, "")
            if t.count(g["word"]) == 1:
                fail(f"wrules/{g['id']}", f"옳은 글 {where} 를 잡는다. 규칙이 넓다")
    for g in doc.get("pairs", []):
        if g["head"] in g.get("bad", "") and any(n in g.get("bad", "") for n in g.get("needs", [])):
            fail(f"wrules/{g['id']}", f"bad '{g['bad']}' 를 잡지 못한다")
    for g in doc.get("counted", []):
        t = g.get("bad", "")
        for st in g.get("strip", []):
            t = t.replace(st, "")
        if t.count(g["word"]) != 1:
            fail(f"wrules/{g['id']}", f"bad '{g['bad']}' 를 잡지 못한다")
    return clean


def main():
    counts = {}
    docs = {}
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
        docs[name] = doc
        fn(doc)
        counts[name] = len(doc[key])

    check_screens()

    wdoc = load("wrules.json")
    if wdoc is not None:
        n = check_wrules(wdoc, docs)
        counts["wrules.json"] = len(wdoc.get("rules", [])) + len(wdoc.get("pairs", [])) + len(
            wdoc.get("counted", [])
        )
        print(f"쓰기 점검 규칙을 올바른 글 {n}편에 돌렸다")

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
