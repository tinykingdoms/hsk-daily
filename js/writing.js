import { countCjk } from "./drill.js";

/**
 * 쓴 글을 기계로 점검한다.
 *
 * 여기서 잡는 것은 규칙으로 확실히 판정되는 것뿐이다. 글의 내용이 주제에 맞는지,
 * 문장이 자연스러운지는 보지 못한다. 그건 모범답안과 견주어야 한다.
 *
 * 애매한 것을 고쳐 주면 틀린 표현을 외우게 된다. 그래서 규칙은 data/wrules.json
 * 한 곳에만 두고, tools/check.py 가 그 규칙 전부를 레포 안의 올바른 중국어에
 * 돌려서 한 건도 걸리지 않는 것을 확인한 뒤에야 배포된다.
 */

const CJK_ONE = /[㐀-䶿一-鿿]/;
const CJK_RUN = "[㐀-䶿一-鿿]";
const HANGUL = /[가-힣ㄱ-ㅎㅏ-ㅣ]+/g;
const LATIN = /[A-Za-z]{2,}/g;
const SPACED = new RegExp(`([。，！？、；：”）]|${CJK_RUN})([ \\t]+)(?=${CJK_RUN})`, "g");
const WEST_RE = /[,.!?:;()]/g;

/** 반각 부호를 전각으로 바꿈 사본. 길이가 같아서 지적한 자리가 그대로 남는다. */
function evened(text, west) {
  return text.replace(WEST_RE, (c) => west[c] || c);
}
const LONG_SENTENCE = 45;

/** 문장 단위로 끊는다. 끝 부호는 그 문장에 붙여 둔다. */
function sentences(text) {
  const out = [];
  let cur = "";
  let at = 0;
  for (let i = 0; i < text.length; i++) {
    cur += text[i];
    if ("。！？".includes(text[i])) {
      out.push({ at, s: cur });
      cur = "";
      at = i + 1;
    }
  }
  if (cur.trim()) out.push({ at, s: cur });
  return out;
}

/** 규칙의 fix 는 $1 자리표를 쓴다. 잡은 묶음에서 바로 끼워 넣는다. */
function fixOf(rule, m) {
  if (rule.fix === null || rule.fix === undefined) return null;
  return rule.fix.replace(/\$(\d)/g, (_, d) => m[Number(d)] || "");
}

function hits(text, even, rules) {
  const out = [];
  for (const r of rules) {
    const re = new RegExp(r.re, "g");
    const unless = r.unless ? new RegExp(r.unless) : null;
    let m;
    while ((m = re.exec(even)) !== null) {
      if (m[0] === "") {
        re.lastIndex += 1;
        continue;
      }
      // 옳은 글에도 들어맞는 모양이 있다. 是와 不是, 方便是方便 같은 것들이다
      if (unless && unless.test(even.slice(Math.max(0, m.index - 6), m.index + m[0].length))) continue;
      out.push({
        id: r.id,
        level: r.level,
        at: m.index,
        len: m[0].length,
        bad: text.slice(m.index, m.index + m[0].length),
        fix: fixOf(r, m),
        why: r.why,
      });
    }
  }
  return out;
}

/**
 * 글 전체를 보고 할 말을 모은다.
 *
 * level 은 셋이다. fix 는 고칠 자리와 고친 모양을 같이 주는 것, look 은 틀렸을
 * 만하니 눈으로 보라는 것, note 는 틀린 게 아니고 글 모양에 대한 말이다.
 */
