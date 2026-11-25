import { esc, clozeBase } from "./drill.js";
import { checkWriting, applyFixes, apiKey } from "./writing.js";

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

function flagOne(id, flagged) {
  return `<button type="button" class="ghost-btn flag-btn" data-act="flag" data-id="${id}">${
    flagged ? "신고함" : "이 문항 이상함"
  }</button>`;
}

function flagBtn(id, flagged) {
  return `<div class="ex-btns">${flagOne(id, flagged)}</div>`;
}

/**
 * 틀린 문항에 어법 설명을 붙이는 자리.
 *
 * 받아 둔 설명이 있으면 그걸 그린다. 없으면 단추만 둔다. 열쇠가 없으면 단추도
 * 두지 않는다. 작문 자리에서 열쇠를 넣게 되어 있고, 여기에 또 칸을 두면 같은
 * 것을 두 군데서 묻는 화면이 된다.
 *
 * flagged 가 null 이면 신고 단추를 빼고 어법 단추만 둔다. 빈칸은 지문 하나에
 * 문항이 여럿이라 신고는 지문에 한 번만 받는다.
 */
function noteArea(id, notes, flagged, wrong) {
  const kept = (notes.kept || {})[id];
  const live = notes.id === id ? notes.state : "idle";
  let body = "";
  let btn = "";
  if (wrong && kept) {
    // 예문이 안 올 수도 있다. 개수는 모델에게 말로 시키고 스키마로 묶지 않는다.
    const ex = kept.examples || [];
    body = `<div class="n-box">
      <p class="keep-head">어법</p>
      ${(kept.lines || []).map((l) => `<p class="n-line">${esc(l)}</p>`).join("")}
      ${
        ex.length
          ? `<ul class="n-ex">${ex
              .map(
                (e) =>
                  `<li><span class="zh" lang="zh-CN">${esc(e.zh)}</span><span class="k-ko">${esc(e.ko)}</span></li>`
              )
              .join("")}</ul>`
          : ""
      }
    </div>`;
  } else if (wrong && live === "busy") {
    body = `<p class="n-wait">어법 설명을 받고 있습니다.</p>`;
  } else if (wrong && live === "error") {
    body = `<p class="g-error">${esc(notes.error)}</p>`;
    btn = `<button type="button" class="ghost-btn" data-act="explain" data-id="${esc(id)}">다시 받기</button>`;
  } else if (wrong && apiKey()) {
    btn = `<button type="button" class="ghost-btn" data-act="explain" data-id="${esc(id)}">어법 설명</button>`;
  }
  const flag = flagged === null ? "" : flagOne(id, flagged);
  return `${body}${btn || flag ? `<div class="ex-btns">${btn}${flag}</div>` : ""}`;
}

function orderCard(item, mine, flagged, notes) {
  const { ok, which, target } = gradeOrder(item, mine);
  const mism = target.map((v, i) => mine[i] !== v);
  const first = mism.indexOf(true);
  const parts = target
    .map((ci) => {
      const r = item.roles[ci];
      const ko = (item.chunkKo && item.chunkKo[ci]) || "";
      return `<li data-role="${roleClass(r)}"><span class="zh" lang="zh-CN">${esc(
        item.chunks[ci]
      )}</span>${ko ? `<span class="p-ko">${esc(ko)}</span>` : ""}<span class="role">${esc(r)}</span></li>`;
    })
    .join("");

  // 이 문장에서 가져갈 말. 문항은 하루 지나면 잊어도, 여기 적힌 말은 다음 문장에서 또 나온다
  const keep = (item.keep || []).length
    ? `<div class="keep">
        <p class="keep-head">외워 둘 말</p>
        <ul>${item.keep
          .map(
            (k) =>
              `<li><p class="k-line"><span class="zh" lang="zh-CN">${esc(k.zh)}</span><span class="k-ko">${esc(
                k.ko
              )}</span></p><p class="k-use">${esc(k.use)}</p></li>`
          )
          .join("")}</ul>
      </div>`
    : "";

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
      <p class="lead" style="margin:12px 0 0">${first + 1}번째부터 순서가 다릅니다. 그 자리에는 ${esc(
        item.roles[target[first]]
      )}인 <span class="zh" lang="zh-CN">${esc(item.chunks[target[first]])}</span>가 옵니다.</p>`;

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
    ${keep}
    ${noteArea(item.id, notes, flagged, !ok)}
  </div>`;
}

export function gradeSequence(set, mine) {
  return set.answer.map((k, i) => mine[i] === k);
}

/**
 * 단락 배열 해설.
 *
 * 정답 순서대로 토막글을 늘어놓고 토막마다 해석을 붙인다. 순서를 정하는 근거는
 * 적지 않는다. 글자가 안 읽히는 상태에서는 근거를 읽어도 알 수 없고, 정답 순서로
 * 읽어 보면 어디가 이어지는지는 글에서 바로 보인다.
 */
