// What opens when a node is tapped on a display that draws its own interface
// (display/esphome): the last 24 h of solar, grid, home or one battery as
// even buckets, with the figures that belong to it. Built from the same
// history and series as Review.
import { readLoadCast } from "./forecast";
import { formatEnergy, formatPercent, formatPower, readNumber } from "./hass";
import { buildReviewInput, powerSeries, reviewEntities, type LoadCastIssue } from "./history";
import { COLORS } from "./model";
import { average, extreme, integrate, valueAt, type Series } from "./review";
import { t } from "./strings";
import type { CardConfig, HomeAssistant } from "./types";

export const DETAIL_HOURS = 24;
const BUCKETS = 96;

/** Every entity the node details need (Review's, plus home). */
export const detailEntities = (config: CardConfig): string[] =>
  [...new Set([...reviewEntities(config), config.home.entity])];

const rgb = (hex: string): number => parseInt(hex.replace("#", "").slice(0, 6), 16);

const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const buckets = (s: Series | undefined, start: number, step: number): number[] =>
  Array.from({ length: BUCKETS }, (_, i) => {
    const v = s ? average(s, start + i * step, start + (i + 1) * step) : NaN;
    return Number.isFinite(v) ? Math.round(v) : 0;
  });

const ticks = (start: number, end: number) => {
  const out: { x: number; label: string }[] = [];
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  for (let ms = first.getTime() + 3_600_000; ms < end; ms += 3_600_000) {
    if (new Date(ms).getHours() % 3 === 0) out.push({ x: (ms - start) / (end - start), label: String(new Date(ms).getHours()).padStart(2, "0") });
  }
  return out;
};

/** kWh above (in) and below (out) zero over [start, end]. */
const split = (s: Series | undefined, start: number, end: number) => {
  if (!s) return { in: 0, out: 0 };
  const pos = s.map((p) => ({ t: p.t, v: Number.isFinite(p.v) ? Math.max(p.v, 0) : p.v }));
  const neg = s.map((p) => ({ t: p.t, v: Number.isFinite(p.v) ? Math.max(-p.v, 0) : p.v }));
  return { in: integrate(pos, start, end) / 1000, out: integrate(neg, start, end) / 1000 };
};

export interface NodeDetail {
  id: string;
  title: string;
  color: number;
  /** Colour below zero (sold, discharging); the main colour when absent. */
  negColor?: number;
  /** 96 buckets over the last 24 h, W (signed for grid and batteries). */
  series: number[];
  forecast: (number | null)[] | null;
  soc: (number | null)[] | null;
  ticks: { x: number; label: string }[];
  legend: { series: string; forecast: string; soc: string };
  stats: { label: string; value: string }[];
  max?: number;
  min?: number;
}

type Stat = { label: string; value: string } | null;
const stats = (list: Stat[]) => list.filter((x): x is { label: string; value: string } => x !== null);

export interface DetailHistory {
  start: number;
  end: number;
  history: Record<string, Series>;
  /** LoadCast forecasts published over the window (fetched separately, may be missing). */
  loadcast?: LoadCastIssue[];
}

