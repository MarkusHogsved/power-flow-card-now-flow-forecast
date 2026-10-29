import { html, nothing, svg } from "lit";
import { formatEnergy, formatNumber, formatPercent, formatPower } from "../hass";
import { COLORS } from "../model";
import type { Review, ReviewEvent, Verdict } from "../review";
import { t } from "../strings";
import type { HomeAssistant } from "../types";
import type { ViewContext } from "./context";
import { vehicleChart } from "./vehicle";

export type ReviewHours = 12 | 24;

export interface ReviewState {
  hours: ReviewHours;
  data?: Review;
  loading: boolean;
  error?: string;
}

const W = 400;
const PLOT_H = 110;
const MARK_Y = PLOT_H + 4;
const SVG_H = MARK_Y + 22;

export const PRICE_COLORS = { cheap: "#7FC97F", mid: "#F0C05A", expensive: "#E57F84" };
export const VERDICT_COLORS: Record<Verdict, string> = {
  good: "#7FC97F",
  ok: "#F0C05A",
  bad: "#E57F84",
  neutral: "var(--nff-track)",
};

export const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

const duration = (ms: number): string => {
  const min = Math.max(Math.round(ms / 60_000 / 15) * 15, 15);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
};

/** Price class against the period average: below 75 % cheap, above 125 % expensive. */
export const priceClass = (price: number, avg: number): keyof typeof PRICE_COLORS =>
  price < avg * 0.75 ? "cheap" : price > avg * 1.25 ? "expensive" : "mid";

