import { esc } from "./drill.js";
import { checkWriting, applyFixes } from "./writing.js";

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
  const which = item.answers.findIndex(
    (a) => a.length === mine.length && a.every((v, i) => mine[i] === v)
  );
  return { ok: which !== -1, which, target: bestAnswer(item, mine) };
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
  const { ok, which, target } = gradeOrder(item, mine);
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

  const alt =
    ok && which > 0
      ? `<p class="lead" style="margin:12px 0 0">이 순서도 맞습니다. 맨 위에 적힌 문장이 같은 뜻으로 가장 흔히 쓰는 형태입니다.</p>`
      : "";

  const diff = ok
    ? alt
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

function clozeCard(passage, mine, flagged, view) {
  const blanks = passage.blanks
    .map((b) => {
      const pick = mine[b.no];
      const ok = gradeCloze(b, pick);
      // 풀 때 본 차례와 글자를 그대로 쓴다. 저장된 차례대로 보여 주면 정답이 늘
      // A 자리에 오고, 내가 고른 글자와도 어긋나서 어느 것을 골랐는지 헷갈린다.
      const shown = (view && view.cloze[b.no]) || b.options.map((_, i) => i);
      const opts = shown
        .map((oi, pos) => {
          const o = b.options[oi];
          const cls = [o.ok ? "is-answer" : "", oi === pick && !o.ok ? "is-mine" : ""].filter(Boolean).join(" ");
          return `<li class="${cls}"><span class="k">${KEYS[pos]}</span><div><span class="zh" lang="zh-CN">${esc(
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

const TAG = { fix: "고칠 곳", look: "볼 곳", note: "참고" };

/** 지적한 자리를 글 안에 칠한다. 겹치면 앞의 것만 남긴다. */
function marked(text, findings) {
  const spots = findings
    .filter((f) => f.at >= 0 && f.len > 0)
    .sort((a, b) => a.at - b.at)
    .reduce((acc, f) => {
      const last = acc[acc.length - 1];
      if (last && f.at < last.at + last.len) return acc;
      acc.push(f);
      return acc;
    }, []);
  let out = "";
  let i = 0;
  for (const f of spots) {
    out += esc(text.slice(i, f.at));
    out += `<mark class="m-${f.level}">${esc(text.slice(f.at, f.at + f.len))}</mark>`;
    i = f.at + f.len;
  }
  return (out + esc(text.slice(i))).replace(/\n/g, "<br>");
}

/**
 * 같은 말을 여러 줄 쓰지 않는다.
 *
 * 쉼표를 네 번 반각으로 찍으면 같은 문장이 네 줄 나온다. 읽을 것이 네 배가 되는데
 * 알게 되는 것은 똑같다. 같은 이유는 한 줄로 묶고 몇 곳인지만 적는다.
 */
function findList(findings) {
  const order = { fix: 0, look: 1, note: 2 };
  const groups = [];
  const byKey = new Map();
  for (const f of findings) {
    const key = f.level + "|" + f.why;
    if (byKey.has(key)) {
      byKey.get(key).n += 1;
      continue;
    }
    const g = { ...f, n: 1 };
    byKey.set(key, g);
    groups.push(g);
  }
  // 꼬리표를 줄마다 되풀이하지 않는다. 같은 등급끼리 묶고 머리에 한 번만 적는다
  return Object.keys(order)
    .map((lv) => {
      const rows = groups.filter((g) => g.level === lv).sort((a, b) => a.at - b.at);
      if (!rows.length) return "";
      const items = rows
        .map((f) => {
          const swap = !f.bad
            ? ""
            : f.fix === null || f.fix === undefined
              ? `<p class="f-swap"><span class="zh bad" lang="zh-CN">${esc(f.bad)}</span></p>`
              : `<p class="f-swap"><span class="zh bad" lang="zh-CN">${esc(f.bad)}</span><span class="arrow">→</span>${
                  f.fix ? `<span class="zh good" lang="zh-CN">${esc(f.fix)}</span>` : `<span class="good">빼기</span>`
                }</p>`;
          return `<li>
            <p class="f-why">${esc(f.why)}${f.n > 1 ? `<span class="f-n">${f.n}곳</span>` : ""}</p>
            ${swap}
          </li>`;
        })
        .join("");
      // 고칠 곳은 카드 머리에 이미 적혀 있다. 바로 밑에 또 적지 않는다
      const head = lv === "fix" ? "" : `<p class="find-head">${TAG[lv]}</p>`;
      return `<div class="find-group f-${lv}">${head}<ul class="finds">${items}</ul></div>`;
    })
    .join("");
}

/**
 * 쓰기 채점. 기계가 확실히 판정할 수 있는 것만 짚고, 그 한계를 화면에 적어 둔다.
 *
 * 문항 화면에서 뺀 것들(문제 번역, 쓸 만한 말, 네 컷 설명)이 여기로 왔다.
 */
function writingCard(item, ans, flagged, wrules) {
  const text = ans.text || "";
  const r = checkWriting(text, item, wrules);
  const nFix = r.findings.filter((f) => f.level === "fix").length;
  const nLook = r.findings.filter((f) => f.level === "look").length;

  if (!text.trim()) {
    return `<div class="ex">
      <div class="ex-head"><span class="verdict">모범답안</span><span class="counter">${esc(item.topic)}</span></div>
      <p class="empty">아직 안 썼습니다. 모범답안을 먼저 읽는 것보다 한 줄이라도 쓰고 보는 쪽이 남습니다.</p>
      ${modelBlock(item)}
      ${flagBtn(item.id, flagged)}
    </div>`;
  }

  const fixed = applyFixes(text, wrules);
  const corrected =
    fixed !== text
      ? `<p class="lead" style="margin:16px 0 6px">고친 글</p>
         <p class="answer-zh zh" lang="zh-CN" style="font-size:16px">${esc(fixed).replace(/\n/g, "<br>")}</p>`
      : "";

  return `<div class="ex">
    <div class="ex-head">
      <span class="verdict ${nFix ? "wrong" : "right"}">${nFix ? `고칠 곳 ${nFix}` : "고칠 곳 없음"}</span>
      <span class="counter">${esc(item.topic)}</span>
    </div>
    <ul class="chips">
      <li class="${r.n >= item.minChars ? "ok" : "no"}">${r.n} / ${item.minChars}자</li>
      <li>단락 ${r.paras.length}개</li>
      <li>문장 ${r.sents.length}개</li>
    </ul>
    ${r.findings.length ? `<ul class="finds">${findList(r.findings)}</ul>` : ""}
    <div class="note-box"><p>여기서 보는 것은 규칙으로 판정되는 것뿐입니다. 글이 주제에 맞는지, 문장이 중국어답게 읽히는지는 아래 모범답안과 견주세요.</p></div>
    <p class="lead" style="margin:16px 0 6px">내가 쓴 글</p>
    <p class="answer-zh zh" lang="zh-CN" style="font-size:16px">${marked(text, r.findings)}</p>
    ${corrected}
    ${modelBlock(item)}
    ${flagBtn(item.id, flagged)}
  </div>`;
}

function modelBlock(item) {
  const panels = item.panels
    ? `<ul class="panels">${item.panels
        .map(
          (p, i) =>
            `<li><b>${i + 1}</b><div><span class="zh" lang="zh-CN">${esc(p.scene)}</span><span class="ko">${esc(
              p.sceneKo
            )}</span></div></li>`
        )
        .join("")}</ul>`
    : "";
  const useful = `<ul class="useful">${item.useful
    .map(
      (u) =>
        `<li><span class="zh" lang="zh-CN">${esc(u.w)}</span> <span class="p">${esc(u.p)}</span> ${esc(u.ko)}</li>`
    )
    .join("")}</ul>`;
  return `<p class="lead" style="margin:18px 0 6px">문제</p>
    <p class="ko-line">${esc(item.promptKo)}</p>
    ${panels}
    <p class="lead" style="margin:18px 0 6px">쓸 만한 말</p>
    ${useful}
    <p class="lead" style="margin:18px 0 6px">모범답안</p>
    <p class="answer-zh zh" lang="zh-CN">${esc(item.model).replace(/\n/g, "<br>")}</p>
    <p class="ko-line" style="margin-top:8px">${esc(item.modelKo).replace(/\n/g, "<br>")}</p>
    <ul class="rules" style="margin-top:16px">${item.checklist.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`;
}

export function renderResult(set, ans, flags, view, wrules) {
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
      ${clozeCard(set.cloze, ans.cloze, flagged.has(set.cloze.id), view)}
    </section>`,
  ];
  if (set.writing) {
    out.push(`<section class="block">
      <div class="block-head"><h2>쓰기</h2></div>
      ${writingCard(set.writing, ans.writing, flagged.has(set.writing.id), wrules)}
    </section>`);
  }
  out.push(`<div class="row-btns">
    <button type="button" class="primary-btn" data-act="next-set">한 세트 더 풀기</button>
    <button type="button" data-act="record">기록 보기</button>
  </div>`);
  return out.join("");
}
