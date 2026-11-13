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
    <div class="block-head"><h2 class="zh" lang="zh-CN">排列顺序</h2><span class="counter">5题</span></div>
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
    <div class="block-head"><h2 class="zh" lang="zh-CN">连词成句</h2><span class="counter">${set.order.length}题</span></div>
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
      return `<div class="q"><p class="q-no zh" lang="zh-CN">第${b.no}题</p><div class="opts">${opts}</div></div>`;
    })
    .join("");
  return `<section class="block">
    <div class="block-head"><h2 class="zh" lang="zh-CN">选词填空</h2><span class="counter">${p.blanks.length}题</span></div>
    <p class="passage zh" lang="zh-CN">${text}</p>
    ${qs}
  </section>`;
}

/**
 * 쓰기 문항. 실제 시험지에 없는 것은 여기에도 없다.
 *
 * 번역, 쓸 만한 어휘, 요령은 전부 채점 화면으로 옮겼다. 풀 때 옆에 두면 그걸 보고
 * 쓰게 되고, 시험장에서는 없는 것들이다.
 */
function writingSection(set, ans) {
  const w = set.writing;
  if (!w) return "";
  const panels = w.panels
    ? `<ul class="panels">${w.panels
        .map((p, i) => `<li><b>${i + 1}</b><div><span class="zh" lang="zh-CN">${esc(p.scene)}</span></div></li>`)
        .join("")}</ul>`
    : "";
  const n = countCjk(ans.writing.text);
  return `<section class="block">
    <div class="block-head"><h2 class="zh" lang="zh-CN">写作</h2><span class="counter">${w.minChars}字以上</span></div>
    <p class="passage zh" lang="zh-CN">${esc(w.prompt)}</p>
    ${panels}
    <label for="wtext" class="zh" lang="zh-CN">请在下面写作文</label>
    <textarea id="wtext" lang="zh-CN" class="zh" placeholder="从这里开始">${esc(ans.writing.text)}</textarea>
    <p class="count${n >= w.minChars ? " enough" : ""}" id="wcount">${n} / ${w.minChars}字</p>
  </section>`;
}

export function countCjk(s) {
  return (String(s).match(/[㐀-䶿一-鿿]/g) || []).length;
}

export function renderDrill(set, ans, view) {
  const parts = [seqSection(set, ans), orderSection(set, ans, view), clozeSection(set, ans, view)];
  if (set.writing) parts.push(writingSection(set, ans));
  const ready = isComplete(set, ans);
  // 단추도 중국어다. 문제를 푸는 화면에는 한국어를 한 글자도 두지 않는다
  parts.push(
    `<button type="button" class="primary-btn zh" lang="zh-CN" data-act="grade"${ready ? "" : " disabled"}>${
      ready ? "交卷，看答案" : "全部做完才能交卷"
    }</button>`
  );
  return parts.join("");
}
