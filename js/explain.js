import { esc, countCjk } from "./drill.js";

const KEYS = ["A", "B", "C", "D", "E"];

function roleClass(label) {
  if (label.includes("주어")) return "subject";
  if (label.includes("술어")) return "predicate";
  if (label.includes("부사")) return "adverbial";
  if (label.includes("보어")) return "complement";
  if (label.includes("목적어")) return "object";
  return "other";
}

/** 받아들이는 정답이 여러 개일 수 있으니 가장 많이 맞은 것과 견준다. */
export function bestAnswer(item, mine) {
  let best = item.answers[0];
  let hit = -1;
  for (const a of item.answers) {
    const n = a.reduce((s, v, i) => s + (mine[i] === v ? 1 : 0), 0);
    if (n > hit) {
      hit = n;
      best = a;
    }
  }
  return best;
}

export function gradeOrder(item, mine) {
  const ok = item.answers.some((a) => a.length === mine.length && a.every((v, i) => mine[i] === v));
  return { ok, target: bestAnswer(item, mine) };
}

function tokens(item, list, flags) {
  return list
    .map((ci, i) => `<span class="tok${flags[i] ? " " + flags[i] : ""}">${esc(item.chunks[ci])}</span>`)
    .join("");
}

function flagBtn(id, flagged) {
  return `<button type="button" class="ghost-btn flag-btn" data-act="flag" data-id="${id}">${
    flagged ? "신고함" : "이 문항 이상함"
  }</button>`;
}

function orderCard(item, mine, flagged) {
  const { ok, target } = gradeOrder(item, mine);
  const mism = target.map((v, i) => mine[i] !== v);
  const first = mism.indexOf(true);
  const parts = target
    .map((ci) => {
      const r = item.roles[ci];
      return `<li data-role="${roleClass(r)}"><span class="zh" lang="zh-CN">${esc(
        item.chunks[ci]
      )}</span><span class="role">${esc(r)}</span></li>`;
    })
    .join("");

  const diff = ok
    ? ""
    : `<div class="diff">
        <div class="diff-row"><span>내 답</span><div class="diff-seq zh" lang="zh-CN">${tokens(
          item,
          mine,
          mism.map((m) => (m ? "bad" : ""))
        )}</div></div>
        <div class="diff-row"><span>정답</span><div class="diff-seq zh" lang="zh-CN">${tokens(
          item,
          target,
          mism.map((m) => (m ? "good" : ""))
        )}</div></div>
      </div>
      <p class="lead" style="margin:12px 0 0">처음 어긋난 자리는 ${first + 1}번째입니다. 거기에는 ${esc(
        item.roles[target[first]]
      )}인 <span class="zh" lang="zh-CN">${esc(item.chunks[target[first]])}</span>가 와야 합니다.</p>`;

  return `<div class="ex ${ok ? "right" : "wrong"}">
    <div class="ex-head">
      <span class="verdict ${ok ? "right" : "wrong"}">${ok ? "맞음" : "틀림"}</span>
      <span class="counter">${esc(item.grammar.join(" / "))}</span>
    </div>
    <p class="answer-zh zh" lang="zh-CN">${esc(item.sentence)}</p>
    <p class="pinyin">${esc(item.pinyin)}</p>
    <p class="ko-line">${esc(item.ko)}</p>
    <ul class="parts">${parts}</ul>
    ${diff}
    <ul class="rules">${item.rules.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
    ${flagBtn(item.id, flagged)}
  </div>`;
}

export function gradeSequence(set, mine) {
  return set.answer.map((k, i) => mine[i] === k);
}

function sequenceCard(set, mine, flagged) {
  const hits = gradeSequence(set, mine);
  const okCount = hits.filter(Boolean).length;
  const minePairs = new Set(mine.slice(0, -1).map((k, i) => `${k}>${mine[i + 1]}`));

  const chain = set.links
    .map((ln, i) => {
      const broken = !minePairs.has(`${ln.from}>${ln.to}`);
      return `<div class="chain-step${broken ? " broken" : ""}">
        <b>${ln.from} &rarr; ${ln.to}${broken ? '<span class="brk">여기서 끊김</span>' : ""}</b>
        <div>${esc(ln.cue)}${
        ln.mark ? `<span class="mark zh" lang="zh-CN">${esc(ln.mark)}</span>` : ""
      }</div>
      </div>`;
    })
    .join("");

  const row = (label, list, cls) =>
    `<div class="diff-row"><span>${label}</span><div class="diff-seq">${list
      .map((k, i) => `<span class="tok${hits[i] ? "" : " " + cls}">${k || "-"}</span>`)
      .join("")}</div></div>`;

  return `<div class="ex ${okCount === 5 ? "right" : "wrong"}">
    <div class="ex-head">
      <span class="verdict ${okCount === 5 ? "right" : "wrong"}">${okCount} / 5</span>
      <span class="counter">${esc(set.topic)}</span>
    </div>
    <div class="diff">
      ${row("내 답", mine, "bad")}
      ${row("정답", set.answer, "good")}
    </div>
    <p class="lead" style="margin:14px 0 0">${esc(set.first)}</p>
    <div class="chain">${chain}</div>
    <p class="ko-line" style="margin-top:14px">${esc(set.ko)}</p>
    ${flagBtn(set.id, flagged)}
  </div>`;
}

