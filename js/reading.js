import { shuffled, hashSeed } from "./daily.js";
import { dateKey } from "./store.js";
import { esc } from "./drill.js";

const KEYS = ["A", "B", "C", "D"];
const SEED = 5505;

/**
 * 긴 지문 한 편을 꺼낸다. 하루치 세트와 아무 상관이 없다.
 *
 * 세트를 하나도 풀지 않아도 열 수 있고, 세트를 다 풀어도 따로 열 수 있다.
 * 같은 지문은 두 번 나오지 않는다. 본 지문은 세트와 같은 state.seen 에 적는다.
 */
export function buildReading(data, state, now = new Date(), n = 0) {
  const key = dateKey(now);
  const seen = state.seen || {};
  const pool = shuffled(
    data.reading.passages.map((p) => p.id),
    SEED
  ).filter((id) => !seen[id]);
  const passage = data.reading.passages.find((p) => p.id === pool[0]) || null;
  return {
    key,
    id: `${key}#${n + 1}`,
    nth: n + 1,
    passage,
    exhausted: !passage,
    left: pool.length,
    total: passage ? passage.questions.length : 0,
  };
}

/** 그날 보일 선택지 차례. 하루 안에서는 흔들리지 않는다. */
export function buildReadingView(rd) {
  const view = {};
  if (!rd.passage) return view;
  for (const q of rd.passage.questions) {
    view[q.no] = shuffled(
      q.options.map((_, i) => i),
      hashSeed(rd.passage.id + ":" + q.no + rd.key)
    );
  }
  return view;
}

export function emptyReadingAnswers(rd) {
  return Object.fromEntries((rd.passage ? rd.passage.questions : []).map((q) => [q.no, null]));
}

export function readingComplete(rd, ans) {
  return rd.passage ? rd.passage.questions.every((q) => ans[q.no] !== null) : false;
}

export function gradeReadingQuestion(q, pick) {
  return q.options[pick] ? q.options[pick].ok === true : false;
}

function paragraphs(text) {
  return text
    .split("\n")
    .filter((p) => p.trim())
    .map((p) => `<p>${esc(p)}</p>`)
    .join("");
}

function flagBtn(id, flagged) {
  return `<button type="button" class="ghost-btn flag-btn" data-act="flag" data-id="${id}">${
    flagged ? "신고함" : "이 지문 이상함"
  }</button>`;
}

export function renderReading(rd, ans, view) {
  const p = rd.passage;
  const qs = p.questions
    .map((q) => {
      const opts = view[q.no]
        .map(
          (oi, pos) =>
            `<button type="button" class="opt${ans[q.no] === oi ? " picked" : ""}" data-act="rd-pick" data-no="${
              q.no
            }" data-oi="${oi}">
              <span class="opt-key">${KEYS[pos]}</span>
              <span class="opt-text zh" lang="zh-CN">${esc(q.options[oi].t)}</span>
            </button>`
        )
        .join("");
      // 문항 화면에는 한국어를 넣지 않는다. 실제 시험지에 없는 것은 여기에도 없어야 한다.
      return `<div class="q">
        <p class="q-no">${q.no}번</p>
        <p class="q-zh zh" lang="zh-CN">${esc(q.q)}</p>
        <div class="opts">${opts}</div>
      </div>`;
    })
    .join("");

  const ready = readingComplete(rd, ans);
  return `<section class="block">
    <div class="block-head"><h2>긴 지문</h2><span class="counter">${p.questions.length}문항</span></div>
    <div id="rdText" class="rd-text zh" lang="zh-CN">${paragraphs(p.text)}</div>
  </section>
  <section class="block">
    <div class="block-head"><h2>문항</h2></div>
    ${qs}
  </section>
  <button type="button" class="primary-btn" data-act="rd-grade"${ready ? "" : " disabled"}>${
    ready ? "채점하고 해설 보기" : "네 문항을 다 고르면 채점할 수 있습니다"
  }</button>`;
}

/** 이 지문에서 가져갈 말. 전부 본문 안에 있는 단어다. */
function vocabBlock(p) {
  const list = p.vocab || [];
  if (!list.length) return "";
  const rows = list
    .map(
      (v) =>
        `<li><span class="zh" lang="zh-CN">${esc(v.w)}</span><span class="v-ko">${esc(v.ko)}</span></li>`
    )
    .join("");
  return `<section class="block">
    <div class="block-head"><h2>주요 어휘</h2><span class="counter">${list.length}개</span></div>
    <ul class="vocab">${rows}</ul>
  </section>`;
}

export function renderReadingResult(rd, ans, flags, view) {
  const p = rd.passage;
  const flagged = new Set(flags.map((f) => f.id)).has(p.id);
  const got = p.questions.filter((q) => gradeReadingQuestion(q, ans[q.no])).length;

  const cards = p.questions
    .map((q) => {
      const pick = ans[q.no];
      const ok = gradeReadingQuestion(q, pick);
      // 풀 때 본 차례와 글자를 그대로 쓴다. 저장된 차례로 보여 주면 정답이 늘 A 자리에 온다.
      const shown = (view && view[q.no]) || q.options.map((_, i) => i);
      const opts = shown
        .map((oi, pos) => {
          const o = q.options[oi];
          const cls = [o.ok ? "is-answer" : "", oi === pick && !o.ok ? "is-mine" : ""].filter(Boolean).join(" ");
          return `<li class="${cls}"><span class="k">${KEYS[pos]}</span><div><span class="zh" lang="zh-CN">${esc(
            o.t
          )}</span><span class="note">${esc(o.note)}</span></div></li>`;
        })
        .join("");
      return `<div class="ex ${ok ? "right" : "wrong"}">
        <div class="ex-head">
          <span class="verdict ${ok ? "right" : "wrong"}">${q.no}번 ${ok ? "맞음" : "틀림"}</span>
        </div>
        <p class="q-zh zh" lang="zh-CN">${esc(q.q)}</p>
        <p class="q-ko">${esc(q.qKo)}</p>
        <ul class="opt-review">${opts}</ul>
        <div class="note-box"><p>근거가 되는 자리</p><p class="zh" lang="zh-CN">${esc(q.where)}</p></div>
      </div>`;
    })
    .join("");

  return `<section class="block">
    <div class="score"><strong>${got} / ${p.questions.length}</strong><span>${esc(p.topic)}</span></div>
  </section>
  <section class="block">
    <div class="block-head"><h2>해설</h2></div>
    ${cards}
  </section>
  ${vocabBlock(p)}
  <section class="block">
    <div class="block-head"><h2>본문</h2></div>
    <div class="rd-text zh" lang="zh-CN">${paragraphs(p.text)}</div>
    <div class="rd-text rd-ko">${paragraphs(p.ko)}</div>
    ${flagBtn(p.id, flagged)}
  </section>
  <div class="row-btns">
    <button type="button" class="primary-btn" data-act="next-reading">한 편 더 읽기</button>
    <button type="button" data-act="back">오늘 세트로</button>
  </div>`;
}

export function readingExhausted() {
  return `<section class="block">
    <div class="block-head"><h2>남은 지문이 없습니다</h2></div>
    <p class="hint">준비된 긴 지문을 전부 읽었습니다.</p>
    <div class="row-btns">
      <button type="button" class="primary-btn" data-act="back">오늘 세트로</button>
      <button type="button" data-act="record">기록 보기</button>
    </div>
  </section>`;
}
