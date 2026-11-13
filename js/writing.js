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

  // 한 문장에 다 넣으려고 하면 어디선가 어긋난다. 끊는 쪽이 늘 안전하다
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

/** fix 가 있는 규칙을 전부 적용한 글. 눈으로 견주기 위한 것이다. */
export function applyFixes(text, wrules) {
  const west = (wrules && wrules.halfwidth) || {};
  let out = evened(text, west).replace(SPACED, "$1");
  for (const r of ((wrules && wrules.rules) || []).filter((x) => x.fix)) {
    out = out.replace(new RegExp(r.re, "g"), r.fix);
  }
  return out;
}
