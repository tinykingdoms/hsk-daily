import {
  load, save, bumpStat, dateKey, markSeen, recordSet, setsToday,
  recordReading, readingToday, readingTotals,
} from "./store.js";
import { buildDay, rebuildDay, seedSeen } from "./daily.js";
import { renderDrill, buildView, emptyAnswers, isComplete, countCjk, esc } from "./drill.js";
import { renderResult, keptGrades, gradeOrder, gradeSequence, gradeCloze } from "./explain.js";
import { gradeWriting, setApiKey, explainGrammar, orderAsk, clozeAsk } from "./writing.js";
import {
  buildReading, buildReadingView, emptyReadingAnswers, readingComplete,
  gradeReadingQuestion, renderReading, renderReadingResult, readingExhausted,
} from "./reading.js";

const main = document.getElementById("main");
const dayLine = document.getElementById("dayLine");

let data, state, set, view, ans;
let rd, rdView, rdAns;
let route = "drill";
let forceWeekday = false;
// 모델 채점은 한 번 받으면 기록에 남는다. 같은 글을 두 번 보내지 않는다.
let mark = { id: null, state: "idle" };
// 어법 설명도 받으면 기록에 남는다. 지금 받고 있는 문항만 여기 둔다.
let note = { id: null, state: "idle", error: "" };
// 다시 쓰기에 쓴 글. 화면을 다시 그려도 칸이 비지 않게 여기 들고 있는다.
let drill = { text: {}, shown: false };

// 제목줄도 문제를 푸는 동안 눈에 들어온다. 그래서 여기도 중국어로 둔다.
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

async function boot() {
  try {
    const [sequence, order, cloze, writing, reading, wrules] = await Promise.all(
      ["sequence", "order", "cloze", "writing", "reading", "wrules"].map((n) =>
        fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => {
          if (!r.ok) throw new Error(`${n}.json ${r.status}`);
          return r.json();
        })
      )
    );
    data = { sequence, order, cloze, writing, reading, wrules };
  } catch (e) {
    main.innerHTML = `<section class="block"><p class="empty">문항 파일을 읽지 못했습니다. ${esc(
      e.message
    )}</p></section>`;
    return;
  }
  state = load();
  // 예전 기록에는 본 문항 목록이 없다. 한 번만 채워 넣는다.
  if (!Object.keys(state.seen).length && Object.keys(state.days).length) {
    state.seen = seedSeen(data, state);
    delete state.review;
    save(state);
  }
  if (!reopenToday()) startDay();
  keepFresh();
}

/**
 * 지금 열어 둔 세트를 기기에 적어 둔다.
 *
 * 새로고침하면 답과 채점 화면이 사라진다. 문항 id 와 답을 적어 두면 다시 열 때
 * 같은 자리로 돌아온다. 보기 차례(view)는 씨앗이 고정이라 적지 않아도 같게 선다.
 */
function keepOpen() {
  if (!set || set.exhausted) {
    state.open = null;
  } else {
    state.open = {
      id: set.id,
      key: set.key,
      nth: set.nth,
      ids: {
        sequence: set.sequence.map((s) => s.id),
        order: set.order.map((it) => it.id),
        cloze: set.cloze.map((p) => p.id),
        writing: set.writing ? set.writing.id : null,
      },
      ans,
      drill,
    };
  }
  save(state);
}

// 글자마다 저장하지는 않는다. 손을 멈추면 적는다.
let typing = 0;
function keepOpenSoon() {
  clearTimeout(typing);
  typing = setTimeout(keepOpen, 800);
}

/** 적어 둔 세트가 오늘 것이면 그 자리로 돌아간다. 아니면 오늘 세트를 새로 연다. */
function reopenToday() {
  const open = state.open;
  if (!open || open.key !== dateKey(today())) return false;
  const s = rebuildDay(data, open);
  if (!s) return false;
  set = s;
  view = buildView(set);
  // 적어 둔 답이 모자라도 화면은 서야 한다. 빈 답 위에 적어 둔 것을 얹는다.
  const base = emptyAnswers(set);
  const was = open.ans || {};
  ans = {
    sequence: { ...base.sequence, ...was.sequence },
    order: { ...base.order, ...was.order },
    cloze: { ...base.cloze, ...was.cloze },
    writing: { ...base.writing, ...was.writing },
  };
  drill = open.drill || { text: {}, shown: false };
  // 토요일에 푼 세트로 돌아올 때 주말 안내가 앞을 막지 않게 한다.
  forceWeekday = true;
  route = set.id in state.sets ? "result" : "drill";
  render();
  return true;
}

