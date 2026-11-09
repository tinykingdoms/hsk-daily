// 기록은 이 기기에만 쌓인다. PC와 폰이 따로 쌓이는 건 의도된 것이다.
const KEY = "hsk-daily-v1";

const blank = () => ({ days: {}, sets: {}, seen: {}, stats: {}, flags: [] });

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

/**
 * 한 번 낸 문항은 다시 내지 않는다.
 *
 * 해설을 읽은 문항을 며칠 뒤에 또 푸는 것은 실력이 아니라 기억을 묻는 일이다.
 * 어순 문항이 특히 그렇다. 토막을 어떻게 놓는지 이미 봤으면 다시 생각할 거리가 없다.
 * 대신 틀린 어법이 붙은 다른 문항을 앞으로 당긴다. weakTags 를 보라.
 */
export function markSeen(state, ids, key) {
  for (const id of ids) {
    if (id && !state.seen[id]) state.seen[id] = key;
  }
}

/**
 * 결과는 세트마다 따로 적고 날짜별 합계는 거기서 다시 센다.
 * 같은 세트를 다시 풀어도 그 세트 자리만 덮어써서, 한 번 푼 것이 두 번 세어지지 않는다.
 */
export function recordSet(state, setId, dayKey, got, total) {
  state.sets[setId] = { got, total, at: Date.now() };
  const mine = Object.entries(state.sets).filter(([id]) => id.startsWith(dayKey + "#"));
  state.days[dayKey] = {
    got: mine.reduce((s, [, v]) => s + v.got, 0),
    total: mine.reduce((s, [, v]) => s + v.total, 0),
    sets: mine.length,
    at: Date.now(),
  };
}

/** 오늘 이미 끝낸 세트 수. 다음 세트가 몇 번째인지 여기서 정한다. */
export function setsToday(state, dayKey) {
  return Object.keys(state.sets).filter((id) => id.startsWith(dayKey + "#")).length;
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

/**
 * 약한 어법. 두 번 이상 풀었는데 정답률이 60%를 밑도는 것만 본다.
 * 한 번 틀린 것으로 약하다고 단정하지 않는다.
 */
export function weakTags(state) {
  return new Set(
    Object.entries(state.stats)
      .filter(([, v]) => v.ok + v.no >= 2 && v.ok / (v.ok + v.no) < 0.6)
      .map(([k]) => k)
  );
}
