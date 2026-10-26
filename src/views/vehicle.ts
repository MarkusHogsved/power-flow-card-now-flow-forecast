import { html, nothing, svg } from "lit";
import { formatPercent, formatPower } from "../hass";
import { COLORS, type LoadState } from "../model";
import type { Series } from "../review";
import { t } from "../strings";
import type { ViewContext } from "./context";

/** History shown when a vehicle tile is unfolded. */
export const VEHICLE_HOURS = 12;

export interface VehicleChartState {
  /** The load's power entity (identifies the tile). */
  entity: string;
  loading: boolean;
  start?: number;
  end?: number;
  power?: Series;
  soc?: Series;
  error?: string;
}

const W = 400;
const PLOT_H = 110;
const SVG_H = PLOT_H + 16;

/** Step points (value holds until the next change) clipped to [start, end], NaN as a gap. */
const steps = (s: Series, start: number, end: number): Series => {
  const sorted = [...s].sort((a, b) => a.t - b.t);
  const before = sorted.filter((p) => p.t <= start).pop();
  const inside = sorted.filter((p) => p.t > start && p.t <= end);
  return [...(before ? [{ t: start, v: before.v }] : []), ...inside];
};

const chart = (st: VehicleChartState, l: LoadState, powerFactor: number) => {
  const start = st.start as number;
  const end = st.end as number;
  const x = (ms: number) => ((ms - start) / (end - start)) * W;
  const power = steps(st.power ?? [], start, end).map((p) => ({ t: p.t, v: p.v * powerFactor }));
  const soc = steps(st.soc ?? [], start, end);
  const maxW = Math.max(...power.map((p) => p.v).filter(Number.isFinite), 1000) * 1.1;
  const yPower = (v: number) => PLOT_H - (v / maxW) * (PLOT_H - 4);
  const ySoc = (v: number) => PLOT_H - (v / 100) * PLOT_H;

  let area = `M0 ${PLOT_H}`;
  power.forEach((p, i) => {
    const v = Number.isFinite(p.v) ? Math.max(p.v, 0) : 0;
    const next = i + 1 < power.length ? power[i + 1].t : end;
    area += ` L${x(p.t).toFixed(1)} ${yPower(v).toFixed(1)} L${x(next).toFixed(1)} ${yPower(v).toFixed(1)}`;
  });
  area += ` L${W} ${PLOT_H} Z`;

  let line = "";
  let pen = false;
  soc.forEach((p, i) => {
    if (!Number.isFinite(p.v)) {
      pen = false;
      return;
    }
    const next = i + 1 < soc.length ? soc[i + 1].t : end;
    line += `${pen ? "L" : "M"}${x(p.t).toFixed(1)} ${ySoc(p.v).toFixed(1)} L${x(next).toFixed(1)} ${ySoc(p.v).toFixed(1)} `;
    pen = true;
  });

  const ticks: number[] = [];
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  for (let h = first.getTime() + 3_600_000; h < end; h += 3_600_000) {
    if (new Date(h).getHours() % 2 === 0) ticks.push(h);
  }

  return svg`
    <svg class="chart" viewBox="0 0 ${W} ${SVG_H}" role="img" aria-label=${t("vehicle.chart")}>
      <path d=${area} fill=${l.color} fill-opacity="0.25" stroke=${l.color} stroke-width="1.2" stroke-linejoin="round"></path>
      ${l.socLimit != null
        ? svg`<line x1="0" x2=${W} y1=${ySoc(l.socLimit).toFixed(1)} y2=${ySoc(l.socLimit).toFixed(1)}
            stroke=${COLORS.battery} stroke-opacity="0.6" stroke-width="1" stroke-dasharray="3 4"></line>`
        : nothing}
      ${line ? svg`<path d=${line} fill="none" stroke=${COLORS.battery} stroke-width="2" stroke-linejoin="round"></path>` : nothing}
      ${ticks.map((h) => svg`<text x=${(x(h) - 7).toFixed(1)} y=${SVG_H - 1}>${String(new Date(h).getHours()).padStart(2, "0")}</text>`)}
    </svg>
  `;
};

/** The unfolded vehicle panel: power and battery level over the last hours. */
export const vehiclePanel = (ctx: ViewContext, l: LoadState, st: VehicleChartState | undefined) => {
  if (!st || st.entity !== l.entity) return nothing;
  const { hass } = ctx;
  const unit = String(hass.states[l.entity]?.attributes?.unit_of_measurement ?? "W").toLowerCase();
  const factor = unit === "kw" ? 1000 : unit === "mw" ? 1_000_000 : 1;
  const ready = st.start !== undefined && st.end !== undefined;
  return html`
    <div class="vehicle-panel">
      <div class="row">
        <span class="muted" style="font-size: 12px">${t("vehicle.title", { name: l.name, hours: String(VEHICLE_HOURS) })}</span>
        <span class="legend">
          <span style="color: ${l.color}">■ ${formatPower(hass, l.powerW)}</span>
          ${l.soc != null ? html`<span style="color: ${COLORS.battery}">━ ${formatPercent(hass, l.soc)}</span>` : nothing}
        </span>
      </div>
      ${ready
        ? chart(st, l, factor)
        : html`<div class="muted">${st.error ? t("review.error", { message: st.error }) : t("review.loading")}</div>`}
      ${ready && st.error ? html`<div class="muted">${t("review.error", { message: st.error })}</div>` : nothing}
      <div class="vehicle-links">
        <button type="button" @click=${() => ctx.moreInfo(l.entity)}>${t("vehicle.power_history")}</button>
        ${l.socEntity ? html`<button type="button" @click=${() => ctx.moreInfo(l.socEntity)}>${t("vehicle.soc_history")}</button>` : nothing}
      </div>
    </div>
  `;
};