const chart = (r: Review, hours: ReviewHours) => {
  const span = r.end - r.start;
  const x = (ms: number) => ((ms - r.start) / span) * W;
  const known = r.prices.filter((p) => Number.isFinite(p.mean));
  const avg = known.reduce((s, p) => s + p.mean, 0) / (known.length || 1);
  const maxPrice = Math.max(...known.map((p) => p.mean), 0.01) * 1.1;
  const maxImport = Math.max(...r.importBuckets.filter(Number.isFinite), 1) * 1.1;

  const area = (values: number[], top: (v: number) => number) => {
    const pts = values.map((v, i) => {
      const t0 = r.start + i * r.bucketMs;
      return `L${x(t0).toFixed(1)} ${top(Number.isFinite(v) ? v : 0).toFixed(1)} L${x(Math.min(t0 + r.bucketMs, r.end)).toFixed(1)} ${top(Number.isFinite(v) ? v : 0).toFixed(1)}`;
    });
    return `M0 ${PLOT_H} ${pts.join(" ")} L${W} ${PLOT_H} Z`;
  };
  const importTop = (v: number) => PLOT_H - (v / maxImport) * (PLOT_H - 4);

  const soc = r.socBuckets
    .map((v, i) => ({ v, x: x(r.start + (i + 0.5) * r.bucketMs) }))
    .filter((p) => Number.isFinite(p.v));
  const socPath = soc.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${(PLOT_H - (p.v / 100) * PLOT_H).toFixed(1)}`).join(" ");

  const step = hours === 24 ? 4 : 2;
  const ticks: number[] = [];
  const first = new Date(r.start);
  first.setMinutes(0, 0, 0);
  for (let h = first.getTime() + 3_600_000; h < r.end; h += 3_600_000) {
    if (new Date(h).getHours() % step === 0) ticks.push(h);
  }

  return svg`
    <svg class="chart" viewBox="0 0 ${W} ${SVG_H}" role="img" aria-label=${t("review.chart")}>
      ${known.map((p) => {
        const x0 = Math.max(x(p.start), 0);
        const x1 = Math.min(x(p.start + 3_600_000), W);
        const h = (Math.max(p.mean, 0) / maxPrice) * PLOT_H;
        return svg`<rect x=${(x0 + 0.5).toFixed(1)} y=${(PLOT_H - h).toFixed(1)} width=${Math.max(x1 - x0 - 1, 0.5).toFixed(1)}
          height=${h.toFixed(1)} fill=${PRICE_COLORS[priceClass(p.mean, avg)]} fill-opacity="0.22"><title>${hhmm(p.start)} ${p.mean.toFixed(2)}</title></rect>`;
      })}
      <path d=${area(r.importBuckets, importTop)} fill=${COLORS.grid} fill-opacity="0.25" stroke=${COLORS.grid} stroke-width="1.2" stroke-linejoin="round"></path>
      ${socPath
        ? svg`<path d=${socPath} fill="none" stroke=${COLORS.battery} stroke-width="2" stroke-dasharray="5 4" stroke-linejoin="round"></path>`
        : nothing}
      <line x1="0" y1=${PLOT_H + 0.5} x2=${W} y2=${PLOT_H + 0.5} stroke="var(--nff-track)"></line>
      ${r.marks.map(
        (m) => svg`<rect x=${x(m.start).toFixed(1)} y=${MARK_Y} width=${Math.max(x(m.end) - x(m.start), 2).toFixed(1)} height="5" rx="2"
          fill=${m.color}><title>${m.name} ${hhmm(m.start)}–${hhmm(m.end)}</title></rect>`,
      )}
      ${ticks.map((h) => svg`<text x=${(x(h) - 7).toFixed(1)} y=${SVG_H - 1}>${String(new Date(h).getHours()).padStart(2, "0")}</text>`)}
    </svg>
  `;
};

const legend = (r: Review, battery: string | undefined) => {
  // Batteries share one colour: one "charging" entry, then each load
  const names = new Map<string, string>();
  const batteryNames = new Set(r.events.filter((e) => e.kind === "battery").map((e) => e.name));
  for (const m of r.marks) {
    if (m.name === "export") continue;
    if (batteryNames.has(m.name)) names.set(t("review.legend.charging"), m.color);
    else names.set(m.name, m.color);
  }
  return html`<div class="legend">
    ${(["cheap", "mid", "expensive"] as const).map(
      (k) => html`<span><i style="background: ${PRICE_COLORS[k]}80"></i>${t(`review.legend.${k}`)}</span>`,
    )}
    <span><i class="line" style="background: ${COLORS.grid}"></i>${t("review.legend.import")}</span>
    ${battery ? html`<span><i class="line dashed" style="border-color: ${COLORS.battery}"></i>${battery}</span>` : nothing}
    ${[...names].map(([name, color]) => html`<span><i class="mark" style="background: ${color}"></i>${name}</span>`)}
  </div>`;
};

export const ICONS: Record<ReviewEvent["kind"], string> = {
  battery: "mdi:battery-charging",
  load: "mdi:flash",
  solar: "mdi:white-balance-sunny",
  export: "mdi:transmission-tower-export",
};

/** A piece of text; `b` pieces are bold, in `c` when given (shared with the display snapshot). */
export type Segment = string | { t: string; b: true; c?: string };

const verdictHex = (v: Verdict): string | undefined => (v === "neutral" ? undefined : VERDICT_COLORS[v]);

const socSpan = (hass: HomeAssistant, e: ReviewEvent): Segment[] =>
  e.socFrom !== undefined && e.socTo !== undefined && Number.isFinite(e.socFrom) && Number.isFinite(e.socTo)
    ? [`${formatNumber(hass, Math.round(e.socFrom), 0)} → ${formatPercent(hass, e.socTo)} · `]
    : [];

/** Title and text of an event card. */
export const eventTexts = (
  hass: HomeAssistant,
  e: ReviewEvent,
  unit: string,
  avgPrice: number | null,
): { title: string; text: Segment[]; border: string | undefined } => {
  const price = (p: number) => `${formatNumber(hass, p, 2)} ${unit}`;
  const currency = unit.split("/")[0].trim();
  const money = (v: number) => `${formatNumber(hass, v, Math.abs(v) < 10 ? 2 : 0)}${currency ? ` ${currency}` : ""}`;
  const energy = `~${formatEnergy(hass, e.kwh)}`;

  const pricing = (): Segment[] => {
    if (e.avgPrice === null) return [t("review.mostly_own", { energy })];
    const out: Segment[] = [
      energy,
      " · ",
      t("review.at_price", { energy: formatEnergy(hass, e.gridKwh), price: "" }),
      { t: price(e.avgPrice), b: true, c: verdictHex(e.verdict) },
    ];
    if (e.cheapest !== null) {
      out.push(` – ${t("review.cheapest", { duration: duration(e.end - e.start), price: price(e.cheapest) })}`);
      if (e.cheapest > 0 && e.avgPrice / e.cheapest >= 1.5) {
        out.push(` (${t("review.times", { ratio: formatNumber(hass, e.avgPrice / e.cheapest, 1) })})`);
      }
    }
    return out;
  };
  const runsText = (own: Segment[]): Segment[] =>
    e.avgPrice !== null ? [energy, " · avg ", { t: price(e.avgPrice), b: true }] : [energy, ...own];

  let title: string;
  let text: Segment[];
  switch (e.kind) {
    case "battery":
      title = e.runs
        ? t("review.battery.runs", { name: e.name, runs: String(e.runs) })
        : t("review.battery.title", { name: e.name });
      text = e.runs ? runsText([` · ${t("review.mostly_own_short")}`]) : [...socSpan(hass, e), ...pricing()];
      break;
    case "load":
      title = e.runs ? t("review.runs", { name: e.name, runs: String(e.runs) }) : t("review.load.title", { name: e.name });
      text = e.runs
        ? runsText([])
        : e.vehicle
          ? [
              ...socSpan(hass, e),
              energy,
              ...(e.cost !== undefined
                ? ([" · ", { t: money(e.cost), b: true }, e.kwh > 0 ? ` (${price(e.cost / e.kwh)})` : ""] as Segment[])
                : [" · ", ...pricing()]),
            ]
          : pricing();
      break;
    case "solar":
      title = t("review.solar.title");
      text = [
        t("review.solar.text", {
          energy: formatEnergy(hass, e.kwh),
          power: e.peakW !== undefined ? formatPower(hass, e.peakW) : "–",
          time: e.peakAt !== undefined ? hhmm(e.peakAt) : "–",
        }),
      ];
      break;
    default:
      title = t("review.export.title");
      text = [
        t("review.export.text", {
          energy: formatEnergy(hass, e.kwh),
          price: e.avgPrice !== null ? price(e.avgPrice) : "–",
          avg: avgPrice !== null ? price(avgPrice) : "–",
        }),
      ];
  }
  return { title, text: text.filter((s) => s !== ""), border: e.verdict === "neutral" ? e.color : VERDICT_COLORS[e.verdict] };
};

const segments = (segs: Segment[]) =>
  segs.map((s) => (typeof s === "string" ? s : s.c ? html`<b style="color: ${s.c}">${s.t}</b>` : html`<b>${s.t}</b>`));

const eventCard = (ctx: ViewContext, e: ReviewEvent, unit: string, avgPrice: number | null) => {
  const { title, text, border } = eventTexts(ctx.hass, e, unit, avgPrice);
  const open = !!e.vehicle && ctx.reviewOpen === e.start;
  const pad = Math.max((e.end - e.start) * 0.15, 15 * 60_000);
  return html`
    <div
      class="event ${e.verdict}${e.vehicle ? " expandable" : ""}"
      style="border-left-color: ${border ?? "var(--nff-track)"}"
      aria-expanded=${e.vehicle ? (open ? "true" : "false") : nothing}
      @click=${e.vehicle ? () => ctx.toggleReviewEvent(e.start) : nothing}
    >
      <ha-icon .icon=${e.icon ?? ICONS[e.kind]} style="color: ${e.color ?? "inherit"}"></ha-icon>
      <div class="event-body">
        <div class="row"><b>${title}</b><span class="muted">${hhmm(e.start)} – ${hhmm(e.end)}</span></div>
        <span class="event-text">${segments(text)}</span>
        ${open && e.vehicle
          ? vehicleChart({
              start: e.start - pad,
              end: Math.min(e.end + pad, Date.now()),
              power: e.vehicle.power,
              soc: e.vehicle.soc,
              color: e.color ?? COLORS.battery,
            })
          : nothing}
      </div>
    </div>
  `;
};

export const renderReview = (ctx: ViewContext, state: ReviewState, setHours: (h: ReviewHours) => void) => {
  const { hass, config, model: m } = ctx;
  const r = state.data;
  const unit = m.priceUnit || "";

  const toggle = html`<div class="pills" role="group">
    ${([12, 24] as const).map(
      (h) => html`<button type="button" aria-pressed=${state.hours === h ? "true" : "false"} @click=${() => setHours(h)}>
        ${t("review.hours", { hours: String(h) })}
      </button>`,
    )}
  </div>`;

  const head = html`<div class="row" style="align-items: center">
    <span class="section-title">
      ${r ? t("review.period", { hours: String(state.hours), from: hhmm(r.start), to: hhmm(r.end) }) : t("view.review")}
    </span>
    ${toggle}
  </div>`;

  if (!hass.callWS) return html`<div class="view">${head}<div class="muted">${t("review.no_history")}</div></div>`;
  if (!r) {
    return html`<div class="view">
      ${head}
      <div class="muted">${state.error ? t("review.error", { message: state.error }) : t("review.loading")}</div>
    </div>`;
  }

  const x = reviewTexts(hass, r, unit, m.fuseA);
  return html`
    <div class="view">
      ${head}
      ${state.error ? html`<div class="muted">${t("review.error", { message: state.error })}</div>` : nothing}
      ${x.headline !== null
        ? html`<div class="summary">
            <b>${x.headline}</b>
            <span>${segments(x.sub)}</span>
          </div>`
        : nothing}

      <div class="review-tiles">
        ${x.tiles.map(
          (tile) => html`<div class="stat" @click=${tile.solar ? () => ctx.moreInfo(config.solar?.entity) : nothing}>
            <span class="muted">${tile.label}</span><b>${tile.value}</b><span class="muted">${tile.sub}</span>
          </div>`,
        )}
      </div>

      ${r.prices.length || r.importBuckets.some(Number.isFinite) ? html`${chart(r, state.hours)}${legend(r, r.lowestSoc?.name)}` : nothing}

      <div class="events">
        <span class="section-title">${t("review.what_happened")}</span>
        ${r.events.length
          ? r.events.map((e) => eventCard(ctx, e, unit, e.kind === "export" ? r.avgSellPrice : r.avgPrice))
          : html`<span class="muted">${t("review.nothing_happened")}</span>`}
      </div>

      ${x.footer
        ? html`<div class="row review-footer">
            <span>${x.footer.text}</span>
            ${x.footer.verdict ? html`<b style="color: ${x.footer.color}">${x.footer.verdict}</b>` : nothing}
          </div>`
        : nothing}
    </div>
  `;
};

/** Summary, tiles and footer of Review - shared with the display snapshot. */
export const reviewTexts = (hass: HomeAssistant, r: Review, unit: string, fuse: number) => {
  const currency = unit.split("/")[0].trim();
  const money = (v: number) => `${formatNumber(hass, v, Math.abs(v) < 10 ? 2 : 0)}${currency ? ` ${currency}` : ""}`;
  const price = (p: number) => `${formatNumber(hass, p, 2)} ${unit}`;
  const bought = r.bought;
  const headline = !bought
    ? null
    : bought.kwh < 0.1
      ? t("review.nothing_bought")
      : bought.cost !== null
        ? t("review.bought", { energy: formatEnergy(hass, bought.kwh), cost: money(bought.cost) })
        : t("review.bought_energy", { energy: formatEnergy(hass, bought.kwh) });
  const share = r.avgBuyPrice !== null && r.avgPrice !== null && r.avgPrice > 0 ? r.avgBuyPrice / r.avgPrice : null;
  const shareColor = share === null ? undefined : share <= 0.9 ? VERDICT_COLORS.good : share >= 1.1 ? VERDICT_COLORS.bad : VERDICT_COLORS.ok;
  const sold = r.sold;
  const sub: Segment[] = [];
  if (r.avgBuyPrice !== null && r.avgPrice !== null) {
    sub.push(t("review.avg_vs", { paid: price(r.avgBuyPrice), avg: price(r.avgPrice) }));
    sub.push({ t: t("review.share", { share: share !== null ? formatPercent(hass, share * 100) : "–" }), b: true, c: shareColor });
    sub.push(". ");
  }
  if (sold) {
    sub.push(
      sold.kwh >= 0.1
        ? t("review.sold_for", { energy: formatEnergy(hass, sold.kwh), revenue: sold.revenue !== null ? money(sold.revenue) : "–" })
        : t("review.nothing_sold"),
    );
  }

  const tiles: { label: string; value: string; sub: string; solar?: boolean }[] = [];
  if (bought) tiles.push({ label: t("review.tile.bought"), value: formatEnergy(hass, bought.kwh), sub: bought.cost !== null ? money(bought.cost) : "" });
  if (sold) {
    tiles.push({
      label: t("review.tile.sold"),
      value: formatEnergy(hass, sold.kwh),
      sub: sold.revenue !== null && sold.kwh >= 0.1 ? money(sold.revenue) : "",
    });
  }
  if (r.solarKwh !== null) tiles.push({ label: t("review.tile.solar"), value: formatEnergy(hass, r.solarKwh), sub: "", solar: true });
  if (r.lowestSoc) tiles.push({ label: t("review.tile.lowest"), value: formatPercent(hass, r.lowestSoc.v), sub: hhmm(r.lowestSoc.t) });

  const footer =
    r.peakImportW !== null || r.maxPhaseA !== null
      ? {
          text: [
            r.peakImportW !== null ? t("review.peak", { power: formatPower(hass, r.peakImportW) }) : "",
            r.maxPhaseA !== null ? t("review.phase", { amps: formatNumber(hass, r.maxPhaseA, 1), fuse: String(fuse) }) : "",
          ]
            .filter((p) => p)
            .join(" · "),
          verdict: r.maxPhaseA !== null ? (r.maxPhaseA <= fuse ? t("review.fuse_ok") : t("review.fuse_over")) : "",
          color: r.maxPhaseA !== null && r.maxPhaseA <= fuse ? VERDICT_COLORS.good : VERDICT_COLORS.ok,
        }
      : null;
  return { headline, sub, tiles, footer };
};
