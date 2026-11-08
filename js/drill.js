import { shuffled, hashSeed } from "./daily.js";

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const KEYS = ["A", "B", "C", "D", "E"];

/** 그날 화면에 보일 순서. 하루 안에서는 흔들리지 않고, 날이 바뀌면 달라진다. */
export function buildView(set) {
  const view = { order: {}, cloze: {} };
  for (const it of set.order) {
    view.order[it.id] = shuffled(
      it.chunks.map((_, i) => i),
      hashSeed(it.id + set.key)
    );
  }
  for (const b of set.cloze.blanks) {
    view.cloze[b.no] = shuffled(
      b.options.map((_, i) => i),
      hashSeed(set.cloze.id + ":" + b.no + set.key)
    );
  }
  return view;
}

export function emptyAnswers(set) {
  return {
    order: Object.fromEntries(set.order.map((it) => [it.id, []])),
    sequence: [null, null, null, null, null],
    cloze: Object.fromEntries(set.cloze.blanks.map((b) => [b.no, null])),
    writing: { text: "", seen: false },
  };
}

export function isComplete(set, ans) {
  const ordDone = set.order.every((it) => ans.order[it.id].length === it.chunks.length);
  const seqDone = ans.sequence.every((x) => x !== null);
  const clzDone = set.cloze.blanks.every((b) => ans.cloze[b.no] !== null);
  return ordDone && seqDone && clzDone;
}

function seqSection(set, ans) {
  const keys = Object.keys(set.sequence.segments).sort();
  const slots = ans.sequence
    .map(
      (k, i) =>
        `<button type="button" class="seq-slot${k ? " filled" : ""}" data-act="seq-clear" data-i="${i}">${
          k || i + 1
        }</button>`
    )
    .join("");
  const segs = keys
    .map(
      (k) =>
        `<button type="button" class="seg${ans.sequence.includes(k) ? " used" : ""}" data-act="seq-pick" data-key="${k}">
          <span class="seg-key">${k}</span>
          <span class="seg-text zh" lang="zh-CN">${esc(set.sequence.segments[k])}</span>
        </button>`
    )
    .join("");
  return `<section class="block">
    <div class="block-head"><h2>단락 배열</h2><span class="counter">5문항</span></div>
    <p class="hint">토막글 다섯 개를 하나의 글이 되는 순서로 놓으세요. 위 칸을 누르면 지웁니다.</p>
    <div class="seq-slots">${slots}</div>
    <div>${segs}</div>
  </section>`;
}

function orderSection(set, ans, view) {
  const qs = set.order
    .map((it, qi) => {
      const placed = ans.order[it.id];
      const slot = placed
        .map(
          (ci, pos) =>
            `<button type="button" class="chunk" data-act="ord-pull" data-id="${it.id}" data-pos="${pos}">${esc(
              it.chunks[ci]
            )}</button>`
        )
        .join("");
      const pool = view.order[it.id]
        .map(
          (ci) =>
            `<button type="button" class="chunk${placed.includes(ci) ? " used" : ""}" data-act="ord-push" data-id="${
              it.id
            }" data-ci="${ci}">${esc(it.chunks[ci])}</button>`
        )
        .join("");
      return `<div class="q">
        <p class="q-no">${qi + 1} / ${set.order.length}</p>
        <div class="slot-row zh" lang="zh-CN">${slot}</div>
        <div class="pool-row zh" lang="zh-CN">${pool}</div>
      </div>`;
    })
    .join("");
  return `<section class="block">
    <div class="block-head"><h2>어순 배열</h2><span class="counter">${set.order.length}문항</span></div>
    <p class="hint">조각을 순서대로 누르세요. 답 칸의 조각을 누르면 되돌립니다.</p>
    ${qs}
  </section>`;
}

function clozeSection(set, ans, view) {
  const p = set.cloze;
  const text = esc(p.text).replace(
    /\{\{(\d+)\}\}/g,
    (_, no) =>
      `<span class="hole${ans.cloze[no] !== null ? " filled" : ""}">${
        ans.cloze[no] !== null
          ? esc(p.blanks.find((b) => String(b.no) === no).options[ans.cloze[no]].t)
          : `　${no}　`
      }</span>`
  );
  const qs = p.blanks
    .map((b) => {
      const opts = view.cloze[b.no]
        .map(
          (oi, pos) =>
            `<button type="button" class="opt${ans.cloze[b.no] === oi ? " picked" : ""}" data-act="clz" data-no="${
              b.no
            }" data-oi="${oi}">
              <span class="opt-key">${KEYS[pos]}</span>
              <span class="opt-text zh" lang="zh-CN">${esc(b.options[oi].t)}</span>
            </button>`
        )
        .join("");
      return `<div class="q"><p class="q-no">빈칸 ${b.no}</p><div class="opts">${opts}</div></div>`;
    })
    .join("");
  return `<section class="block">
    <div class="block-head"><h2>단문 빈칸</h2><span class="counter">${p.blanks.length}문항</span></div>
    <p class="hint">빈칸에 들어갈 말을 고르세요. 단어가 들어가는 자리도 있고 절이 들어가는 자리도 있습니다.</p>
    <p class="passage zh" lang="zh-CN">${text}</p>
    ${qs}
  </section>`;
}

function writingSection(set, ans) {
  const w = set.writing;
  if (!w) return "";
  const panels = w.panels
    ? `<ul class="panels">${w.panels
        .map(
          (p, i) =>
            `<li><b>${i + 1}</b><div><span class="zh" lang="zh-CN">${esc(p.scene)}</span><span class="ko">${esc(
              p.sceneKo
            )}</span></div></li>`
        )
        .join("")}</ul>`
    : "";
  const useful = `<ul class="useful">${w.useful
    .map(
      (u) =>
        `<li><span class="zh" lang="zh-CN">${esc(u.w)}</span> <span class="p">${esc(u.p)}</span> ${esc(u.ko)}</li>`
    )
    .join("")}</ul>`;
  const n = countCjk(ans.writing.text);
  return `<section class="block">
    <div class="block-head"><h2>쓰기</h2><span class="counter">${w.minChars}자 이상</span></div>
    <p class="passage zh" lang="zh-CN">${esc(w.prompt)}</p>
    <p class="ko-line">${esc(w.promptKo)}</p>
    ${panels}
    ${useful}
    <label for="wtext">중국어로 직접 써 보세요</label>
    <textarea id="wtext" lang="zh-CN" class="zh" placeholder="여기에 작문">${esc(ans.writing.text)}</textarea>
    <p class="count${n >= w.minChars ? " enough" : ""}" id="wcount">${n}자 / ${w.minChars}자</p>
  </section>`;
}

export function countCjk(s) {
  return (String(s).match(/[㐀-䶿一-鿿]/g) || []).length;
}

export function renderDrill(set, ans, view) {
  const parts = [seqSection(set, ans), orderSection(set, ans, view), clozeSection(set, ans, view)];
  if (set.writing) parts.push(writingSection(set, ans));
  const ready = isComplete(set, ans);
  parts.push(
    `<button type="button" class="primary-btn" data-act="grade"${ready ? "" : " disabled"}>${
      ready ? "채점하고 해설 보기" : "모두 채우면 채점할 수 있습니다"
    }</button>`
  );
  return parts.join("");
}
