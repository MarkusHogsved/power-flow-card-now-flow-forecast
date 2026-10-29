import { peakIndex, sumKwh } from "./forecast";
import { formatEnergy, formatNumber, formatPercent, formatPower, formatUntil } from "./hass";
import { COLORS, type Flows, type LoadState, type Model } from "./model";
import { average, valueAt, type Series } from "./review";
import { layoutSankey, type SankeyBar } from "./sankey";
import { t } from "./strings";
import type { CardConfig, HomeAssistant } from "./types";
import type { ViewContext } from "./views/context";
import { flowData } from "./views/flow";
import { forecastData } from "./views/forecast";
import { nowFigures, phaseBar, vehicleTexts } from "./views/now";
import {
  ICONS,
  PRICE_COLORS,
  eventTexts,
  hhmm,
  priceClass,
  reviewTexts,
  type ReviewState,
  type Segment,
} from "./views/review";
import { VEHICLE_HOURS } from "./views/vehicle";

/** Header texts: status, what drives it, the import reason and the price. */
export const headerTexts = (hass: HomeAssistant, config: CardConfig, model: Model, now: Date) => {
  const detail: Record<string, string> = {
    importing: t("status.detail.importing", { power: formatPower(hass, model.gridImportW) }),
    exporting: t("status.detail.exporting", { power: formatPower(hass, model.gridExportW) }),
    solar: t("status.detail.solar", { power: formatPower(hass, model.solarW) }),
    battery: t("status.detail.battery"),
    idle: "",
  };
  let reason: { text: string; detail: string } | null = null;
  const entity = config.grid?.import_reason ? hass.states[config.grid.import_reason] : undefined;
  if (model.status === "importing" && entity?.state && !["unknown", "unavailable"].includes(entity.state)) {
    const untilRaw = entity.attributes.until;
    const until = typeof untilRaw === "string" && untilRaw ? new Date(untilRaw) : null;
    let untilText = "";
    if (until && !Number.isNaN(until.getTime())) {
      const u = formatUntil(hass, until, now);
      untilText = t(u.tomorrow ? "reason.until_tomorrow" : "reason.until", { time: u.time });
    }
    reason = {
      text: `${entity.state}${untilText ? ` · ${untilText}` : ""}`,
      detail: typeof entity.attributes.detail === "string" ? entity.attributes.detail : "",
    };
  }
  return {
    title: t(`status.${model.status}`),
    subtitle: `${formatPower(hass, model.homeW)}${detail[model.status] ? ` · ${detail[model.status]}` : ""}`,
    reason,
    price:
      model.price !== null
        ? { name: config.grid?.price_name ?? t("price"), value: formatNumber(hass, model.price, 2), unit: model.priceUnit }
        : null,
  };
};

/** Colors as 0xRRGGBB, for displays that draw the card themselves. */
const rgb = (hex: string): number => parseInt(hex.replace("#", "").slice(0, 6), 16);

/**
 * Everything the Now view shows, as plain data with the texts already
 * formatted - for a display that draws its own interface (display/esphome)
 * instead of showing a picture of the card. Powers are in W, flows too.
 */