/**
 * 고친 것이 폰에 내려가게 한다.
 *
 * 홈 화면에 깔아 두면 앱을 다시 열어도 페이지가 그대로 살아 있다. 새로 고치는 일이
 * 없으니 며칠 전 파일을 계속 본다. 고쳐서 올려도 모르고, 이미 지운 줄을 계속 본다.
 * 그래서 열 때와 다시 앞으로 올 때마다 새 것이 있는지 묻는다.
 *
 * 받아 놓고 바로 다시 그리지는 않는다. 풀던 답과 쓰던 작문이 날아가기 때문이다.
 * 풀던 것이 없을 때, 아니면 다음 세트를 열 때 바꿔 끼운다.
 */
let fresh = false;

function busy() {
  if (rd && rdAns && Object.values(rdAns).some((x) => x !== null)) return true;
  if (!ans) return false;
  return (
    ans.writing.text.trim() !== "" ||
    Object.values(drill.text).some((t) => t.trim() !== "") ||
    Object.values(ans.sequence).some((l) => l.some((x) => x !== null)) ||
    Object.values(ans.order).some((l) => l.length) ||
    Object.values(ans.cloze).some((x) => x !== null)
  );
}

function swapIn() {
  if (!fresh) return;
  fresh = false;
  location.reload();
}

function keepFresh() {
  if (!("serviceWorker" in navigator)) return;
  const had = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // 처음 깔리는 중이면 지금 보고 있는 것이 이미 새 파일이다
    if (!had) return;
    fresh = true;
    if (!busy()) swapIn();
  });
  navigator.serviceWorker.register("sw.js").then((reg) => {
    const ask = () => reg.update().catch(() => {});
    ask();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (fresh && !busy()) swapIn();
      else ask();
    });
  }, () => {});
}