export function checkWriting(text, item, wrules) {
  const findings = [];
  const add = (f) => findings.push(f);
  const west = (wrules && wrules.halfwidth) || {};
  const even = evened(text, west);
  const n = countCjk(text);
  const paras = text.split(/\n+/).filter((p) => p.trim());
  const sents = sentences(text);
  const words = (item.useful || []).map((u) => u.w);

  if (!text.trim()) return { n: 0, paras: [], sents: [], findings, used: [], unused: words };

  // 글자 수. 실제 시험에서 줄을 못 채우면 그 자리에서 점수가 깎인다
  if (n < item.minChars) {
    add({
      level: "fix",
      at: -1,
      why: `${item.minChars}자 이상이어야 합니다. ${n}자를 썼으니 ${item.minChars - n}자가 더 필요합니다`,
    });
  }

  // 한글은 답안지에서 그냥 지워지는 글자다
  for (const m of text.matchAll(HANGUL)) {
    add({ level: "fix", at: m.index, len: m[0].length, bad: m[0], fix: "", why: "답안에 한글은 쓸 수 없습니다" });
  }
  for (const m of text.matchAll(LATIN)) {
    add({ level: "look", at: m.index, len: m[0].length, bad: m[0], why: "로마자는 채점에서 빠집니다" });
  }

  // 중국어 글은 전각 부호를 쓴다. 쉼표 하나로 답안 전체가 번역기처럼 보인다
  for (const m of text.matchAll(WEST_RE)) {
    if (!west[m[0]]) continue;
    add({
      level: "fix",
      at: m.index,
      len: 1,
      bad: m[0],
      fix: west[m[0]],
      why: "중국어 글에는 전각 부호를 씁니다",
    });
  }

  // 한자 사이는 띄우지 않는다
  for (const m of text.matchAll(SPACED)) {
    add({
      level: "fix",
      at: m.index + m[1].length,
      len: m[2].length,
      why: "중국어 글은 띄어 쓰지 않습니다",
    });
  }

  const tail = text.trim().slice(-1);
  if (tail && !"。！？”".includes(tail)) {
    add({ level: "look", at: -1, why: "마지막 문장에 마침표가 없습니다" });
  }

  for (const h of hits(text, even, (wrules && wrules.rules) || [])) add(h);

  // 짝을 이루는 말. 한 문장 안에 다 들어오지 않을 때가 많아서 글 전체에서 본다
  for (const p of (wrules && wrules.pairs) || []) {
    if (text.includes(p.head) && !p.needs.some((x) => text.includes(x))) {
      add({ level: "look", at: text.indexOf(p.head), len: p.head.length, bad: p.head, why: p.why });
    }
  }
  for (const c of (wrules && wrules.counted) || []) {
    let t = text;
    for (const s of c.strip) t = t.split(s).join("");
    if (t.split(c.word).length - 1 === 1) {
      add({ level: "look", at: text.indexOf(c.word), len: c.word.length, bad: c.word, why: c.why });
    }
  }

  // 한 문장에 다 넣으려고 하면 어디선가 틀린다. 끊어 쓰는 쪽이 늘 안전하다
  for (const s of sents) {
    const len = countCjk(s.s);
    if (len > LONG_SENTENCE) {
      // 자리는 알려 주되 문장 전체를 칠하지는 않는다. 다른 지적까지 덮어 버린다
      add({ level: "look", at: -1, why: `${s.s.trim().slice(0, 12)} 로 시작하는 문장이 ${len}자입니다. 끊어 쓰세요` });
    }
  }

  if (item.minChars >= 200 && paras.length < 3) {
    add({
      level: "note",
      at: -1,
      why: `단락이 ${paras.length}개입니다. 200자 작문은 세 단락으로 나누는 쪽이 읽기 쉽습니다`,
    });
  }

  // 같은 말로 문장을 계속 열면 내용이 있어도 단조롭게 읽힌다
  const opens = {};
  for (const s of sents) {
    const c = (s.s.match(CJK_ONE) || [""])[0];
    if (c) opens[c] = (opens[c] || 0) + 1;
  }
  for (const [c, k] of Object.entries(opens)) {
    if (k >= 3) add({ level: "note", at: -1, why: `문장 ${k}개가 ${c} 로 시작합니다. 시작을 바꿔 보세요` });
  }

  return {
    n,
    paras,
    sents,
    findings,
    used: words.filter((w) => text.includes(w)),
    unused: words.filter((w) => !text.includes(w)),
  };
}

/* ------------------------------------------------------------- 모델 채점
 *
 * 위의 점검은 규칙으로 확실히 판정되는 것만 본다. 주제에 맞게 썼는지, 문장이
 * 중국어답게 읽히는지는 규칙으로 볼 수 없는데, 작문에서 점수가 갈리는 자리가
 * 바로 거기다. 그 한 가지만 바깥에 물어본다.
 *
 * 서버가 없으니 요청도 이 기기에서 바로 나간다. 브라우저에서 직접 부르는 요청은
 * anthropic-dangerous-direct-browser-access 헤더가 있어야 API 가 받아 준다.
 * 열쇠는 이 기기의 localStorage 에만 두고 어디에도 보내지 않는다.
 */

const KEY_SLOT = "hsk-daily-apikey";
const API_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-opus-5-5";

export function apiKey() {
  try {
    return (localStorage.getItem(KEY_SLOT) || "").trim();
  } catch {
    return "";
  }
}

export function setApiKey(v) {
  try {
    const t = (v || "").trim();
    if (t) localStorage.setItem(KEY_SLOT, t);
    else localStorage.removeItem(KEY_SLOT);
  } catch {
    /* 저장이 막힌 환경에서는 이번 한 번만 쓰고 잊는다 */
  }
}