export const nowSnapshot = (ctx: ViewContext) => {
  const { hass, config, model: m } = ctx;
  const fig = nowFigures(ctx);
  const flows: Flows = m.flows;
  return {
    v: 1,
    time: formatUntil(hass, ctx.now, ctx.now).time,
    header: headerTexts(hass, config, m, ctx.now),
    colors: { solar: rgb(COLORS.solar), grid: rgb(COLORS.grid), battery: rgb(COLORS.battery), low: rgb(COLORS.batteryLow) },
    labels: {
      solar: t("node.solar"),
      grid: t("node.grid"),
      home: t("node.home"),
      batteries: t("node.batteries"),
      running: t("running_now"),
      other: t("other"),
      rest: t("rest_of_home"),
      fuse: t("fuse", { amps: String(m.fuseA) }),
    },
    solar: config.solar
      ? { w: m.solarW, text: formatPower(hass, m.solarW), today: fig.solarToday, forecast: fig.solarForecast }
      : null,
    grid: config.grid
      ? {
          importW: m.gridImportW,
          exportW: m.gridExportW,
          text: `${m.gridExportW > 0 ? "← " : ""}${formatPower(hass, m.gridImportW || m.gridExportW)}`,
          today: fig.gridToday,
          cost: fig.gridCost,
          expected: fig.gridExpected,
        }
      : null,
    home: { w: m.homeW, text: formatPower(hass, m.homeW) },
    flows,
    bank: {
      text: fig.bankText,
      cells: m.batteries.map((b) => ({
        name: b.name,
        soc: b.soc,
        socText: b.soc === null ? "–" : formatPercent(hass, b.soc),
        arrow: b.powerW < 0 ? "↑" : b.powerW > 0 ? "↓" : "",
        powerText: b.powerW ? formatPower(hass, b.powerW) : "",
        low: b.soc !== null && b.soc < 30,
      })),
    },
    running: m.running.map((l) => {
      const v = vehicleTexts(ctx, l);
      return {
        name: l.name,
        entity: l.entity,
        icon: l.icon,
        color: rgb(l.color),
        w: l.powerW,
        text: formatPower(hass, l.powerW),
        lines: v ? [v.level, v.left, v.cost].filter((s) => s) : [],
      };
    }),
    others: m.loads.length
      ? [
          { name: t("rest_of_home"), text: formatPower(hass, m.restW) },
          ...m.loads.map((l) => ({ name: l.name, text: formatPower(hass, l.powerW) })),
        ]
      : [],
    phases: m.phases.map((p) => ({
      name: p.name,
      text: p.amps === null ? "–" : `${formatNumber(hass, Math.abs(p.amps), 1)} A`,
      ...phaseBar(p.amps, m.fuseA),
    })),
  };
};

export type NowSnapshot = ReturnType<typeof nowSnapshot>;

// ---------------------------------------------------------------- Other views