export function gradeCloze(blank, pick) {
  return blank.options[pick] && blank.options[pick].ok === true;
}

function clozeCard(passage, mine, flagged) {
  const blanks = passage.blanks
    .map((b) => {
      const pick = mine[b.no];
      const ok = gradeCloze(b, pick);
      const opts = b.options
        .map((o, i) => {
          const cls = [o.ok ? "is-answer" : "", i === pick && !o.ok ? "is-mine" : ""].filter(Boolean).join(" ");
          return `<li class="${cls}"><span class="k">${KEYS[i]}</span><div><span class="zh" lang="zh-CN">${esc(
            o.t
          )}</span><span class="note">${esc(o.note)}</span></div></li>`;
        })
        .join("");
      return `<div class="ex ${ok ? "right" : "wrong"}">
        <div class="ex-head">
          <span class="verdict ${ok ? "right" : "wrong"}">빈칸 ${b.no} ${ok ? "맞음" : "틀림"}</span>
        </div>
        <ul class="opt-review">${opts}</ul>
      </div>`;
    })
    .join("");
  return `${blanks}<div class="ex"><p class="ko-line">${esc(passage.ko)}</p>${flagBtn(passage.id, flagged)}</div>`;
}

function writingCard(item, ans, flagged) {
  const n = countCjk(ans.text);
  const mine = ans.text.trim()
    ? `<p class="lead" style="margin:0 0 6px">내가 쓴 글 ${n}자${
        n >= item.minChars ? "" : `, ${item.minChars - n}자 더 필요`
      }</p><p class="answer-zh zh" lang="zh-CN" style="font-size:16px">${esc(ans.text)}</p>`
    : `<p class="empty">아직 안 썼습니다. 모범답안을 먼저 읽는 것보다 한 줄이라도 쓰고 보는 쪽이 남습니다.</p>`;
  return `<div class="ex">
    <div class="ex-head"><span class="verdict">모범답안</span><span class="counter">${esc(item.topic)}</span></div>
    ${mine}
    <p class="answer-zh zh" lang="zh-CN" style="margin-top:16px">${esc(item.model).replace(/\n/g, "<br>")}</p>
    <p class="ko-line" style="margin-top:8px">${esc(item.modelKo).replace(/\n/g, "<br>")}</p>
    <ul class="rules" style="margin-top:16px">${item.checklist.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>
    ${flagBtn(item.id, flagged)}
  </div>`;
}

export function renderResult(set, ans, flags) {
  const flagged = new Set(flags.map((f) => f.id));
  const seqHits = gradeSequence(set.sequence, ans.sequence).filter(Boolean).length;
  const ordHits = set.order.filter((it) => gradeOrder(it, ans.order[it.id]).ok).length;
  const clzHits = set.cloze.blanks.filter((b) => gradeCloze(b, ans.cloze[b.no])).length;
  const total = 5 + set.order.length + set.cloze.blanks.length;
  const got = seqHits + ordHits + clzHits;

  const out = [
    `<section class="block">
      <div class="score"><strong>${got} / ${total}</strong><span>단락 ${seqHits}/5 · 어순 ${ordHits}/${
      set.order.length
    } · 빈칸 ${clzHits}/${set.cloze.blanks.length}</span></div>
      <p class="hint">틀린 문항은 3일 뒤에 다시 나옵니다. 또 틀리면 7일 뒤에 나옵니다.</p>
    </section>`,
    `<section class="block">
      <div class="block-head"><h2>단락 배열</h2></div>
      ${sequenceCard(set.sequence, ans.sequence, flagged.has(set.sequence.id))}
    </section>`,
    `<section class="block">
      <div class="block-head"><h2>어순 배열</h2></div>
      ${set.order.map((it) => orderCard(it, ans.order[it.id], flagged.has(it.id))).join("")}
    </section>`,
    `<section class="block">
      <div class="block-head"><h2>단문 빈칸</h2></div>
      ${clozeCard(set.cloze, ans.cloze, flagged.has(set.cloze.id))}
    </section>`,
  ];
  if (set.writing) {
    out.push(`<section class="block">
      <div class="block-head"><h2>쓰기</h2></div>
      ${writingCard(set.writing, ans.writing, flagged.has(set.writing.id))}
    </section>`);
  }
  out.push(`<div class="row-btns">
    <button type="button" data-act="retry">다시 풀기</button>
    <button type="button" data-act="record">기록 보기</button>
  </div>`);
  return out.join("");
}
