import { html, nothing, svg } from "lit";
import { formatEnergy, formatNumber, formatPercent, formatPower } from "../hass";
import { COLORS } from "../model";
import type { Review, ReviewEvent, Verdict } from "../review";
import { t } from "../strings";
import type { ViewContext } from "./context";

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

const PRICE_COLORS = { cheap: "#7FC97F", mid: "#F0C05A", expensive: "#E57F84" };
const VERDICT_COLORS: Record<Verdict, string> = {
  good: "#7FC97F",
  ok: "#F0C05A",
  bad: "#E57F84",
  neutral: "var(--nff-track)",
};

const hhmm = (ms: number): string => {
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
const priceClass = (price: number, avg: number): keyof typeof PRICE_COLORS =>
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

const ICONS: Record<ReviewEvent["kind"], string> = {
  battery: "mdi:battery-charging",
  load: "mdi:flash",
  solar: "mdi:white-balance-sunny",
  export: "mdi:transmission-tower-export",
};

const eventCard = (ctx: ViewContext, e: ReviewEvent, unit: string, avgPrice: number | null) => {
  const { hass } = ctx;
  const price = (p: number) => `${formatNumber(hass, p, 2)} ${unit}`;
  const energy = `~${formatEnergy(hass, e.kwh)}`;

  const pricing = () => {
    if (e.avgPrice === null) return t("review.mostly_own", { energy });
    const parts = [energy, " · ", t("review.at_price", { energy: formatEnergy(hass, e.gridKwh), price: "" })];
    return html`${parts}<b style="color: ${VERDICT_COLORS[e.verdict] === VERDICT_COLORS.neutral ? "inherit" : VERDICT_COLORS[e.verdict]}">${price(e.avgPrice)}</b>${e.cheapest !== null
        ? html` – ${t("review.cheapest", { duration: duration(e.end - e.start), price: price(e.cheapest) })}${e.cheapest > 0 &&
          e.avgPrice / e.cheapest >= 1.5
            ? html` (${t("review.times", { ratio: formatNumber(hass, e.avgPrice / e.cheapest, 1) })})`
            : nothing}`
        : nothing}`;
  };

  let title: string;
  let text: unknown;
  switch (e.kind) {
    case "battery":
      title = e.runs
        ? t("review.battery.runs", { name: e.name, runs: String(e.runs) })
        : t("review.battery.title", { name: e.name });
      text = e.runs
        ? html`${energy}${e.avgPrice !== null ? html` · avg <b>${price(e.avgPrice)}</b>` : html` · ${t("review.mostly_own_short")}`}`
        : html`${e.socFrom !== undefined && e.socTo !== undefined && Number.isFinite(e.socFrom) && Number.isFinite(e.socTo)
          ? `${formatNumber(hass, Math.round(e.socFrom), 0)} → ${formatPercent(hass, e.socTo)} · `
          : nothing}${pricing()}`;
      break;
    case "load":
      title = e.runs ? t("review.runs", { name: e.name, runs: String(e.runs) }) : t("review.load.title", { name: e.name });
      text = e.runs
        ? html`${energy}${e.avgPrice !== null ? html` · avg <b>${price(e.avgPrice)}</b>` : nothing}`
        : pricing();
      break;
    case "solar":
      title = t("review.solar.title");
      text = t("review.solar.text", {
        energy: formatEnergy(hass, e.kwh),
        power: e.peakW !== undefined ? formatPower(hass, e.peakW) : "–",
        time: e.peakAt !== undefined ? hhmm(e.peakAt) : "–",
      });
      break;
    default:
      title = t("review.export.title");
      text = t("review.export.text", {
        energy: formatEnergy(hass, e.kwh),
        price: e.avgPrice !== null ? price(e.avgPrice) : "–",
        avg: avgPrice !== null ? price(avgPrice) : "–",
      });
  }
  const border = e.verdict === "neutral" ? e.color ?? "var(--nff-track)" : VERDICT_COLORS[e.verdict];
  return html`
    <div class="event ${e.verdict}" style="border-left-color: ${border}">
      <ha-icon .icon=${e.icon ?? ICONS[e.kind]} style="color: ${e.color ?? "inherit"}"></ha-icon>
      <div class="event-body">
        <div class="row"><b>${title}</b><span class="muted">${hhmm(e.start)} – ${hhmm(e.end)}</span></div>
        <span class="event-text">${text}</span>
      </div>
    </div>
  `;
};

export const renderReview = (ctx: ViewContext, state: ReviewState, setHours: (h: ReviewHours) => void) => {
  const { hass, config, model: m } = ctx;
  const r = state.data;
  const unit = m.priceUnit || "";
  const currency = unit.split("/")[0].trim();
  const money = (v: number) => `${formatNumber(hass, v, Math.abs(v) < 10 ? 2 : 0)}${currency ? ` ${currency}` : ""}`;
  const price = (p: number) => `${formatNumber(hass, p, 2)} ${unit}`;

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

  const bought = r.bought;
  const headline = !bought
    ? nothing
    : bought.kwh < 0.1
      ? t("review.nothing_bought")
      : bought.cost !== null
        ? t("review.bought", { energy: formatEnergy(hass, bought.kwh), cost: money(bought.cost) })
        : t("review.bought_energy", { energy: formatEnergy(hass, bought.kwh) });
  const share = r.avgBuyPrice !== null && r.avgPrice !== null && r.avgPrice > 0 ? r.avgBuyPrice / r.avgPrice : null;
  const shareColor = share === null ? "inherit" : share <= 0.9 ? VERDICT_COLORS.good : share >= 1.1 ? VERDICT_COLORS.bad : VERDICT_COLORS.ok;
  const sold = r.sold;
  const battery = r.lowestSoc?.name;
  const fuse = m.fuseA;

  return html`
    <div class="view">
      ${head}
      ${state.error ? html`<div class="muted">${t("review.error", { message: state.error })}</div>` : nothing}
      ${bought
        ? html`<div class="summary">
            <b>${headline}</b>
            <span>
              ${r.avgBuyPrice !== null && r.avgPrice !== null
                ? html`${t("review.avg_vs", { paid: price(r.avgBuyPrice), avg: price(r.avgPrice) })}<b style="color: ${shareColor}"
                      >${t("review.share", { share: share !== null ? formatPercent(hass, share * 100) : "–" })}</b
                    >. `
                : nothing}
              ${sold
                ? sold.kwh >= 0.1
                  ? t("review.sold_for", { energy: formatEnergy(hass, sold.kwh), revenue: sold.revenue !== null ? money(sold.revenue) : "–" })
                  : t("review.nothing_sold")
                : nothing}
            </span>
          </div>`
        : nothing}

      <div class="review-tiles">
        ${bought
          ? html`<div class="stat"><span class="muted">${t("review.tile.bought")}</span><b>${formatEnergy(hass, bought.kwh)}</b>
              <span class="muted">${bought.cost !== null ? money(bought.cost) : ""}</span></div>`
          : nothing}
        ${sold
          ? html`<div class="stat"><span class="muted">${t("review.tile.sold")}</span><b>${formatEnergy(hass, sold.kwh)}</b>
              <span class="muted">${sold.revenue !== null && sold.kwh >= 0.1 ? money(sold.revenue) : ""}</span></div>`
          : nothing}
        ${r.solarKwh !== null
          ? html`<div class="stat" @click=${() => ctx.moreInfo(config.solar?.entity)}><span class="muted">${t("review.tile.solar")}</span>
              <b>${formatEnergy(hass, r.solarKwh)}</b><span class="muted"></span></div>`
          : nothing}
        ${r.lowestSoc
          ? html`<div class="stat"><span class="muted">${t("review.tile.lowest")}</span>
              <b>${formatPercent(hass, r.lowestSoc.v)}</b><span class="muted">${hhmm(r.lowestSoc.t)}</span></div>`
          : nothing}
      </div>

      ${r.prices.length || r.importBuckets.some(Number.isFinite) ? html`${chart(r, state.hours)}${legend(r, battery)}` : nothing}

      <div class="events">
        <span class="section-title">${t("review.what_happened")}</span>
        ${r.events.length
          ? r.events.map((e) => eventCard(ctx, e, unit, r.avgPrice))
          : html`<span class="muted">${t("review.nothing_happened")}</span>`}
      </div>

      ${r.peakImportW !== null || r.maxPhaseA !== null
        ? html`<div class="row review-footer">
            <span>
              ${r.peakImportW !== null ? t("review.peak", { power: formatPower(hass, r.peakImportW) }) : nothing}
              ${r.peakImportW !== null && r.maxPhaseA !== null ? " · " : nothing}
              ${r.maxPhaseA !== null
                ? t("review.phase", { amps: formatNumber(hass, r.maxPhaseA, 1), fuse: String(fuse) })
                : nothing}
            </span>
            ${r.maxPhaseA !== null
              ? html`<b style="color: ${r.maxPhaseA <= fuse ? VERDICT_COLORS.good : VERDICT_COLORS.ok}">
                  ${r.maxPhaseA <= fuse ? t("review.fuse_ok") : t("review.fuse_over")}
                </b>`
              : nothing}
          </div>`
        : nothing}
    </div>
  `;
};