/** 0xRRGGBB for a hex colour; null for anything else (CSS variables). */
const hexOrNull = (c: string | undefined): number | null => (c && /^#[0-9a-f]{6}/i.test(c) ? rgb(c) : null);

/** Sankey bars and ribbons on a 0..1000 scale, labels with the power. */
export const flowSnapshot = (ctx: ViewContext) => {
  const { hass } = ctx;
  const d = flowData(ctx);
  const layout = layoutSankey(d.sources, d.sinks, 1000, 24);
  const bar = (b: SankeyBar) => ({ label: `${b.label} ${formatPower(hass, b.value)}`, color: rgb(b.color), y: b.y, h: b.height });
  return {
    sourcesTitle: t("flow.sources").toUpperCase(),
    usesTitle: t("flow.uses").toUpperCase(),
    nothing: layout.ribbons.length ? null : t("flow.nothing"),
    sources: layout.sources.map(bar),
    sinks: layout.sinks.map(bar),
    ribbons: layout.ribbons.map((r) => ({ color: rgb(r.color), y0: r.y0, y1: r.y1, y2: r.y2, y3: r.y3 })),
    batteries: d.batteries.map((b) => ({ name: b.name, state: b.state, socText: b.socText, soc: b.soc, color: rgb(b.color) })),
    stats: d.stats,
  };
};

/** The demand chart (kWh per hour) and "Will the battery last?". */
export const forecastSnapshot = (ctx: ViewContext) => {
  const { hass } = ctx;
  const d = forecastData(ctx);
  const hh = (dt: Date) => String(dt.getHours()).padStart(2, "0");
  const tomorrow =
    d.solarTomorrow !== null ? { label: t("tile.solar_tomorrow"), value: `~${formatEnergy(hass, d.solarTomorrow)}` } : null;
  if (!d.hours.length) return { title: t("forecast.title"), unavailable: t("forecast.unavailable"), tomorrow };
  const peak = peakIndex(d.hours);
  const rows: { label: string; sub: string | null; value: string; color: number; frac: number | null }[] = [
    {
      label: d.takeover !== null ? t("last.demand_until", { hour: `${hh(d.hours[d.takeover].start)}:00` }) : t("last.demand_24h"),
      sub: null,
      value: `~${formatEnergy(hass, d.homeDemand)}`,
      color: 0xf2f2f2,
      frac: d.homeDemand / d.scale,
    },
    ...d.vehicles.map((x) => ({
      label: t("last.vehicle", {
        name: x.v.name,
        soc: formatPercent(hass, x.v.soc as number),
        limit: formatPercent(hass, x.v.socLimit as number),
      }),
      sub: x.plan ? t("last.vehicle_planned", { from: d.at(x.plan.start), to: d.at(x.plan.end) }) : t("last.vehicle_unplanned"),
      value: `~${formatEnergy(hass, x.kwh)}`,
      color: rgb(x.v.color),
      frac: x.plan ? null : x.kwh / d.scale,
    })),
  ];
  if (d.usable !== null) {
    rows.push({ label: t("last.usable"), sub: null, value: formatEnergy(hass, d.usable), color: rgb(COLORS.battery), frac: d.usable / d.scale });
  }
  return {
    title: t("forecast.title"),
    unavailable: null,
    tomorrow,
    total: `~${formatEnergy(hass, sumKwh(d.hours))}`,
    plus: d.evTotal > 0 ? t("forecast.plus_vehicle", { energy: formatEnergy(hass, d.evTotal) }) : null,
    plusColor: d.vehicles.length ? rgb(d.vehicles[0].v.color) : 0,
    evColor: d.evLayer ? rgb(d.evLayer.color) : 0,
    hours: d.hours.map((h, i) => ({
      label: hh(h.start),
      kwh: h.kwh,
      p10: h.p10,
      p90: h.p90,
      ev: d.evLayer?.kwh[i] ?? 0,
      tick: i > 1 && h.start.getHours() % 6 === 0,
    })),
    nowLabel: t("forecast.now"),
    peak,
    peakLabel: t("forecast.peak", { from: hh(d.hours[peak].start), to: hh(new Date(d.hours[peak].start.getTime() + 3_600_000)) }),
    band: `${t("forecast.band")}${d.error !== null ? ` · ${t("forecast.error", { value: `${formatNumber(hass, d.error, 1)} %` })}` : ""}`,
    lastTitle: t("last.title"),
    rows,
    verdict:
      d.usable === null
        ? null
        : d.usable >= d.demand
          ? t("last.covered", { margin: formatEnergy(hass, d.usable - d.demand) })
          : t("last.short", { missing: formatEnergy(hass, d.demand - d.usable) }),
    verdictOk: d.usable !== null && d.usable >= d.demand,
    note: d.usable === null ? t("last.no_capacity") : null,
  };
};

const segmentsOut = (segs: Segment[]) =>
  segs.map((s) => (typeof s === "string" ? { t: s } : { t: s.t, b: true, c: hexOrNull(s.c) }));

/** Review: summary, tiles, the price/import/battery chart, legend and events. */
export const reviewSnapshot = (ctx: ViewContext, state: ReviewState) => {
  const { hass, model: m } = ctx;
  const r = state.data;
  if (!r) {
    return {
      period: t("view.review"),
      message: state.error ? t("review.error", { message: state.error }) : t("review.loading"),
    };
  }
  const unit = m.priceUnit || "";
  const x = reviewTexts(hass, r, unit, m.fuseA);
  const span = r.end - r.start;
  const fx = (ms: number) => Math.min(Math.max((ms - r.start) / span, 0), 1);
  const known = r.prices.filter((p) => Number.isFinite(p.mean));
  const avg = known.reduce((s, p) => s + p.mean, 0) / (known.length || 1);
  const maxPrice = Math.max(...known.map((p) => p.mean), 0.01) * 1.1;
  const maxImport = Math.max(...r.importBuckets.filter(Number.isFinite), 1) * 1.1;
  const step = state.hours === 24 ? 4 : 2;
  const ticks: { x: number; label: string }[] = [];
  const first = new Date(r.start);
  first.setMinutes(0, 0, 0);
  for (let h = first.getTime() + 3_600_000; h < r.end; h += 3_600_000) {
    if (new Date(h).getHours() % step === 0) ticks.push({ x: fx(h), label: String(new Date(h).getHours()).padStart(2, "0") });
  }
  const batteryNames = new Set(r.events.filter((e) => e.kind === "battery").map((e) => e.name));
  const marks = new Map<string, string>();
  for (const mk of r.marks) {
    if (mk.name === "export") continue;
    marks.set(batteryNames.has(mk.name) ? t("review.legend.charging") : mk.name, mk.color);
  }
  return {
    period: t("review.period", { hours: String(state.hours), from: hhmm(r.start), to: hhmm(r.end) }),
    message: state.error ? t("review.error", { message: state.error }) : null,
    headline: x.headline,
    sub: segmentsOut(x.sub),
    tiles: x.tiles.map(({ label, value, sub }) => ({ label, value, sub })),
    chart: {
      prices: known.map((p) => ({
        x0: fx(p.start),
        x1: fx(p.start + 3_600_000),
        f: Math.max(p.mean, 0) / maxPrice,
        c: rgb(PRICE_COLORS[priceClass(p.mean, avg)]),
      })),
      imports: r.importBuckets.map((v) => (Number.isFinite(v) ? v / maxImport : 0)),
      soc: r.socBuckets.map((v) => (Number.isFinite(v) ? v : null)),
      marks: r.marks.map((mk) => ({ x0: fx(mk.start), x1: fx(mk.end), c: rgb(mk.color) })),
      ticks,
    },
    legend: [
      ...(["cheap", "mid", "expensive"] as const).map((k) => ({ label: t(`review.legend.${k}`), c: rgb(PRICE_COLORS[k]), kind: "area" })),
      { label: t("review.legend.import"), c: rgb(COLORS.grid), kind: "line" },
      ...(r.lowestSoc?.name ? [{ label: r.lowestSoc.name, c: rgb(COLORS.battery), kind: "dashed" }] : []),
      ...[...marks].map(([label, c]) => ({ label, c: rgb(c), kind: "mark" })),
    ],
    eventsTitle: t("review.what_happened"),
    nothing: r.events.length ? null : t("review.nothing_happened"),
    events: r.events.map((e) => {
      const et = eventTexts(hass, e, unit, e.kind === "export" ? r.avgSellPrice : r.avgPrice);
      return {
        icon: e.icon ?? ICONS[e.kind],
        color: hexOrNull(e.color),
        border: hexOrNull(et.border),
        title: et.title,
        time: `${hhmm(e.start)} – ${hhmm(e.end)}`,
        text: segmentsOut(et.text),
      };
    }),
    footer: x.footer ? { text: x.footer.text, verdict: x.footer.verdict, c: rgb(x.footer.color) } : null,
  };
};

/** Power and battery level of a vehicle over the last hours, in even buckets, for the tap-to-open chart. */
export interface VehicleHistory {
  start: number;
  end: number;
  power: Series;
  soc?: Series;
}

const BUCKETS = 144;

export const vehicleSnapshot = (ctx: ViewContext, l: LoadState, h: VehicleHistory) => {
  const { hass } = ctx;
  const unit = String(hass.states[l.entity]?.attributes?.unit_of_measurement ?? "W").toLowerCase();
  const factor = unit === "kw" ? 1000 : unit === "mw" ? 1_000_000 : 1;
  const step = (h.end - h.start) / BUCKETS;
  const power: number[] = [];
  const soc: (number | null)[] = [];
  for (let i = 0; i < BUCKETS; i++) {
    const t0 = h.start + i * step;
    const p = average(h.power, t0, t0 + step);
    power.push(Number.isFinite(p) ? Math.max(p * factor, 0) : 0);
    const s = h.soc ? valueAt(h.soc, t0 + step / 2) : NaN;
    soc.push(Number.isFinite(s) ? s : null);
  }
  const ticks: { x: number; label: string }[] = [];
  const first = new Date(h.start);
  first.setMinutes(0, 0, 0);
  for (let ms = first.getTime() + 3_600_000; ms < h.end; ms += 3_600_000) {
    if (new Date(ms).getHours() % 2 === 0) {
      ticks.push({ x: (ms - h.start) / (h.end - h.start), label: String(new Date(ms).getHours()).padStart(2, "0") });
    }
  }
  return {
    entity: l.entity,
    title: t("vehicle.title", { name: l.name, hours: String(VEHICLE_HOURS) }),
    color: rgb(l.color),
    powerText: formatPower(hass, l.powerW),
    socText: l.soc != null ? formatPercent(hass, l.soc) : null,
    limit: l.socLimit ?? null,
    max: Math.max(...power, 1000) * 1.1,
    power,
    soc,
    ticks,
  };
};

/** Every view, for a display that draws its own interface: Now at the top level (as in v1), the rest beside it. */
export const fullSnapshot = (ctx: ViewContext, review: ReviewState, histories: Map<string, VehicleHistory>) => ({
  ...nowSnapshot(ctx),
  v: 2,
  tabs: (["now", "flow", "forecast", "review"] as const).map((v) => t(`view.${v}`)),
  flow: flowSnapshot(ctx),
  forecast: forecastSnapshot(ctx),
  review: reviewSnapshot(ctx, review),
  vehicles: ctx.model.running
    .filter((l) => l.socEntity && histories.has(l.entity))
    .map((l) => vehicleSnapshot(ctx, l, histories.get(l.entity) as VehicleHistory)),
});

export type FullSnapshot = ReturnType<typeof fullSnapshot>;