// 돌아오는 모양을 고정해 둔다. 줄글로 받으면 화면에 붙일 때마다 다르게 끊긴다.
const SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string" },
    fixes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          bad: { type: "string" },
          good: { type: "string" },
          why: { type: "string" },
        },
        required: ["bad", "good", "why"],
        additionalProperties: false,
      },
    },
    content: { type: "array", items: { type: "string" } },
    used: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "fixes", "content", "used"],
  additionalProperties: false,
};

const SYSTEM = `HSK 5급 쓰기 답안을 채점한다. 쓴 사람은 한국어를 쓰는 학습자다.

fixes 에 적을 것
- 확실히 틀린 중국어, 또는 중국어로 그렇게 말하지 않는 표현만 적는다.
- 취향 차이와 더 멋있는 표현은 적지 않는다. 틀리지 않은 것을 고치라고 하면 틀린 쪽을 외운다.
- bad 는 답안에 있는 글자를 그대로 잘라 온다. 다듬어서 옮기지 않는다.
- good 은 고친 중국어다. 빼야 하는 말이면 빈 문자열로 둔다.
- why 는 한국어 한 줄이다. 왜 틀렸는지만 적는다.

content 에 적을 것
- 내용과 구성에 대한 한국어 한 줄 항목 두 개에서 네 개.
- 문제가 요구한 것을 다 썼는지, 빠진 것이 무엇인지, 어디를 늘리면 되는지.

used 에 적을 것
- 답안이 실제로 맞게 쓴 5급 어법이나 표현을 중국어로 적는다. 없으면 빈 배열로 둔다.

verdict
- 이 답안이 지금 어떤 상태인지 한국어 한 줄.

말투
- 사람이 옆에서 말하듯 짧게 쓴다. 한 문장에 한 가지만 적는다.
- 줄표는 쓰지 않는다.
- 칭찬과 격려는 적지 않는다. 사실만 적는다.`;

/**
 * 쓴 글을 모델에게 보내고 채점 결과를 받는다.
 *
 * 실패하면 API 가 보낸 말을 그대로 던진다. 열쇠가 틀렸는지, 작업공간을 적어야
 * 하는지, 이 조직이 브라우저 요청을 막아 두었는지는 그 말에 적혀 있다.
 */
export async function gradeWriting(item, text) {
  const key = apiKey();
  if (!key) throw new Error("API 열쇠가 없습니다");

  const ask = [
    `문제: ${item.prompt}`,
    `${item.minChars}자 이상`,
    item.panels ? `네 장면: ${item.panels.map((p, i) => `${i + 1} ${p.scene}`).join(" / ")}` : "",
    `볼 것: ${item.checklist.join(" / ")}`,
    "",
    "답안",
    text,
  ]
    .filter(Boolean)
    .join("\n");

  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), 120000);
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      signal: stop.signal,
      headers: {
        "content-type": "application/json",
        "anthropic-version": "2026-10-21",
        "anthropic-beta": "server-side-fallback-2026-07-01",
        "anthropic-dangerous-direct-browser-access": "true",
        "x-api-key": key,
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: "user", content: ask }],
        thinking: { type: "adaptive" },
        output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
        fallbacks: "default",
      }),
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(e.name === "AbortError" ? "2분 안에 답이 오지 않았습니다" : `보내지 못했습니다. ${e.message}`);
  }
  clearTimeout(timer);

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && body.error && body.error.message) || `${res.status} 응답`);
  }
  if (body.stop_reason === "refusal") throw new Error("모델이 이 글을 채점하지 않았습니다");

  const block = (body.content || []).find((b) => b.type === "text");
  if (!block) throw new Error("채점 결과가 비어서 왔습니다");
  let out;
  try {
    out = JSON.parse(block.text);
  } catch {
    throw new Error("채점 결과를 읽지 못했습니다");
  }
  return {
    verdict: out.verdict || "",
    // 고친 모양이 원문과 같으면 고칠 곳이 아니다. 화살표만 그려지고 읽을 것이 없다.
    fixes: (out.fixes || []).filter((f) => f.bad && f.good !== f.bad),
    content: (out.content || []).filter(Boolean),
    used: (out.used || []).filter(Boolean),
  };
}

/** fix 가 있는 규칙을 전부 적용한 글. 눈으로 견주기 위한 것이다. */
export function applyFixes(text, wrules) {
  const west = (wrules && wrules.halfwidth) || {};
  let out = evened(text, west).replace(SPACED, "$1");
  for (const r of ((wrules && wrules.rules) || []).filter((x) => x.fix)) {
    out = out.replace(new RegExp(r.re, "g"), r.fix);
  }
  return out;
}
