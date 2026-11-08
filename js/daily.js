import { dateKey, dueItems } from "./store.js";

// 평일 번호를 세는 기준일. 2026-11-09 월요일.
const EPOCH = new Date(2026, 10, 9);

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

/** 같은 씨앗이면 늘 같은 순서. 하루 안에서는 화면이 흔들리지 않는다. */
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

/** EPOCH 부터 센 평일 번호. 주말은 바로 앞 금요일과 같은 번호를 쓴다. */
export function weekdayIndex(d = new Date()) {
  const a = new Date(EPOCH.getFullYear(), EPOCH.getMonth(), EPOCH.getDate());
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const n = Math.round((b - a) / 86400000);
  if (n < 0) return 0;
  return Math.floor(n / 7) * 5 + Math.min(n % 7, 4);
}

export function isFriday(d = new Date()) {
  return d.getDay() === 5;
}

const take = (perm, start, count) =>
  Array.from({ length: count }, (_, i) => perm[(start + i) % perm.length]);

/**
 * 하루치를 조립한다. 복습할 문항이 있으면 그날의 새 문항을 같은 유형으로 바꿔 넣어서
 * 분량이 늘어나지 않게 한다.
 */
export function buildDay(data, state, now = new Date()) {
  const key = dateKey(now);
  const wd = weekdayIndex(now);

  const seqPerm = shuffled(data.sequence.sets.map((s) => s.id), 1101);
  const ordPerm = shuffled(data.order.items.map((s) => s.id), 2202);
  const clzPerm = shuffled(data.cloze.passages.map((s) => s.id), 3303);
  const wrtPerm = shuffled(data.writing.items.map((s) => s.id), 4404);

  let seqId = seqPerm[wd % seqPerm.length];
  let ordIds = take(ordPerm, wd * 3, 3);
  let clzId = clzPerm[wd % clzPerm.length];

  const dueSeq = dueItems(state, key, "sequence");
  const dueOrd = dueItems(state, key, "order");
  const dueClz = dueItems(state, key, "cloze");
  const review = [];

  if (dueSeq.length) {
    seqId = dueSeq[0];
    review.push(seqId);
  }
  for (let i = 0; i < Math.min(2, dueOrd.length); i++) {
    if (ordIds.includes(dueOrd[i])) continue;
    ordIds[i] = dueOrd[i];
    review.push(dueOrd[i]);
  }
  if (dueClz.length) {
    clzId = dueClz[0];
    review.push(clzId);
  }

  const byId = (list, id) => list.find((x) => x.id === id);
  const set = {
    key,
    weekdayIndex: wd,
    weekend: isWeekend(now),
    review,
    sequence: byId(data.sequence.sets, seqId),
    order: ordIds.map((id) => byId(data.order.items, id)).filter(Boolean),
    cloze: byId(data.cloze.passages, clzId),
    writing: null,
  };

  if (isFriday(now)) {
    const fi = Math.floor(wd / 5);
    set.writing = byId(data.writing.items, wrtPerm[fi % wrtPerm.length]);
  }
  set.total = 5 + set.order.length + set.cloze.blanks.length;
  return set;
}
