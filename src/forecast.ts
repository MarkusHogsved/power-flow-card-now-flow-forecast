import type { BatteryState } from "./model";
import type { HomeAssistant } from "./types";

export interface ForecastHour {
  start: Date;
  kwh: number;
  p10: number;
  p90: number;
}

interface RawLoadCastHour {
  period_start?: string;
  kwh?: number;
  kwh_p10?: number;
  kwh_p90?: number;
}

/** The next `hours` LoadCast hours, starting with the hour that contains `now`. */
export const readLoadCast = (
  hass: HomeAssistant,
  entityId: string | undefined,
  now: Date,
  hours = 24,
): ForecastHour[] => {
  if (!entityId) return [];
  const raw = hass.states[entityId]?.attributes?.forecast;
  if (!Array.isArray(raw)) return [];
  const hourStart = new Date(now);
  hourStart.setMinutes(0, 0, 0);
  return (raw as RawLoadCastHour[])
    .map((h) => ({
      start: new Date(h.period_start ?? ""),
      kwh: Number(h.kwh),
      p10: Number(h.kwh_p10 ?? h.kwh),
      p90: Number(h.kwh_p90 ?? h.kwh),
    }))
    .filter((h) => !Number.isNaN(h.start.getTime()) && Number.isFinite(h.kwh))
    .filter((h) => h.start.getTime() >= hourStart.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, hours);
};

interface RawSolcastPeriod {
  period_start?: string;
  pv_estimate10?: number;
}

/**
 * Solar P10 energy (kWh) per hour start (ms), from Solcast `detailedForecast`
 * (kW per 30 or 60 minute period). P10, never P50: "solar takes over" must be
 * a promise we can rely on.
 */
export const readSolarP10ByHour = (hass: HomeAssistant, entityIds: string[] | undefined): Map<number, number> => {
  const byHour = new Map<number, number>();
  for (const id of entityIds ?? []) {
    const periods = hass.states[id]?.attributes?.detailedForecast;
    if (!Array.isArray(periods)) continue;
    const list = periods as RawSolcastPeriod[];
    const step = list.length > 30 ? 0.5 : 1; // 48 half-hours or 24 hours per day
    for (const p of list) {
      const start = new Date(p.period_start ?? "");
      const kw = Number(p.pv_estimate10);
      if (Number.isNaN(start.getTime()) || !Number.isFinite(kw)) continue;
      start.setMinutes(0, 0, 0);
      byHour.set(start.getTime(), (byHour.get(start.getTime()) ?? 0) + kw * step);
    }
  }
  return byHour;
};

/**
 * Index of the first hour after now where solar P10 covers that hour's
 * forecast demand - from then on the batteries are no longer drained. null
 * when that does not happen within the forecast (or there is no solar data).
 */
export const solarTakeoverIndex = (hours: ForecastHour[], solarP10: Map<number, number>): number | null => {
  for (let i = 1; i < hours.length; i++) {
    const pv = solarP10.get(hours[i].start.getTime());
    if (pv !== undefined && pv > 0 && pv >= hours[i].kwh) return i;
  }
  return null;
};

export const sumKwh = (hours: ForecastHour[], until = hours.length): number =>
  hours.slice(0, until).reduce((s, h) => s + h.kwh, 0);

/**
 * What the batteries must supply: each hour's demand minus solar P10 that
 * hour (never below zero - surplus solar in one hour does not pay for another).
 */
export const netDemandKwh = (hours: ForecastHour[], solarP10: Map<number, number>, until = hours.length): number =>
  hours
    .slice(0, until)
    .reduce((s, h) => s + Math.max(h.kwh - (solarP10.get(h.start.getTime()) ?? 0), 0), 0);

/** Energy above each battery's reserve, for batteries with a known capacity. null if none has one. */
export const usableBatteryKwh = (batteries: BatteryState[]): number | null => {
  const known = batteries.filter((b) => b.capacityKwh !== null && b.soc !== null);
  if (!known.length) return null;
  return known.reduce(
    (s, b) => s + Math.max(((b.soc as number) - b.reserveSoc) / 100, 0) * (b.capacityKwh as number),
    0,
  );
};

/**
 * Grid energy still expected before `until` (e.g. midnight), hour by hour:
 * demand minus solar P10, a shortfall drawn from the batteries (above their
 * reserve) and the rest from the grid, a surplus charging the batteries up
 * to full. The current hour counts only for the part still ahead. Planned
 * grid charging is not known here, so it is not included.
 */
