import { load, save, bumpStat, dateKey, markSeen, recordSet, setsToday } from "./store.js";
import { buildDay, seedSeen } from "./daily.js";
import { renderDrill, buildView, emptyAnswers, isComplete, countCjk, esc } from "./drill.js";
import { renderResult, gradeOrder, gradeSequence, gradeCloze } from "./explain.js";

const main = document.getElementById("main");
const dayLine = document.getElementById("dayLine");

let data, state, set, view, ans;
let route = "drill";
let forceWeekday = false;

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

async function boot() {
  try {
    const [sequence, order, cloze, writing] = await Promise.all(
      ["sequence", "order", "cloze", "writing"].map((n) =>
        fetch(`data/${n}.json`, { cache: "no-cache" }).then((r) => {
          if (!r.ok) throw new Error(`${n}.json ${r.status}`);
          return r.json();
        })
      )
    );
    data = { sequence, order, cloze, writing };
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
  startDay();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

/** ?d=2026-11-13 을 붙이면 그 날짜의 세트를 볼 수 있다. 금요일 쓰기 확인용. */
function today() {
  const q = new URLSearchParams(location.search).get("d");
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) {
    const [y, m, d] = q.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date();
}

function startDay() {
  const now = today();
  set = buildDay(data, state, now, setsToday(state, dateKey(now)));
  if (!set.exhausted) {
    view = buildView(set);
    ans = emptyAnswers(set);
  }
  route = "drill";
  render();
}

function header() {
  const now = today();
  const bits = [`${now.getMonth() + 1}월 ${now.getDate()}일 ${WEEK[now.getDay()]}요일`];
  if (!set.exhausted) {
    if (set.nth > 1) bits.push(`${set.nth}번째 세트`);
    bits.push(`${set.total}문항`);
    if (set.writing) bits.push("쓰기 포함");
  }
  dayLine.textContent = bits.join(" · ");
}

function render() {
  const y = window.scrollY;
  header();
  if (route === "record") {
    main.innerHTML = recordView();
  } else if (set.exhausted) {
    main.innerHTML = exhaustedView();
  } else if (route === "result") {
    main.innerHTML = renderResult(set, ans, state.flags);
  } else if (set.weekend && !forceWeekday) {
    main.innerHTML = `<section class="block">
      <div class="block-head"><h2>주말</h2></div>
      <p class="hint">주말은 모의고사 날입니다. 이 앱은 평일에 감을 잡아 두는 쪽이라 오늘은 쉬어도 됩니다.</p>
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
        const n = countCjk(ta.value);
        const c = document.getElementById("wcount");
        c.textContent = `${n}자 / ${set.writing.minChars}자`;
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

  got += gradeSequence(set.sequence, ans.sequence).filter(Boolean).length;

  for (const it of set.order) {
    const ok = gradeOrder(it, ans.order[it.id]).ok;
    if (ok) got += 1;
    if (first) bumpStat(state, it.grammar, ok);
  }

  for (const b of set.cloze.blanks) {
    if (gradeCloze(b, ans.cloze[b.no])) got += 1;
  }

  if (first) {
    markSeen(
      state,
      [set.sequence.id, set.cloze.id, set.writing && set.writing.id, ...set.order.map((it) => it.id)],
      set.key
    );
  }
  recordSet(state, set.id, set.key, got, set.total);
  save(state);
  route = "result";
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
    <p class="hint">준비된 문항을 전부 풀었습니다. 새로 낼 것이 없습니다.</p>
    <div class="note-box"><p>본 문항을 다시 열 수는 있습니다. 다만 해설을 읽은 문항이라 답이 기억날 겁니다. 새 문항을 넣는 쪽이 낫습니다.</p></div>
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
    <div class="note-box"><p>기록은 이 기기의 브라우저에만 쌓입니다. PC와 폰은 따로 쌓입니다. 한 번 나온 문항은 다시 나오지 않으니, 기기를 옮길 때는 내보내기로 가져가세요.</p></div>
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
    if (ans.sequence.includes(k)) return;
    const i = ans.sequence.indexOf(null);
    if (i === -1) return;
    ans.sequence[i] = k;
  } else if (act === "seq-clear") {
    ans.sequence[Number(btn.dataset.i)] = null;
    ans.sequence = ans.sequence.filter((x) => x !== null).concat([null, null, null, null, null]).slice(0, 5);
  } else if (act === "ord-push") {
    const list = ans.order[btn.dataset.id];
    const ci = Number(btn.dataset.ci);
    if (!list.includes(ci)) list.push(ci);
  } else if (act === "ord-pull") {
    ans.order[btn.dataset.id].splice(Number(btn.dataset.pos), 1);
  } else if (act === "clz") {
    ans.cloze[btn.dataset.no] = Number(btn.dataset.oi);
  } else if (act === "grade") {
    if (!isComplete(set, ans)) return;
    grade();
    return;
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
  } else if (act === "anyway") {
    forceWeekday = true;
  } else if (act === "flag") {
    const id = btn.dataset.id;
    const i = state.flags.findIndex((f) => f.id === id);
    if (i === -1) state.flags.push({ id, at: Date.now() });
    else state.flags.splice(i, 1);
    save(state);
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
  render();
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

document.getElementById("navRecord").addEventListener("click", () => {
  route = route === "record" ? (set.id in state.sets ? "result" : "drill") : "record";
  render();
});

boot();
