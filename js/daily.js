import { dateKey, weakTags } from "./store.js";

export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 같은 씨앗이면 늘 같은 순서. 한 세트 안에서는 화면이 흔들리지 않는다. */
export function shuffled(list, seed) {
  const rnd = mulberry32(seed);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function isWeekend(d = new Date()) {
  const w = d.getDay();
  return w === 0 || w === 6;
}

export function isFriday(d = new Date()) {
  return d.getDay() === 5;
}

// 문항을 꺼내는 순서. 씨앗이 고정이라 누가 언제 열어도 같은 순서로 나온다.
const SEED = { sequence: 1101, order: 2202, cloze: 3303, writing: 4404 };

function pools(data) {
  return {
    sequence: shuffled(data.sequence.sets.map((s) => s.id), SEED.sequence),
    order: shuffled(data.order.items.map((s) => s.id), SEED.order),
    cloze: shuffled(data.cloze.passages.map((s) => s.id), SEED.cloze),
    writing: shuffled(data.writing.items.map((s) => s.id), SEED.writing),
  };
}

const byId = (list, id) => list.find((x) => x.id === id);

/**
 * 하루치 한 세트를 조립한다. n 은 그날 몇 번째 세트인지(0부터).
 *
 * 아직 안 낸 문항만 쓴다. 같은 문항은 두 번 나오지 않는다.
 * 어순은 정답률이 낮은 어법이 붙은 문항을 앞으로 당겨서, 약한 자리를 같은 문장이 아니라
 * 다른 문장으로 다시 만나게 한다.
 */
export function buildDay(data, state, now = new Date(), n = 0) {
  const key = dateKey(now);
  const seen = state.seen || {};
  const free = pools(data);
  const left = {
    sequence: free.sequence.filter((id) => !seen[id]),
    cloze: free.cloze.filter((id) => !seen[id]),
    writing: free.writing.filter((id) => !seen[id]),
  };

  let ord = free.order.filter((id) => !seen[id]);
  const weak = weakTags(state);
  if (weak.size) {
    const items = new Map(data.order.items.map((it) => [it.id, it]));
    const hit = (id) => (items.get(id).grammar || []).some((t) => weak.has(t));
    ord = [...ord.filter(hit), ...ord.filter((id) => !hit(id))];
  }

  const set = {
    key,
    id: `${key}#${n + 1}`,
    nth: n + 1,
    weekend: isWeekend(now),
    sequence: byId(data.sequence.sets, left.sequence[0]),
    order: ord.slice(0, 3).map((id) => byId(data.order.items, id)),
    cloze: byId(data.cloze.passages, left.cloze[0]),
    writing: null,
    left: { sequence: left.sequence.length, order: ord.length, cloze: left.cloze.length },
  };

  set.exhausted = !set.sequence || !set.cloze || set.order.length < 3;
  if (set.exhausted) return set;

  // 쓰기는 금요일 첫 세트에만. 하루에 두 편을 쓰게 하지는 않는다.
  if (isFriday(now) && n === 0 && left.writing.length) {
    set.writing = byId(data.writing.items, left.writing[0]);
  }

  set.total = 5 + set.order.length + set.cloze.blanks.length;
  return set;
}

/**
 * 예전 기록에는 어떤 문항을 봤는지가 없다. 그때 쓰던 규칙을 되돌려서 채운다.
 *
 * 예전에는 EPOCH(2026-11-09 월요일)부터 센 평일 번호로 문항을 골랐다.
 * 기록이 남은 날마다 그 규칙을 다시 돌려서 그날 나왔을 문항을 본 것으로 표시한다.
 */
export function seedSeen(data, state) {
  const EPOCH = new Date(2026, 10, 9);
  const p = pools(data);
  const wdOf = (k) => {
    const [y, m, d] = k.split("-").map(Number);
    const days = Math.round((new Date(y, m - 1, d) - EPOCH) / 86400000);
    if (days < 0) return 0;
    return Math.floor(days / 7) * 5 + Math.min(days % 7, 4);
  };
  const out = {};
  for (const k of Object.keys(state.days || {})) {
    const wd = wdOf(k);
    out[p.sequence[wd % p.sequence.length]] = k;
    out[p.cloze[wd % p.cloze.length]] = k;
    for (let i = 0; i < 3; i++) out[p.order[(wd * 3 + i) % p.order.length]] = k;
  }
  return out;
}