function sequenceCard(set, mine, flagged) {
  const hits = gradeSequence(set, mine);
  const okCount = hits.filter(Boolean).length;

  const read = set.answer
    .map(
      (k) => `<li>
        <span class="s-key">${k}</span>
        <div>
          <p class="zh" lang="zh-CN">${esc(set.segments[k])}</p>
          <p class="s-ko">${esc((set.ko || {})[k] || "")}</p>
        </div>
      </li>`
    )
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
    <ul class="seq-read">${read}</ul>
    ${flagBtn(set.id, flagged)}
  </div>`;
}

export function gradeCloze(blank, pick) {
  return blank.options[pick] && blank.options[pick].ok === true;
}

function clozeCard(passage, mine, flagged, view, base, notes) {
  const blanks = passage.blanks
    .map((b) => {
      const at = `${passage.id}:${b.no}`;
      const pick = mine[at];
      const ok = gradeCloze(b, pick);
      // 풀 때 본 차례와 글자를 그대로 쓴다. 저장된 차례대로 보여 주면 정답이 늘
      // A 자리에 오고, 내가 고른 글자와도 달라서 어느 것을 골랐는지 헷갈린다.
      const shown = (view && view.cloze[at]) || b.options.map((_, i) => i);
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
          <span class="verdict ${ok ? "right" : "wrong"}">빈칸 ${base + b.no} ${
            ok ? "맞음" : "틀림"
          }</span>
        </div>
        <ul class="opt-review">${opts}</ul>
        ${noteArea(at, notes, null, !ok)}
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
/**
 * 모델이 보는 자리.
 *
 * 기계 점검이 못 보는 것만 여기서 본다. 주제에 맞게 썼는지, 중국어로 그렇게
 * 말하는지다. 열쇠가 없으면 열쇠를 받는 칸이 먼저 나온다.
 */
const bare = (s) => String(s).replace(/[\s。，、！？；：]/g, "");

/**
 * 다시 쓰기.
 *
 * 틀린 문형 하나를 단어만 바꿔서 세 번 쓴다. 한국어 뜻과 쓸 단어를 주고 중국어
 * 한 문장을 쓰게 한다. 단추를 누르면 모범 문장이 내가 쓴 것 밑에 붙는다.
 *
 * 맞았는지는 적지 않는다. 같은 뜻을 다른 말로 쓴 것도 맞는 중국어라서, 글자가
 * 다르다고 틀렸다고 하면 맞는 답을 틀렸다고 가르치는 일이 된다. 글자까지 같을
 * 때만 같다고 적는다.
 */
function drillBlock(d, drill) {
  if (!d || !d.items || !d.items.length) return "";
  const rows = d.items
    .map((it, i) => {
      const mine = drill.text[i] || "";
      const same = drill.shown && mine && bare(mine) === bare(it.answer);
      return `<li>
        <p class="d-ko">${esc(it.ko)}</p>
        <p class="d-words zh" lang="zh-CN">${esc(it.words)}</p>
        <input type="text" class="zh" lang="zh-CN" data-drill="${i}" autocomplete="off" spellcheck="false"
          value="${esc(mine)}" placeholder="여기에 중국어로 쓰기">
        ${
          drill.shown
            ? `<p class="d-ans"><span class="d-tag">모범</span><span class="zh" lang="zh-CN">${esc(
                it.answer
              )}</span>${same ? `<span class="d-same">같음</span>` : ""}</p>`
            : ""
        }
      </li>`;
    })
    .join("");
  return `<div class="drill">
    <p class="keep-head">다시 쓰기</p>
    ${d.pattern ? `<p class="d-pat">${esc(d.pattern)}</p>` : ""}
    ${d.why ? `<p class="d-why">${esc(d.why)}</p>` : ""}
    <ul>${rows}</ul>
    ${
      drill.shown
        ? ""
        : `<div class="ex-btns"><button type="button" class="ghost-btn" data-act="drill-show">모범 문장 보기</button></div>`
    }
  </div>`;
}

function gradeBlock(mark, drill) {
  const head = `<p class="lead" style="margin:18px 0 6px">채점</p>`;
  if (!apiKey()) {
    return `${head}<div class="keyform">
      <p class="k-note">쓴 글을 모델에게 보내서 고칠 곳을 받습니다. 열쇠는 이 기기에만 저장되고, 쓴 글은 채점할 때만 나갑니다.</p>
      <input id="apikey" type="password" autocomplete="off" spellcheck="false" placeholder="Anthropic API 열쇠">
      <button type="button" data-act="save-key">열쇠 저장</button>
    </div>`;
  }
  if (mark.state === "busy") {
    return `${head}<p class="empty">채점 중입니다. 삼십 초쯤 걸립니다.</p>`;
  }
  if (mark.state === "error") {
    return `${head}<p class="g-error">${esc(mark.error)}</p>
      <button type="button" data-act="grade-writing">다시 받기</button>
      <button type="button" class="ghost-btn" data-act="drop-key">열쇠 지우기</button>`;
  }
  if (mark.state !== "done") {
    return `${head}<button type="button" data-act="grade-writing">채점 받기</button>`;
  }
  const g = mark.grade;
  // 먼저 받아 둔 채점에는 고쳐 쓴 글과 다시 쓰기가 없다. 그 자리만 비워 둔다
  const rewrite = g.rewrite
    ? `<p class="lead" style="margin:16px 0 6px">고친 글</p>
       <p class="answer-zh zh" lang="zh-CN" style="font-size:16px">${esc(g.rewrite).replace(/\n/g, "<br>")}</p>`
    : "";
  const fixes = g.fixes.length
    ? `<div class="find-group f-fix"><ul class="finds">${g.fixes
        .map(
          (f) => `<li>
            <p class="f-why">${esc(f.why)}</p>
            <p class="f-swap"><span class="zh bad" lang="zh-CN">${esc(f.bad)}</span><span class="arrow">→</span>${
              f.good ? `<span class="zh good" lang="zh-CN">${esc(f.good)}</span>` : `<span class="good">빼기</span>`
            }</p>
          </li>`
        )
        .join("")}</ul></div>`
    : `<p class="g-none">고칠 중국어는 없습니다.</p>`;
  const used = g.used.length
    ? `<p class="g-used"><span class="g-tag">맞게 쓴 것</span><span class="zh" lang="zh-CN">${g.used
        .map(esc)
        .join("，")}</span></p>`
    : "";
  return `${head}
    <p class="g-verdict">${esc(g.verdict)}</p>
    ${rewrite}
    ${fixes}
    ${g.content.length ? `<ul class="rules">${g.content.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>` : ""}
    ${used}
    ${drillBlock(g.drill, drill)}`;
}

function writingCard(item, ans, flagged, wrules, mark, drill) {
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

  // 규칙으로 고친 글은 모델이 고쳐 쓴 글이 오기 전까지만 둔다. 같은 글을 세 번
  // 그리면 어느 것을 읽어야 하는지 알 수 없다.
  const fromModel = mark.state === "done" && mark.grade && mark.grade.rewrite;
  const fixed = applyFixes(text, wrules);
  const corrected =
    !fromModel && fixed !== text
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
    <p class="lead" style="margin:16px 0 6px">내가 쓴 글</p>
    <p class="answer-zh zh" lang="zh-CN" style="font-size:16px">${marked(text, r.findings)}</p>
    ${corrected}
    ${gradeBlock(mark, drill)}
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

export function renderResult(set, ans, flags, view, wrules, mark, notes, drill) {
  const flagged = new Set(flags.map((f) => f.id));
  const seqTotal = 5 * set.sequence.length;
  const clzTotal = set.cloze.reduce((s, p) => s + p.blanks.length, 0);
  const seqHits = set.sequence.reduce(
    (s, q) => s + gradeSequence(q, ans.sequence[q.id]).filter(Boolean).length,
    0
  );
  const ordHits = set.order.filter((it) => gradeOrder(it, ans.order[it.id]).ok).length;
  const clzHits = set.cloze.reduce(
    (s, p) => s + p.blanks.filter((b) => gradeCloze(b, ans.cloze[`${p.id}:${b.no}`])).length,
    0
  );
  const total = seqTotal + set.order.length + clzTotal;
  const got = seqHits + ordHits + clzHits;

  const out = [
    `<section class="block">
      <div class="score"><strong>${got} / ${total}</strong><span>단락 ${seqHits}/${seqTotal} · 어순 ${ordHits}/${
      set.order.length
    } · 빈칸 ${clzHits}/${clzTotal}</span></div>
    </section>`,
    `<section class="block">
      <div class="block-head"><h2>단락 배열</h2></div>
      ${set.sequence.map((q) => sequenceCard(q, ans.sequence[q.id], flagged.has(q.id))).join("")}
    </section>`,
    `<section class="block">
      <div class="block-head"><h2>어순 배열</h2></div>
      ${set.order.map((it) => orderCard(it, ans.order[it.id], flagged.has(it.id), notes)).join("")}
    </section>`,
    `<section class="block">
      <div class="block-head"><h2>단문 빈칸</h2></div>
      ${set.cloze
        .map((p, pi) => clozeCard(p, ans.cloze, flagged.has(p.id), view, clozeBase(set, pi), notes))
        .join("")}
    </section>`,
  ];
  if (set.writing) {
    out.push(`<section class="block">
      <div class="block-head"><h2>쓰기</h2></div>
      ${writingCard(set.writing, ans.writing, flagged.has(set.writing.id), wrules, mark || { state: "idle" }, drill)}
    </section>`);
  }
  out.push(`<div class="row-btns">
    <button type="button" class="primary-btn" data-act="next-set">한 세트 더 풀기</button>
    <button type="button" data-act="record">기록 보기</button>
  </div>`);
  return out.join("");
}