/** One chart per node: id, title, colours, 96 buckets in W, optional SOC and forecast lines, figures. */
export const nodeDetails = (hass: HomeAssistant, config: CardConfig, h: DetailHistory, now: Date) => {
  const { start, end, history, loadcast } = h;
  const step = (end - start) / BUCKETS;
  const input = buildReviewInput(hass, config, history, start, end);
  const tk = ticks(start, end);
  const peak = (s: Series | undefined, pick: "min" | "max") => (s ? extreme(s, start, end, pick) : null);
  const out: NodeDetail[] = [];

  if (config.solar?.entity) {
    const s = input.solar;
    const top = peak(s, "max");
    // Solcast P50 per half hour for the chart (P10 is for decisions; here we show what is expected)
    // Periods of 30 or 60 min (as readSolarP10ByHour): each bucket takes the period that holds it
    const periods: { a: number; b: number; w: number }[] = [];
    for (const id of config.solar.forecast_entities ?? []) {
      const per = hass.states[id]?.attributes?.detailedForecast;
      if (!Array.isArray(per)) continue;
      const len = per.length > 30 ? 1_800_000 : 3_600_000;
      for (const p of per as { period_start?: string; pv_estimate?: number }[]) {
        const a = new Date(p.period_start ?? "").getTime();
        if (Number.isFinite(a) && Number.isFinite(p.pv_estimate)) periods.push({ a, b: a + len, w: (p.pv_estimate as number) * 1000 });
      }
    }
    const forecast = Array.from({ length: BUCKETS }, (_, i) => {
      const mid = start + (i + 0.5) * step;
      const hit = periods.find((p) => p.a <= mid && mid < p.b);
      return hit ? Math.round(hit.w) : null;
    });
    const today = readNumber(hass, config.solar.today_energy);
    const fcToday = readNumber(hass, config.solar.forecast_today);
    const fcTomorrow = readNumber(hass, config.solar.forecast_tomorrow);
    out.push({
      id: "solar",
      title: t("detail.solar"),
      color: rgb(COLORS.solar),
      series: buckets(s, start, step),
      forecast: forecast.some((v) => v !== null) ? forecast : null,
      soc: null,
      ticks: tk,
      legend: { series: t("detail.power"), forecast: t("detail.forecast"), soc: "" },
      stats: stats([
        today !== null ? { label: t("detail.today"), value: formatEnergy(hass, today) } : null,
        fcToday !== null ? { label: t("detail.forecast_today"), value: formatEnergy(hass, fcToday) } : null,
        fcTomorrow !== null ? { label: t("detail.forecast_tomorrow"), value: formatEnergy(hass, fcTomorrow) } : null,
        top ? { label: t("detail.peak"), value: `${formatPower(hass, top.v)} ${hhmm(top.t)}` } : null,
      ]),
    });
  }

  if (config.grid?.entity) {
    const s = input.grid;
    const imp = readNumber(hass, config.grid.today_import);
    const exp = readNumber(hass, config.grid.today_export);
    const cost = readNumber(hass, config.grid.today_cost);
    const costUnit = String(hass.states[config.grid.today_cost ?? ""]?.attributes?.unit_of_measurement ?? "");
    const top = peak(s, "max");
    const low = peak(s, "min");
    out.push({
      id: "grid",
      title: t("detail.grid"),
      color: rgb(COLORS.grid),
      negColor: rgb(COLORS.solar),
      series: buckets(s, start, step),
      forecast: null,
      soc: null,
      ticks: tk,
      legend: { series: t("detail.grid_legend"), forecast: "", soc: "" },
      stats: stats([
        imp !== null ? { label: t("detail.bought_today"), value: formatEnergy(hass, imp) } : null,
        exp !== null ? { label: t("detail.sold_today"), value: formatEnergy(hass, exp) } : null,
        cost !== null ? { label: t("detail.cost_today"), value: `${cost.toFixed(2)}${costUnit ? ` ${costUnit}` : ""}` } : null,
        top && top.v > 0 ? { label: t("detail.peak_import"), value: `${formatPower(hass, top.v)} ${hhmm(top.t)}` } : null,
        low && low.v < 0 ? { label: t("detail.peak_export"), value: `${formatPower(hass, -low.v)} ${hhmm(low.t)}` } : null,
      ]),
    });
  }

  {
    const s = powerSeries(hass, history, [config.home.entity]);
    const top = peak(s, "max");
    const used = s ? integrate(s, start, end) / 1000 : null;
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    const lc = readLoadCast(hass, config.loadcast?.forecast, now);
    const rest = lc.length
      ? lc.reduce((sum, hr) => {
          const a = Math.max(hr.start.getTime(), now.getTime());
          const b = Math.min(hr.start.getTime() + 3_600_000, midnight.getTime());
          return b > a ? sum + (hr.kwh * (b - a)) / 3_600_000 : sum;
        }, 0)
      : null;
    // LoadCast per hour as it stood when the hour began (the sensor itself only
    // holds the hours from now on); the hour now running from the live sensor
    const issues = [...(loadcast ?? []), { at: now.getTime(), hours: lc.map((x) => ({ start: x.start.getTime(), kwh: x.kwh })) }];
    const forecastAt = (mid: number): number | null => {
      let best: number | null = null;
      for (const f of issues) {
        const hr = f.hours.find((x) => x.start <= mid && mid < x.start + 3_600_000);
        if (!hr) continue;
        if (f.at <= hr.start || best === null) best = hr.kwh;
        if (f.at > hr.start) break;
      }
      return best === null ? null : Math.round(best * 1000);
    };
    const forecast = Array.from({ length: BUCKETS }, (_, i) => forecastAt(start + (i + 0.5) * step));
    const predicted = forecast.every((v) => v !== null) ? forecast.reduce<number>((sum, v) => sum + (v ?? 0), 0) * (step / 3_600_000) / 1000 : null;
    out.push({
      id: "home",
      title: t("detail.home"),
      color: 0xf2f2f2,
      series: buckets(s, start, step),
      forecast: forecast.some((v) => v !== null) ? forecast : null,
      soc: null,
      ticks: tk,
      legend: { series: t("detail.power"), forecast: t("detail.forecast"), soc: "" },
      stats: stats([
        used !== null ? { label: t("detail.used_24h"), value: formatEnergy(hass, used) } : null,
        predicted !== null ? { label: t("detail.forecast_24h"), value: formatEnergy(hass, predicted) } : null,
        top ? { label: t("detail.peak"), value: `${formatPower(hass, top.v)} ${hhmm(top.t)}` } : null,
        rest !== null ? { label: t("detail.rest_of_day"), value: `~${formatEnergy(hass, rest)}` } : null,
      ]),
    });
  }

  input.batteries.forEach((b, i) => {
    const e = split(b.power, start, end);
    const lo = b.soc ? extreme(b.soc, start, end, "min") : null;
    const hi = b.soc ? extreme(b.soc, start, end, "max") : null;
    out.push({
      id: `battery-${i}`,
      title: b.name,
      color: rgb(COLORS.battery),
      negColor: rgb(COLORS.batteryLow),
      series: buckets(b.power, start, step),
      forecast: null,
      soc: b.soc
        ? Array.from({ length: BUCKETS }, (_, k) => {
            const v = valueAt(b.soc as Series, start + (k + 0.5) * step);
            return Number.isFinite(v) ? v : null;
          })
        : null,
      ticks: tk,
      legend: { series: t("detail.battery_legend"), forecast: "", soc: t("detail.soc") },
      stats: stats([
        { label: t("detail.charged_24h"), value: formatEnergy(hass, e.in) },
        { label: t("detail.discharged_24h"), value: formatEnergy(hass, e.out) },
        lo ? { label: t("detail.lowest"), value: `${formatPercent(hass, lo.v)} ${hhmm(lo.t)}` } : null,
        hi ? { label: t("detail.highest"), value: `${formatPercent(hass, hi.v)} ${hhmm(hi.t)}` } : null,
      ]),
    });
  });

  // Scale per chart: symmetric enough to show both directions
  return out.map((d): NodeDetail => {
    const vals = [...d.series, ...(d.forecast ?? []).filter((v): v is number => v !== null)];
    return { ...d, max: Math.max(...vals, 100) * 1.1, min: Math.min(...vals, 0) * 1.1 };
  });
};