/** ?d=2026-11-13 을 붙이면 그 날짜의 세트를 볼 수 있다. 월요일과 금요일 쓰기 확인용. */
function today() {
  const q = new URLSearchParams(location.search).get("d");
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const [y, m, d] = q.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

function startDay() {
  swapIn();
  const now = today();
  set = buildDay(data, state, now, setsToday(state, dateKey(now)));
  if (!set.exhausted) {
    view = buildView(set);
    ans = emptyAnswers(set);
  }
  route = "drill";
  mark = { id: null, state: "idle" };
  note = { id: null, state: "idle", error: "" };
  drill = { text: {}, shown: false };
  keepOpen();
  render();
}

/**
 * 이 작문에 대한 채점 상태.
 *
 * 받아 둔 채점이 있고 글이 그때와 같으면 그걸 다시 쓴다. 글은 채점 화면에서
 * 고칠 수 없으니, 같은 글을 다시 보내는 것은 돈만 쓰는 일이다.
 */
function writingMark() {
  if (!set.writing) return { state: "idle" };
  if (mark.id === set.writing.id) return mark;
  const kept = (state.graded || {})[set.writing.id];
  if (kept && kept.text === (ans.writing.text || "")) return { state: "done", grade: kept.grade };
  return { state: "idle" };
}

async function askGrade() {
  const item = set.writing;
  mark = { id: item.id, state: "busy" };
  render();
  try {
    const grade = await gradeWriting(item, ans.writing.text || "");
    state.graded = state.graded || {};
    state.graded[item.id] = { text: ans.writing.text || "", grade, at: Date.now() };
    save(state);
    mark = { id: item.id, state: "done", grade };
    // 새 문장이 왔으니 앞 채점에 쓴 답은 지운다
    drill = { text: {}, shown: false };
    keepOpen();
  } catch (e) {
    mark = { id: item.id, state: "error", error: e.message };
  }
  render();
}

/** 화면에 내려 줄 어법 설명. 받아 둔 것과 지금 받고 있는 것을 같이 넘긴다. */
function noteView() {
  return { id: note.id, state: note.state, error: note.error, kept: state.notes || {} };
}

/** 어법 설명을 받는다. 문항 종류에 따라 보낼 말이 다르다. */
function noteAsk(id) {
  if (id.includes(":")) {
    const [pid, no] = id.split(":");
    const p = set.cloze.find((x) => x.id === pid);
    const b = p && p.blanks.find((x) => String(x.no) === no);
    return p && b ? clozeAsk(p, b, ans.cloze[id]) : null;
  }
  const it = set.order.find((x) => x.id === id);
  return it ? orderAsk(it, ans.order[id]) : null;
}

async function askNote(id) {
  const ask = noteAsk(id);
  if (!ask) return;
  note = { id, state: "busy", error: "" };
  render();
  try {
    const got = await explainGrammar(ask);
    state.notes = state.notes || {};
    state.notes[id] = got;
    save(state);
    note = { id: null, state: "idle", error: "" };
  } catch (e) {
    note = { id, state: "error", error: e.message };
  }
  render();
}

/** 긴 지문은 하루치 세트와 따로 돈다. 세트를 풀지 않아도 열린다. */
function startReading() {
  swapIn();
  const now = today();
  rd = buildReading(data, state, now, readingToday(state, dateKey(now)));
  if (!rd.exhausted) {
    rdView = buildReadingView(rd);
    rdAns = emptyReadingAnswers(rd);
  }
  route = "reading";
  render();
  window.scrollTo(0, 0);
}

function gradeReading() {
  const first = !(rd.id in (state.reading || {}));
  const got = rd.passage.questions.filter((q) => gradeReadingQuestion(q, rdAns[q.no])).length;
  if (first) markSeen(state, [rd.passage.id], rd.key);
  recordReading(state, rd.id, rd.key, got, rd.passage.questions.length);
  save(state);
  route = "reading-result";
  render();
  window.scrollTo(0, 0);
}

function header() {
  const now = today();
  const bits = [`${now.getMonth() + 1}月${now.getDate()}日 星期${WEEK[now.getDay()]}`];
  if (route === "reading" || route === "reading-result") {
    if (!rd.exhausted) {
      bits.push("阅读");
      if (rd.nth > 1) bits.push(`第${rd.nth}篇`);
      bits.push(`${rd.total}题`);
    }
    dayLine.textContent = bits.join(" · ");
    return;
  }
  if (!set.exhausted) {
    if (set.nth > 1) bits.push(`第${set.nth}套`);
    bits.push(`${set.total}题`);
    if (set.writing) bits.push("含写作");
  }
  dayLine.textContent = bits.join(" · ");
}

function render() {
  const y = window.scrollY;
  header();
  if (route === "record") {
    main.innerHTML = recordView();
  } else if (route === "reading") {
    main.innerHTML = rd.exhausted ? readingExhausted() : renderReading(rd, rdAns, rdView);
  } else if (route === "reading-result") {
    main.innerHTML = renderReadingResult(rd, rdAns, state.flags, rdView);
  } else if (set.exhausted) {
    main.innerHTML = exhaustedView();
  } else if (route === "result") {
    main.innerHTML = renderResult(set, ans, state.flags, view, data.wrules, writingMark(), noteView(), drill);
  } else if (set.weekend && !forceWeekday) {
    main.innerHTML = `<section class="block">
      <div class="block-head"><h2>주말</h2></div>
      <div class="row-btns">
        <button type="button" data-act="anyway">그래도 한 세트 풀기</button>
        <button type="button" data-act="record">기록 보기</button>
      </div>
    </section>`;
  } else {
    main.innerHTML = renderDrill(set, ans, view);
    const ta = document.getElementById("wtext");
    if (ta) {
      ta.addEventListener("input", () => {
        ans.writing.text = ta.value;
        keepOpenSoon();
        const n = countCjk(ta.value);
        const c = document.getElementById("wcount");
        c.textContent = `${n} / ${set.writing.minChars}字`;
        c.classList.toggle("enough", n >= set.writing.minChars);
      });
    }
  }
  window.scrollTo(0, Math.min(y, document.body.scrollHeight));
}

function grade() {
  // 같은 세트를 다시 풀면 점수는 덮어쓰되 어법 통계는 첫 번째 것만 센다.
  const first = !(set.id in state.sets);
  let got = 0;

  for (const q of set.sequence) {
    got += gradeSequence(q, ans.sequence[q.id]).filter(Boolean).length;
  }

  for (const it of set.order) {
    const ok = gradeOrder(it, ans.order[it.id]).ok;
    if (ok) got += 1;
    if (first) bumpStat(state, it.grammar, ok);
  }

  for (const p of set.cloze) {
    for (const b of p.blanks) {
      if (gradeCloze(b, ans.cloze[`${p.id}:${b.no}`])) got += 1;
    }
  }

  if (first) {
    markSeen(
      state,
      [
        ...set.sequence.map((q) => q.id),
        ...set.cloze.map((p) => p.id),
        set.writing && set.writing.id,
        ...set.order.map((it) => it.id),
      ],
      set.key
    );
  }
  recordSet(state, set.id, set.key, got, set.total);
  route = "result";
  keepOpen();
  render();
}

function leftCount() {
  const seen = state.seen;
  const n = (list) => list.filter((x) => !seen[x.id]).length;
  return {
    sequence: n(data.sequence.sets),
    order: n(data.order.items),
    cloze: n(data.cloze.passages),
  };
}

function exhaustedView() {
  return `<section class="block">
    <div class="block-head"><h2>남은 문항이 없습니다</h2></div>
    <div class="row-btns">
      <button type="button" data-act="record">기록 보기</button>
      <button type="button" data-act="reopen">본 문항 다시 열기</button>
    </div>
  </section>`;
}

function recordView() {
  const days = Object.entries(state.days).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  const recent = days.slice(0, 12);
  const rows = recent
    .map(
      ([k, v]) =>
        `<tr><td>${k.slice(5).replace("-", "월 ")}일</td><td>${v.got}</td><td>${v.total}</td><td>${Math.round(
          (v.got / v.total) * 100
        )}%</td></tr>`
    )
    .join("");

  const stats = Object.entries(state.stats)
    .map(([k, v]) => ({ k, ...v, n: v.ok + v.no, rate: v.ok / (v.ok + v.no) }))
    .sort((a, b) => a.rate - b.rate);
  const statRows = stats
    .map(
      (s) =>
        `<tr><td class="zh" lang="zh-CN">${esc(s.k)}</td><td>${s.ok}</td><td>${s.n}</td><td class="${
          s.rate < 0.6 ? "low" : ""
        }">${Math.round(s.rate * 100)}%</td></tr>`
    )
    .join("");

  const flagRows = state.flags.length
    ? `<ul class="rules">${state.flags
        .map((f) => `<li><code>${esc(f.id)}</code> ${new Date(f.at).toLocaleDateString("ko-KR")}</li>`)
        .join("")}</ul>
       <div class="row-btns"><button type="button" data-act="copy-flags">신고 목록 복사</button></div>`
    : `<p class="empty">신고한 문항이 없습니다.</p>`;

  const setCount = Object.keys(state.sets).length;
  const left = leftCount();
  const rt = readingTotals(state);
  const leftReading = data.reading.passages.filter((p) => !state.seen[p.id]).length;

  return `<section class="block">
    <div class="block-head"><h2>푼 날</h2><span class="counter">${days.length}일 · 세트 ${setCount}개</span></div>
    ${
      rows
        ? `<table class="stat-table"><thead><tr><th>날짜</th><th>맞음</th><th>문항</th><th>정답률</th></tr></thead><tbody>${rows}</tbody></table>`
        : `<p class="empty">아직 기록이 없습니다.</p>`
    }
    <p class="hint">남은 문항은 단락 ${left.sequence}세트, 어순 ${left.order}문항, 빈칸 ${left.cloze}지문입니다.</p>
  </section>
  <section class="block">
    <div class="block-head"><h2>긴 지문</h2><span class="counter">${rt.count}편</span></div>
    ${
      rt.count
        ? `<p class="hint">${rt.got} / ${rt.total}문항, 정답률 ${Math.round((rt.got / rt.total) * 100)}%. 남은 지문은 ${leftReading}편입니다.</p>`
        : `<p class="empty">아직 읽은 지문이 없습니다. 남은 지문은 ${leftReading}편입니다.</p>`
    }
    <div class="row-btns"><button type="button" data-act="open-reading">한 편 읽기</button></div>
  </section>
  <section class="block">
    <div class="block-head"><h2>받아 둔 작문 채점</h2><span class="counter">${
      Object.keys(state.graded || {}).length
    }편</span></div>
    ${keptGrades(data.writing.items, state.graded)}
  </section>
  <section class="block">
    <div class="block-head"><h2>어법별 정답률</h2><span class="counter">어순 문항만</span></div>
    ${
      statRows
        ? `<table class="stat-table"><thead><tr><th>어법</th><th>맞음</th><th>푼 수</th><th>정답률</th></tr></thead><tbody>${statRows}</tbody></table>`
        : `<p class="empty">어순 문항을 풀면 여기에 쌓입니다.</p>`
    }
  </section>
  <section class="block">
    <div class="block-head"><h2>이상하다고 표시한 문항</h2></div>
    ${flagRows}
  </section>
  <section class="block">
    <div class="block-head"><h2>기록 옮기기</h2></div>
    <div class="row-btns">
      <button type="button" data-act="export">내보내기</button>
      <button type="button" data-act="import">가져오기</button>
    </div>
    <button type="button" class="primary-btn" data-act="back">오늘 세트로 돌아가기</button>
  </section>`;
}

main.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;

  if (act === "seq-pick") {
    const k = btn.dataset.key;
    const mine = ans.sequence[btn.dataset.sid];
    if (mine.includes(k)) return;
    const i = mine.indexOf(null);
    if (i === -1) return;
    mine[i] = k;
  } else if (act === "seq-clear") {
    const sid = btn.dataset.sid;
    ans.sequence[sid][Number(btn.dataset.i)] = null;
    ans.sequence[sid] = ans.sequence[sid]
      .filter((x) => x !== null)
      .concat([null, null, null, null, null])
      .slice(0, 5);
  } else if (act === "ord-push") {
    const list = ans.order[btn.dataset.id];
    const ci = Number(btn.dataset.ci);
    if (!list.includes(ci)) list.push(ci);
  } else if (act === "ord-pull") {
    ans.order[btn.dataset.id].splice(Number(btn.dataset.pos), 1);
  } else if (act === "rd-pick") {
    rdAns[btn.dataset.no] = Number(btn.dataset.oi);
  } else if (act === "rd-grade") {
    if (!readingComplete(rd, rdAns)) return;
    gradeReading();
    return;
  } else if (act === "next-reading") {
    startReading();
    return;
  } else if (act === "clz") {
    ans.cloze[btn.dataset.key] = Number(btn.dataset.oi);
  } else if (act === "grade") {
    if (!isComplete(set, ans)) return;
    grade();
    return;
  } else if (act === "save-key") {
    const box = document.getElementById("apikey");
    if (!box || !box.value.trim()) return;
    setApiKey(box.value);
    askGrade();
    return;
  } else if (act === "drop-key") {
    setApiKey("");
    mark = { id: null, state: "idle" };
  } else if (act === "grade-writing") {
    askGrade();
    return;
  } else if (act === "explain") {
    askNote(btn.dataset.id);
    return;
  } else if (act === "drill-show") {
    drill.shown = true;
  } else if (act === "record") {
    route = "record";
  } else if (act === "reopen") {
    if (!confirm("이미 푼 문항이 다시 나옵니다. 계속할까요?")) return;
    state.seen = {};
    save(state);
    startDay();
    return;
  } else if (act === "next-set") {
    startDay();
    window.scrollTo(0, 0);
    return;
  } else if (act === "back") {
    route = set.id in state.sets ? "result" : "drill";
    window.scrollTo(0, 0);
  } else if (act === "anyway") {
    forceWeekday = true;
  } else if (act === "flag") {
    const id = btn.dataset.id;
    const i = state.flags.findIndex((f) => f.id === id);
    if (i === -1) state.flags.push({ id, at: Date.now() });
    else state.flags.splice(i, 1);
    save(state);
  } else if (act === "open-reading") {
    startReading();
    return;
  } else if (act === "copy-flags") {
    copy(JSON.stringify(state.flags.map((f) => f.id), null, 2), btn);
    return;
  } else if (act === "export") {
    copy(JSON.stringify(state), btn);
    return;
  } else if (act === "import") {
    const raw = prompt("내보낸 기록을 붙여 넣으세요");
    if (!raw) return;
    try {
      state = Object.assign(load(), JSON.parse(raw));
      save(state);
      startDay();
      return;
    } catch {
      alert("읽을 수 없는 내용입니다");
      return;
    }
  }
  keepOpen();
  render();
});

// 다시 쓰기 칸은 글자마다 다시 그리지 않는다. 적어만 두고 다음 그림에 끼워 넣는다.
main.addEventListener("input", (e) => {
  const box = e.target.closest("[data-drill]");
  if (!box) return;
  drill.text[box.dataset.drill] = box.value;
  keepOpenSoon();
});

function copy(text, btn) {
  const done = () => {
    const old = btn.textContent;
    btn.textContent = "복사했습니다";
    setTimeout(() => (btn.textContent = old), 1400);
  };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt("복사하세요", text));
  else prompt("복사하세요", text);
}

document.getElementById("navReading").addEventListener("click", () => {
  if (route === "reading" || route === "reading-result") {
    route = set.id in state.sets ? "result" : "drill";
    render();
    window.scrollTo(0, 0);
    return;
  }
  startReading();
});

document.getElementById("navRecord").addEventListener("click", () => {
  route = route === "record" ? (set.id in state.sets ? "result" : "drill") : "record";
  render();
});

boot();
