// Review: what happened over the last 12/24 hours, computed from recorder
// history. Everything here is pure - the card fetches the history
// (src/history.ts) and the view only renders the result.

/** One history sample: time in ms, value (NaN when unknown/unavailable). */
export interface Point {
  t: number;
  v: number;
}

/** A step series: each value holds until the next point. */
export type Series = Point[];

const HOUR = 3_600_000;
const MINUTE = 60_000;

/** Value at time t (the last point at or before t), NaN if there is none. */
export const valueAt = (s: Series, t: number): number => {
  let lo = 0;
  let hi = s.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (s[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found < 0 ? NaN : s[found].v;
};

export const mapSeries = (s: Series, fn: (v: number) => number): Series => s.map((p) => ({ t: p.t, v: fn(p.v) }));

/** Combines step series point by point, at the union of their breakpoints. */
export const combine = (series: Series[], fn: (values: number[]) => number): Series => {
  const times = [...new Set(series.flatMap((s) => s.map((p) => p.t)))].sort((a, b) => a - b);
  const idx = series.map(() => -1);
  return times.map((t) => {
    series.forEach((s, k) => {
      while (idx[k] + 1 < s.length && s[idx[k] + 1].t <= t) idx[k]++;
    });
    return { t, v: fn(series.map((s, k) => (idx[k] >= 0 ? s[idx[k]].v : NaN))) };
  });
};

/** Sum of several series; unknown parts count as 0 unless all are unknown. */
export const sumSeries = (series: Series[]): Series =>
  series.length === 1
    ? series[0]
    : combine(series, (vs) => (vs.some(Number.isFinite) ? vs.reduce((a, v) => a + (Number.isFinite(v) ? v : 0), 0) : NaN));

/** Segments of the series clipped to [start, end]: [from, to, value]. */
const segments = (s: Series, start: number, end: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let i = 0; i < s.length; i++) {
    const a = Math.max(s[i].t, start);
    const b = Math.min(i + 1 < s.length ? s[i + 1].t : end, end);
    if (b > a) out.push([a, b, s[i].v]);
  }
  return out;
};

/** Integral over [start, end] in value-hours (W -> Wh). Unknown segments count as 0. */
export const integrate = (s: Series, start: number, end: number): number =>
  segments(s, start, end).reduce((sum, [a, b, v]) => (Number.isFinite(v) ? sum + (v * (b - a)) / HOUR : sum), 0);

/** Time-weighted average over the known part of [start, end]; NaN if nothing is known. */
export const average = (s: Series, start: number, end: number): number => {
  let sum = 0;
  let ms = 0;
  for (const [a, b, v] of segments(s, start, end)) {
    if (!Number.isFinite(v)) continue;
    sum += v * (b - a);
    ms += b - a;
  }
  return ms ? sum / ms : NaN;
};

/** Lowest or highest value in [start, end] and when it occurred. */
export const extreme = (s: Series, start: number, end: number, pick: "min" | "max"): { v: number; t: number } | null => {
  let best: { v: number; t: number } | null = null;
  for (const [a, , v] of segments(s, start, end)) {
    if (!Number.isFinite(v)) continue;
    if (!best || (pick === "min" ? v < best.v : v > best.v)) best = { v, t: a };
  }
  return best;
};

export interface Run {
  start: number;
  end: number;
}

/**
 * Periods where the series is at or above the threshold. Runs closer than
 * gapMs are merged; runs shorter than minMs are dropped.
 */
export const findRuns = (s: Series, threshold: number, start: number, end: number, minMs: number, gapMs: number): Run[] => {
  const merged: Run[] = [];
  for (const [a, b, v] of segments(s, start, end)) {
    if (!(v >= threshold)) continue;
    const last = merged[merged.length - 1];
    if (last && a - last.end < gapMs) last.end = b;
    else merged.push({ start: a, end: b });
  }
  return merged.filter((r) => r.end - r.start >= minMs);
};

export interface PriceHour {
  start: number;
  mean: number;
}

/** Time-weighted mean price per clock hour that overlaps [start, end]. */
export const hourlyPrices = (price: Series, start: number, end: number): PriceHour[] => {
  const out: PriceHour[] = [];
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  for (let h = first.getTime(); h < end; h += HOUR) {
    out.push({ start: h, mean: average(price, Math.max(h, start), Math.min(h + HOUR, end)) });
  }
  return out;
};

/** Lowest average price over any window of the given length inside [start, end] (15-min steps). */
export const cheapestWindow = (price: Series, durationMs: number, start: number, end: number): number | null => {
  const dur = Math.max(durationMs, 15 * MINUTE);
  let best: number | null = null;
  for (let t = start; t + dur <= end; t += 15 * MINUTE) {
    const avg = average(price, t, t + dur);
    if (Number.isFinite(avg) && (best === null || avg < best)) best = avg;
  }
  return best;
};

export type Verdict = "good" | "ok" | "bad" | "neutral";

/** Paid price against the cheapest window of the same length. Works for negative prices too. */
export const priceVerdict = (paid: number, cheapest: number | null): Verdict => {
  if (cheapest === null || !Number.isFinite(paid)) return "neutral";
  const diff = paid - cheapest;
  if (diff <= 0.05 || (cheapest > 0 && paid <= cheapest * 1.1)) return "good";
  if (diff >= 0.2 && (cheapest <= 0 || paid >= cheapest * 1.5)) return "bad";
  return "ok";
};

// ---------------------------------------------------------------------------

export interface ReviewBattery {
  name: string;
  /** Battery power in W, positive = charging. */
  power?: Series;
  soc?: Series;
  /** The battery whose lowest level is shown (the main battery). */
  primary?: boolean;
}

export interface ReviewLoad {
  name: string;
  color: string;
  icon?: string;
  /** Power in W. */
  power: Series;
  /** At or above this power the load counts as running (W). */
  threshold: number;
  /** A vehicle's battery level (%). */
  soc?: Series;
  /** A vehicle's charging session cost so far (restarts with each session). */
  sessionCost?: Series;
}

export interface ReviewInput {
  start: number;
  end: number;
  /** Grid power in W, positive = import. */
  grid?: Series;
  price?: Series;
  /** Solar power in W. */
  solar?: Series;
  batteries: ReviewBattery[];
  loads: ReviewLoad[];
  /** Phase currents in A. */
  phases: Series[];
}

export interface ReviewEvent {
  kind: "battery" | "load" | "solar" | "export";
  name: string;
  color?: string;
  icon?: string;
  start: number;
  end: number;
  kwh: number;
  /** Energy of this event that came from (or, for export, went to) the grid. */
  gridKwh: number;
  /** Average price of the grid energy. */
  avgPrice: number | null;
  /** Cheapest window of the same length in the period. */
  cheapest: number | null;
  verdict: Verdict;
  socFrom?: number;
  socTo?: number;
  /** What a vehicle's charge cost, from its session cost entity. */
  cost?: number;
  /** A vehicle's power (W) and battery level around the event, for its chart. */
  vehicle?: { power: Series; soc?: Series };
  /** Several short runs summarised in one event. */
  runs?: number;
  peakW?: number;
  peakAt?: number;
}

export interface Review {
  start: number;
  end: number;
  bought: { kwh: number; cost: number | null } | null;
  sold: { kwh: number; revenue: number | null } | null;
  avgBuyPrice: number | null;
  /** Time-weighted average price over the period. */
  avgPrice: number | null;
  solarKwh: number | null;
  lowestSoc: { name: string; v: number; t: number } | null;
  peakImportW: number | null;
  /** Highest 5-minute average on any phase (A). */
  maxPhaseA: number | null;
  prices: PriceHour[];
  /** Chart buckets (5 min): average import in W and primary battery SOC. */
  importBuckets: number[];
  socBuckets: number[];
  bucketMs: number;
  /** Runs to mark on the chart. */
  marks: { start: number; end: number; color: string; name: string }[];
  events: ReviewEvent[];
}

const BATTERY_RUN_W = 500;
const BATTERY_MIN_MS = 10 * MINUTE;
const LOAD_MIN_MS = 2 * MINUTE;
const MERGE_GAP_MS = 10 * MINUTE;
/** A run with at least this much energy gets its own event; smaller runs are summarised. */
const EVENT_KWH = 1;
const SUMMARY_KWH = 0.2;
const EXPORT_EVENT_KWH = 0.5;
/** Less grid energy than this share of an event = mostly solar/battery, no price verdict. */
const GRID_SHARE_MIN = 0.3;
const SOLAR_ON_W = 50;
const EXPORT_RUN_W = 500;

/** The session cost counter updates about once a minute, so read it a little after the run. */
const SESSION_COST_LAG_MS = 5 * MINUTE;
/** A vehicle's battery level can lag this much behind the charge. */
const VEHICLE_SOC_LAG_MS = 30 * MINUTE;

const BATTERY_COLOR = "#4FC1B0";
const SOLAR_COLOR = "#F5B942";
const EXPORT_COLOR = "#7FC97F";

/**
 * What a charge cost from a session cost counter: its value shortly after the
 * run minus its value at the start, or the whole value when the counter
 * restarted (a new session) during the run.
 */
export const sessionCostOf = (s: Series, from: number, to: number, end: number): number | undefined => {
  const after = valueAt(s, Math.min(to + SESSION_COST_LAG_MS, end));
  if (!Number.isFinite(after)) return undefined;
  const before = valueAt(s, from);
  return Number.isFinite(before) && before <= after ? after - before : after;
};

export const computeReview = (input: ReviewInput): Review => {
  const { start, end, grid, price, solar } = input;
  const bucketMs = 5 * MINUTE;
  const buckets = Math.ceil((end - start) / bucketMs);
  const imp = grid ? mapSeries(grid, (v) => (Number.isFinite(v) ? Math.max(v, 0) : v)) : undefined;
  const exp = grid ? mapSeries(grid, (v) => (Number.isFinite(v) ? Math.max(-v, 0) : v)) : undefined;
  const costOf = (power: Series | undefined, a: number, b: number): number | null =>
    power && price ? integrate(combine([power, price], ([w, p]) => (w * p) / 1000), a, b) : null;

  const boughtKwh = imp ? integrate(imp, start, end) / 1000 : null;
  const soldKwh = exp ? integrate(exp, start, end) / 1000 : null;
  const cost = costOf(imp, start, end);
  const revenue = costOf(exp, start, end);
  const avgPrice = price ? average(price, start, end) : NaN;

  const primary = input.batteries.find((b) => b.primary && b.soc) ?? input.batteries.find((b) => b.soc);
  const low = primary?.soc ? extreme(primary.soc, start, end, "min") : null;


  /** Price verdict for something that drew `power` from the home over a run. */
  const priced = (power: Series, run: Run): Pick<ReviewEvent, "kwh" | "gridKwh" | "avgPrice" | "cheapest" | "verdict"> => {
    const kwh = integrate(power, run.start, run.end) / 1000;
    if (!imp || !price) return { kwh, gridKwh: 0, avgPrice: null, cheapest: null, verdict: "neutral" };
    const fromGrid = combine([power, imp], ([p, g]) => Math.max(Math.min(p, g), 0));
    const gridKwh = integrate(fromGrid, run.start, run.end) / 1000;
    if (gridKwh < 0.05 || gridKwh < kwh * GRID_SHARE_MIN) return { kwh, gridKwh, avgPrice: null, cheapest: null, verdict: "neutral" };
    const avg = (costOf(fromGrid, run.start, run.end) ?? 0) / gridKwh;
    const cheapest = cheapestWindow(price, run.end - run.start, start, end);
    return { kwh, gridKwh, avgPrice: avg, cheapest, verdict: priceVerdict(avg, cheapest) };
  };

  const events: ReviewEvent[] = [];
  const marks: Review["marks"] = [];

  /**
   * One event per run with at least EVENT_KWH; the smaller runs of the same
   * battery or load are summarised in one event (solar top-ups of a UPS,
   * a pump cycling).
   */
  const addRuns = (
    base: Pick<ReviewEvent, "kind" | "name" | "color" | "icon">,
    power: Series,
    runs: Run[],
    soc?: Series,
  ) => {
    const small: (ReturnType<typeof priced> & Run)[] = [];
    for (const run of runs) {
      const p = priced(power, run);
      marks.push({ ...run, color: base.color ?? BATTERY_COLOR, name: base.name });
      if (p.kwh >= EVENT_KWH) {
        events.push({
          ...base,
          ...run,
          ...p,
          socFrom: soc ? valueAt(soc, run.start) : undefined,
          socTo: soc ? valueAt(soc, run.end) : undefined,
        });
      } else {
        small.push({ ...run, ...p });
      }
    }
    const kwh = small.reduce((sum, r) => sum + r.kwh, 0);
    if (!small.length || kwh < SUMMARY_KWH) return;
    const gridKwh = small.reduce((sum, r) => sum + r.gridKwh, 0);
    const paid = small.reduce((sum, r) => sum + (r.avgPrice ?? 0) * r.gridKwh, 0);
    events.push({
      ...base,
      start: small[0].start,
      end: small[small.length - 1].end,
      kwh,
      gridKwh,
      avgPrice: gridKwh > 0 && gridKwh >= kwh * GRID_SHARE_MIN ? paid / gridKwh : null,
      cheapest: null,
      verdict: "neutral",
      runs: small.length,
    });
  };

  for (const b of input.batteries) {
    if (!b.power) continue;
    const charge = mapSeries(b.power, (v) => (Number.isFinite(v) ? Math.max(v, 0) : v));
    const runs = findRuns(charge, BATTERY_RUN_W, start, end, BATTERY_MIN_MS, MERGE_GAP_MS);
    addRuns({ kind: "battery", name: b.name, color: BATTERY_COLOR }, charge, runs, b.soc);
  }

  for (const load of input.loads) {
    const runs = findRuns(load.power, load.threshold, start, end, LOAD_MIN_MS, MERGE_GAP_MS);
    const first = events.length;
    addRuns({ kind: "load", name: load.name, color: load.color, icon: load.icon }, load.power, runs, load.soc);
    if (!load.soc) continue;
    for (const e of events.slice(first)) {
      if (e.runs) continue;
      e.vehicle = { power: load.power, soc: load.soc };
      // A car reports its level late (cloud polling, minutes apart): the level it
      // arrived with can come after the charge started, the final one after it ended.
      e.socFrom = extreme(load.soc, e.start, Math.min(e.start + VEHICLE_SOC_LAG_MS, end), "min")?.v ?? e.socFrom;
      e.socTo = extreme(load.soc, e.end, Math.min(e.end + VEHICLE_SOC_LAG_MS, end), "max")?.v ?? e.socTo;
      if (load.sessionCost) e.cost = sessionCostOf(load.sessionCost, e.start, e.end, end);
    }
  }

  let solarKwh: number | null = null;
  if (solar) {
    solarKwh = integrate(solar, start, end) / 1000;
    const on = findRuns(solar, SOLAR_ON_W, start, end, 0, 2 * HOUR);
    const peak = extreme(solar, start, end, "max");
    if (on.length && solarKwh >= 0.1) {
      events.push({
        kind: "solar",
        name: "",
        color: SOLAR_COLOR,
        start: on[0].start,
        end: on[on.length - 1].end,
        kwh: solarKwh,
        gridKwh: 0,
        avgPrice: null,
        cheapest: null,
        verdict: "neutral",
        peakW: peak?.v,
        peakAt: peak?.t,
      });
    }
  }

  if (exp && price) {
    for (const run of findRuns(exp, EXPORT_RUN_W, start, end, BATTERY_MIN_MS, MERGE_GAP_MS)) {
      const kwh = integrate(exp, run.start, run.end) / 1000;
      if (kwh < EXPORT_EVENT_KWH) continue;
      const avg = kwh > 0 ? (costOf(exp, run.start, run.end) ?? 0) / kwh : NaN;
      // Selling: good when well above the period's average price.
      const verdict: Verdict = !Number.isFinite(avg) || !Number.isFinite(avgPrice)
        ? "neutral"
        : avg >= avgPrice * 1.1 ? "good" : avg <= avgPrice * 0.8 ? "bad" : "ok";
      events.push({
        kind: "export",
        name: "",
        color: EXPORT_COLOR,
        start: run.start,
        end: run.end,
        kwh,
        gridKwh: kwh,
        avgPrice: Number.isFinite(avg) ? avg : null,
        cheapest: null,
        verdict,
      });
      marks.push({ ...run, color: EXPORT_COLOR, name: "export" });
    }
  }

  events.sort((a, b) => b.start - a.start);

  const bucketAvg = (s: Series | undefined) =>
    Array.from({ length: buckets }, (_, i) =>
      s ? average(s, start + i * bucketMs, Math.min(start + (i + 1) * bucketMs, end)) : NaN,
    );

  // Highest phase as a 5-minute average: a main fuse tolerates brief peaks.
  const phaseAvg = input.phases.flatMap((p) => bucketAvg(p).filter(Number.isFinite));

  return {
    start,
    end,
    bought: boughtKwh !== null ? { kwh: boughtKwh, cost } : null,
    sold: soldKwh !== null ? { kwh: soldKwh, revenue } : null,
    avgBuyPrice: boughtKwh && cost !== null && boughtKwh > 0.05 ? cost / boughtKwh : null,
    avgPrice: Number.isFinite(avgPrice) ? avgPrice : null,
    solarKwh,
    lowestSoc: low && primary ? { name: primary.name, ...low } : null,
    peakImportW: imp ? extreme(imp, start, end, "max")?.v ?? null : null,
    maxPhaseA: phaseAvg.length ? Math.max(...phaseAvg) : null,
    prices: price ? hourlyPrices(price, start, end) : [],
    importBuckets: bucketAvg(imp),
    socBuckets: bucketAvg(primary?.soc),
    bucketMs,
    marks,
    events,
  };
};
