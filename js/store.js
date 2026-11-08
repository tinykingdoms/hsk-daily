// 기록은 이 기기에만 쌓인다. PC와 폰이 따로 쌓이는 건 의도된 것이다.
const KEY = "hsk-daily-v1";

const blank = () => ({ days: {}, review: {}, stats: {}, flags: [] });

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    return Object.assign(blank(), JSON.parse(raw));
  } catch {
    return blank();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* 비공개 창이나 저장이 막힌 환경에서는 그냥 기억하지 않는다 */
  }
}

/** 틀린 문항을 3일 뒤, 또 틀리면 7일 뒤로 넘긴다. */
export function schedule(state, id, type, wrong, todayKey) {
  const cur = state.review[id];
  if (!wrong) {
    if (cur) delete state.review[id];
    return;
  }
  const stage = cur ? Math.min(cur.stage + 1, 2) : 1;
  const days = stage === 1 ? 3 : 7;
  state.review[id] = { type, stage, due: addDays(todayKey, days) };
}

export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dateKey(dt);
}

export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function bumpStat(state, tags, ok) {
  for (const t of tags || []) {
    const s = (state.stats[t] = state.stats[t] || { ok: 0, no: 0 });
    if (ok) s.ok += 1;
    else s.no += 1;
  }
}

export function dueItems(state, todayKey, type) {
  return Object.entries(state.review)
    .filter(([, v]) => v.type === type && v.due <= todayKey)
    .map(([id]) => id);
}