export const expectedImportKwh = (
  hours: ForecastHour[],
  solarP10: Map<number, number>,
  batteries: BatteryState[],
  now: Date,
  until: Date,
): number => {
  const known = batteries.filter((b) => b.capacityKwh !== null && b.soc !== null);
  const room = known.reduce((s, b) => s + ((100 - b.reserveSoc) / 100) * (b.capacityKwh as number), 0);
  let stored = usableBatteryKwh(known) ?? 0;
  let grid = 0;
  for (const h of hours) {
    const start = h.start.getTime();
    const end = start + 3_600_000;
    const from = Math.max(start, now.getTime());
    const to = Math.min(end, until.getTime());
    if (to <= from) continue;
    const share = (to - from) / 3_600_000;
    const net = (h.kwh - (solarP10.get(start) ?? 0)) * share;
    if (net > 0) {
      const fromBattery = Math.min(net, stored);
      stored -= fromBattery;
      grid += net - fromBattery;
    } else {
      stored = Math.min(stored - net, room);
    }
  }
  return grid;
};

/**
 * A vehicle's energy to its limit spread evenly over its planned window, per
 * forecast hour (kWh). Only the part of the window after `now` counts; an
 * hour outside the window gets 0.
 */
export const vehicleByHour = (
  hours: ForecastHour[],
  kwh: number,
  plan: { start: Date; end: Date },
  now: Date,
): number[] => {
  const from = Math.max(plan.start.getTime(), now.getTime());
  const to = plan.end.getTime();
  if (to <= from || kwh <= 0) return hours.map(() => 0);
  return hours.map((h) => {
    const a = Math.max(h.start.getTime(), from);
    const b = Math.min(h.start.getTime() + 3_600_000, to);
    return b > a ? (kwh * (b - a)) / (to - from) : 0;
  });
};

export const peakIndex = (hours: ForecastHour[]): number =>
  hours.reduce((best, h, i) => (h.kwh > hours[best].kwh ? i : best), 0);

export interface PricePoint {
  start: Date;
  value: number;
}

/**
 * Prices from now on, per quarter or hour as the entity gives them, at most
 * `hours` ahead. Reads `today`/`tomorrow` lists of numbers (96 quarters from
 * local midnight, as sensor.elpris_kop_nu) or Nord Pool's
 * `raw_today`/`raw_tomorrow` ({start, value} entries).
 */
export const readUpcomingPrices = (
  hass: HomeAssistant,
  entityId: string | undefined,
  now: Date,
  hours = 12,
): PricePoint[] => {
  const attrs = entityId ? hass.states[entityId]?.attributes : undefined;
  if (!attrs) return [];
  const points: PricePoint[] = [];
  const day = (offset: number, list: unknown) => {
    if (!Array.isArray(list) || !list.length) return;
    if (typeof list[0] === "number") {
      const midnight = new Date(now);
      midnight.setDate(midnight.getDate() + offset);
      midnight.setHours(0, 0, 0, 0);
      list.forEach((v, i) => {
        let start: Date;
        if (list.length === 96 || list.length === 24) {
          // Wall clock (as nordpool_kvart): quarter/hour i of the local day
          start = new Date(midnight);
          start.setHours(0, (i * 24 * 60) / list.length, 0, 0);
        } else {
          // A daylight-saving day (92/100 quarters or 23/25 hours): real steps from midnight
          const step = list.length <= 25 ? 60 : 15;
          start = new Date(midnight.getTime() + i * step * 60_000);
        }
        if (Number.isFinite(v)) points.push({ start, value: v as number });
      });
    } else {
      for (const p of list as { start?: string; value?: number }[]) {
        const start = new Date(p.start ?? "");
        if (!Number.isNaN(start.getTime()) && Number.isFinite(p.value)) points.push({ start, value: p.value as number });
      }
    }
  };
  // Explicit timestamps first (Nord Pool), else the plain lists
  if (Array.isArray(attrs.raw_today) && attrs.raw_today.length) {
    day(0, attrs.raw_today);
    day(1, attrs.raw_tomorrow);
  } else {
    day(0, attrs.today);
    day(1, attrs.tomorrow);
  }
  points.sort((a, b) => a.start.getTime() - b.start.getTime());
  // From the period that holds now
  const first = points.findIndex((p, i) => i + 1 >= points.length || points[i + 1].start > now);
  if (first < 0) return [];
  const until = points[first].start.getTime() + hours * 3_600_000;
  return points.slice(first).filter((p) => p.start.getTime() < until);
};
