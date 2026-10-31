import { html, nothing, svg } from "lit";
import {
  chartScale,
  cheapestBlock,
  currentPriceIndex,
  pricePeriodMs,
  readPrices,
  chargeByHour,
  netDemandKwh,
  peakIndex,
  readChargePlan,
  readLoadCast,
  readSolarByHour,
  readSolarP10ByHour,
  solarTakeoverIndex,
  sumKwh,
  usableBatteryKwh,
  vehicleByHour,
  type ForecastHour,
  type SolarHour,
} from "../forecast";
import { formatEnergy, formatNumber, formatPercent, formatUntil, readNumber } from "../hass";
import { COLORS } from "../model";
import { t } from "../strings";
import type { ViewContext } from "./context";

const W = 400;
const PLOT_H = 76;
const SVG_H = 96;

const hh = (d: Date): string => String(d.getHours()).padStart(2, "0");

/** Dashed grid lines with their value (kWh per hour) at the right edge. */
const grid = (ticks: number[], y: (v: number) => number) =>
  ticks.map(
    (v) => svg`
      <line x1="0" y1=${y(v).toFixed(1)} x2=${W} y2=${y(v).toFixed(1)} stroke="var(--nff-track)" stroke-dasharray="3 4"></line>
      <text x=${W} y=${(y(v) - 2).toFixed(1)} text-anchor="end">${t("forecast.axis", { value: String(v) })}</text>
    `,
  );

/** A vehicle's planned charging on top of the home demand, per hour. */
export interface VehicleLayer {
  kwh: number[];
  color: string;
}

const chart = (hours: ForecastHour[], ev: VehicleLayer | null, charge: number[] | null) => {
  const evTop = (i: number) => hours[i].kwh + (ev?.kwh[i] ?? 0);
  const top = (i: number) => evTop(i) + (charge?.[i] ?? 0);
  const scale = chartScale(Math.max(...hours.map((h, i) => Math.max(h.p90, top(i)))));
  const max = scale.max;
  const step = W / hours.length;
  const x = (i: number) => step / 2 + step * i;
  const y = (v: number) => PLOT_H - (v / max) * PLOT_H;
  const line = hours.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(h.kwh).toFixed(1)}`).join(" ");
  const band =
    hours.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(h.p90).toFixed(1)}`).join(" ") +
    " " +
    hours
      .map((h, i) => ({ h, i }))
      .reverse()
      .map(({ h, i }) => `L${x(i).toFixed(1)} ${y(h.p10).toFixed(1)}`)
      .join(" ") +
    " Z";
  // Stepped: the car charges in whole hours, a smooth line would suggest it ramps.
  const stepped = (lo: (i: number) => number, hi: (i: number) => number) =>
    hours
      .map((_, i) => {
        const x0 = (step * i).toFixed(1);
        const x1 = (step * (i + 1)).toFixed(1);
        return hi(i) - lo(i) > 0.001
          ? `M${x0} ${y(lo(i)).toFixed(1)} L${x0} ${y(hi(i)).toFixed(1)} L${x1} ${y(hi(i)).toFixed(1)} L${x1} ${y(lo(i)).toFixed(1)} Z`
          : "";
      })
      .join(" ");
  const evArea = ev ? stepped((i) => hours[i].kwh, evTop) : "";
  // Grid charging of the batteries on top: it is bought on top of the demand
  const chargeArea = charge ? stepped(evTop, top) : "";
  const peak = peakIndex(hours);
  const peakEnd = new Date(hours[peak].start.getTime() + 3_600_000);
  const ticks = hours
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i > 1 && h.start.getHours() % 6 === 0);

  return svg`
    <svg class="chart" viewBox="0 0 ${W} ${SVG_H}" role="img" aria-label=${t("forecast.title")}>
      ${grid(scale.ticks, y)}
      <path d=${band} fill=${COLORS.demand} fill-opacity="0.2"></path>
      ${evArea && ev ? svg`<path d=${evArea} fill=${ev.color} fill-opacity="0.55"></path>` : nothing}
      ${chargeArea ? svg`<path d=${chargeArea} fill=${COLORS.battery} fill-opacity="0.6"></path>` : nothing}
      <path d=${line} fill="none" stroke=${COLORS.demand} stroke-width="2" stroke-linejoin="round"></path>
      <line x1="0" y1=${PLOT_H + 0.5} x2=${W} y2=${PLOT_H + 0.5} stroke="var(--nff-track)"></line>
      <circle cx=${x(0)} cy=${y(hours[0].kwh)} r="3.5" fill=${COLORS.demand}></circle>
      <text x=${Math.min(x(peak) + 8, W - 70)} y="10">${t("forecast.peak", { from: hh(hours[peak].start), to: hh(peakEnd) })}</text>
      <text x="0" y=${SVG_H - 2}>${t("forecast.now")}</text>
      ${ticks.map(({ h, i }) => svg`<text x=${x(i) - 7} y=${SVG_H - 2}>${hh(h.start)}</text>`)}
    </svg>
  `;
};

/** Solcast for the same hours: P50 as a filled curve, P10-P90 as a band. */
const solarChart = (hours: ForecastHour[], solar: SolarHour[]) => {
  const scale = chartScale(Math.max(...solar.map((s) => s.p90)));
  const max = scale.max;
  const step = W / hours.length;
  const x = (i: number) => step / 2 + step * i;
  const y = (v: number) => PLOT_H - (v / max) * PLOT_H;
  const path = (pick: (s: SolarHour) => number) =>
    solar.map((s, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(pick(s)).toFixed(1)}`).join(" ");
  const band =
    path((s) => s.p90) +
    " " +
    solar
      .map((s, i) => ({ s, i }))
      .reverse()
      .map(({ s, i }) => `L${x(i).toFixed(1)} ${y(s.p10).toFixed(1)}`)
      .join(" ") +
    " Z";
  const area = `${path((s) => s.p50)} L${x(solar.length - 1).toFixed(1)} ${PLOT_H} L${x(0).toFixed(1)} ${PLOT_H} Z`;
  const ticks = hours
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i > 1 && h.start.getHours() % 6 === 0);
  return svg`
    <svg class="chart" viewBox="0 0 ${W} ${SVG_H}" role="img" aria-label=${t("forecast.solar_title")}>
      ${grid(scale.ticks, y)}
      <path d=${band} fill=${COLORS.solar} fill-opacity="0.18"></path>
      <path d=${area} fill=${COLORS.solar} fill-opacity="0.35"></path>
      <path d=${path((s) => s.p50)} fill="none" stroke=${COLORS.solar} stroke-width="2" stroke-linejoin="round"></path>
      <line x1="0" y1=${PLOT_H + 0.5} x2=${W} y2=${PLOT_H + 0.5} stroke="var(--nff-track)"></line>
      <text x="0" y=${SVG_H - 2}>${t("forecast.now")}</text>
      ${ticks.map(({ h, i }) => svg`<text x=${x(i) - 7} y=${SVG_H - 2}>${hh(h.start)}</text>`)}
    </svg>
  `;
};

/** Everything Forecast shows, computed once - shared with the display snapshot. */
export const forecastData = (ctx: ViewContext) => {
  const { hass, config, model: m, now } = ctx;
  const hours = readLoadCast(hass, config.loadcast?.forecast, now);
  const error = readNumber(hass, config.loadcast?.error);
  const solarTomorrow = readNumber(hass, config.solar?.forecast_tomorrow);

  const solarP10 = readSolarP10ByHour(hass, config.solar?.forecast_entities);
  const takeover = solarTakeoverIndex(hours, solarP10);
  const homeDemand = netDemandKwh(hours, solarP10, takeover ?? hours.length);
  const usable = usableBatteryKwh(m.batteries);

  // Vehicles below their limit: planned charging is bought from the grid (and
  // shown in the chart); without a plan the energy is counted against the batteries.
  const vehicles = m.vehicles
    .filter((v) => v.home !== false && (v.toLimitKwh ?? 0) > 0.5)
    .map((v) => {
      const plan = v.plan && v.plan.end > now ? v.plan : null;
      return { v, kwh: v.toLimitKwh as number, plan, byHour: plan ? vehicleByHour(hours, v.toLimitKwh as number, plan, now) : null };
    });
  const planned = vehicles.filter((x) => x.byHour);
  const evLayer: VehicleLayer | null = planned.length
    ? { kwh: hours.map((_, i) => planned.reduce((s, x) => s + (x.byHour as number[])[i], 0)), color: planned[0].v.color }
    : null;
  const unplannedKwh = vehicles.filter((x) => !x.plan).reduce((s, x) => s + x.kwh, 0);
  const evTotal = vehicles.reduce((s, x) => s + x.kwh, 0);
  const demand = homeDemand + unplannedKwh;
  const scale = Math.max(demand, usable ?? 0, 0.1);

  // Solcast per hour for the same hours (P50 for the chart)
  const solarMap = readSolarByHour(hass, config.solar?.forecast_entities);
  const solar = hours.length && hours.every((h) => solarMap.has(h.start.getTime()))
    ? hours.map((h) => solarMap.get(h.start.getTime()) as SolarHour)
    : hours.length && solarMap.size
      ? hours.map((h) => solarMap.get(h.start.getTime()) ?? { p10: 0, p50: 0, p90: 0 })
      : null;
  const solarTotal = solar ? solar.reduce((s, x) => s + x.p50, 0) : null;

  // Planned grid charging of the batteries
  const charges = config.battery_plan ? readChargePlan(hass, config.battery_plan, now) : null;
  const chargeLayer = charges?.some((w) => (w.kwh ?? 0) > 0) ? chargeByHour(hours, charges, now) : null;
  const plannedKwh = chargeLayer ? chargeLayer.reduce((s, v) => s + v, 0) : 0;
  // The verdict hour by hour up to solar takeover: charging only helps if it
  // comes before the batteries run out, and charging after takeover does not count
  const horizon = takeover ?? hours.length;
  // Room above the reserve: charging beyond it cannot be stored (Codex #34)
  const room = m.batteries
    .filter((b) => b.capacityKwh !== null && b.soc !== null)
    .reduce((sum, b) => sum + ((100 - b.reserveSoc) / 100) * (b.capacityKwh as number), 0);
  let level = (usable ?? 0) - unplannedKwh;
  let worst = level;
  let plannedInTime = 0;
  let runOut: Date | null = null;
  for (let i = 0; i < horizon; i++) {
    plannedInTime += chargeLayer?.[i] ?? 0;
    // The hour now running counts only for the part still ahead (Codex #35)
    const hourEnd = hours[i].start.getTime() + 3_600_000;
    const ahead = Math.min(Math.max((hourEnd - now.getTime()) / 3_600_000, 0), 1);
    const need = Math.max(hours[i].kwh - (solarP10.get(hours[i].start.getTime()) ?? 0), 0) * ahead;
    const before = level + (chargeLayer?.[i] ?? 0);
    level = Math.min(before - need, room);
    worst = Math.min(worst, level);
    if (level < 0 && runOut === null) {
      // Part way into the hour, when what was left is used up
      const from = Math.max(hours[i].start.getTime(), now.getTime());
      const frac = need > 0 ? Math.min(Math.max(before / need, 0), 1) : 0;
      runOut = new Date(from + frac * (hours[i].start.getTime() + 3_600_000 - from));
    }
  }
  const verdict =
    usable === null
      ? null
      : usable >= demand
        ? { ok: true, text: t("last.covered", { margin: formatEnergy(hass, usable - demand) }) }
        : plannedInTime > 0.5 && worst >= 0
          ? { ok: true, text: t("last.covered_planned", { planned: formatEnergy(hass, plannedInTime) }) }
          : plannedInTime > 0.5
            ? { ok: false, text: t("last.short_planned", { missing: formatEnergy(hass, -worst), planned: formatEnergy(hass, plannedInTime) }) }
            : { ok: false, text: t("last.short", { missing: formatEnergy(hass, demand - usable) }) };

  // Short and nothing (enough) planned: when the batteries run out, and the
  // cheapest grid charging that fits before then - a suggestion, not a plan
  const missing = verdict && !verdict.ok ? (plannedInTime > 0.5 ? -worst : demand - (usable ?? 0)) : 0;
  let suggestion: { runOut: Date; kwh: number; start: Date; end: Date; price: string } | { runOut: Date; kwh: number; start: null } | null = null;
  if (missing > 0.5 && runOut) {
    const prices = readPrices(hass, config.grid?.price, now);
    const step = pricePeriodMs(prices);
    const fits = prices.filter((p) => p.start.getTime() + step <= (runOut as Date).getTime());
    const cur = currentPriceIndex(fits, now);
    const from = cur < 0 ? 0 : now > fits[cur].start ? cur + 1 : cur;
    const kw = m.batteries.reduce((sum, b) => sum + (b.maxChargeKw ?? 0), 0);
    // Whole price periods, rounded up, so the block can deliver what it says (Codex #35)
    const stepH = step / 3_600_000;
    const needH = (kw > 0 ? Math.ceil(missing / kw / stepH - 1e-9) : Math.ceil(1 / stepH)) * stepH;
    const b = fits.length ? cheapestBlock(fits, from, needH) : null;
    const unit = String(hass.states[config.grid?.price ?? ""]?.attributes?.unit_of_measurement ?? "");
    suggestion = b
      ? {
          runOut,
          kwh: missing,
          start: fits[b.index].start,
          end: b.end,
          price: `${formatNumber(hass, b.avg, 2)}${unit ? ` ${unit}` : ""}`,
        }
      : { runOut, kwh: missing, start: null };
  }
  const at = (d: Date) => {
    const u = formatUntil(hass, d, now);
    return u.tomorrow ? t("forecast.tomorrow_at", { time: u.time }) : u.time;
  };
  return {
    hours, error, solarTomorrow, takeover, homeDemand, usable, vehicles, evLayer, evTotal, demand, scale, at,
    solar, solarTotal, charges, chargeLayer, plannedKwh, verdict, suggestion,
  };
};

export const renderForecast = (ctx: ViewContext) => {
  const { hass, config } = ctx;
  const {
    hours, error, solarTomorrow, takeover, homeDemand, usable, vehicles, evLayer, evTotal, scale, at,
    solar, solarTotal, charges, chargeLayer, plannedKwh, verdict, suggestion,
  } = forecastData(ctx);

  return html`
    <div class="view">
      <div class="row">
        <span class="section-title">${t("forecast.title")}</span>
        ${hours.length
          ? html`<b style="font-size: 13px">~${formatEnergy(hass, sumKwh(hours))}${evTotal > 0
              ? html` <span style="color: ${vehicles[0].v.color}">${t("forecast.plus_vehicle", { energy: formatEnergy(hass, evTotal) })}</span>`
              : nothing}${plannedKwh > 0.5
              ? html` <span style="color: ${COLORS.battery}">${t("forecast.plus_charge", { energy: formatEnergy(hass, plannedKwh) })}</span>`
              : nothing}</b>`
          : nothing}
      </div>
      ${hours.length
        ? html`
            ${chart(hours, evLayer, chargeLayer)}
            <span class="muted" style="font-size: 12px">
              ${t("forecast.band")}${error !== null
                ? html` · ${t("forecast.error", { value: `${formatNumber(hass, error, 1)} %` })}`
                : nothing}
            </span>
            ${solar
              ? html`
                  <div class="row">
                    <span class="section-title">${t("forecast.solar_title")}</span>
                    <b style="font-size: 13px; color: ${COLORS.solar}">~${formatEnergy(hass, solarTotal as number)}</b>
                  </div>
                  ${(solarTotal as number) > 0.05
                    ? html`${solarChart(hours, solar)}<span class="muted" style="font-size: 12px">${t("forecast.solar_band")}</span>`
                    : html`<span class="muted" style="font-size: 12px">${t("forecast.solar_none")}</span>`}
                `
              : nothing}

            <div class="section-title">${t("last.title")}</div>
            <div class="battery-bar">
              <div class="row">
                <span class="muted">
                  ${takeover !== null
                    ? t("last.demand_until", { hour: `${hh(hours[takeover].start)}:00` })
                    : t("last.demand_24h")}
                </span>
                <b>~${formatEnergy(hass, homeDemand)}</b>
              </div>
              <div class="track"><span style="width: ${(homeDemand / scale) * 100}%; background: ${COLORS.demand}"></span></div>
            </div>
            ${vehicles.map(
              (x) => html`
                <div class="battery-bar">
                  <div class="row">
                    <span class="muted">
                      ${t("last.vehicle", {
                        name: x.v.name,
                        soc: formatPercent(hass, x.v.soc as number),
                        limit: formatPercent(hass, x.v.socLimit as number),
                      })}
                      <br />${x.plan
                        ? t("last.vehicle_planned", { from: at(x.plan.start), to: at(x.plan.end) })
                        : t("last.vehicle_unplanned")}
                    </span>
                    <b style="color: ${x.v.color}">~${formatEnergy(hass, x.kwh)}</b>
                  </div>
                  ${x.plan
                    ? nothing
                    : html`<div class="track"><span style="width: ${(x.kwh / scale) * 100}%; background: ${x.v.color}"></span></div>`}
                </div>
              `,
            )}
            ${usable !== null
              ? html`
                  <div class="battery-bar">
                    <div class="row">
                      <span class="muted">${t("last.usable")}</span>
                      <b style="color: ${COLORS.battery}">${formatEnergy(hass, usable)}</b>
                    </div>
                    <div class="track"><span style="width: ${(usable / scale) * 100}%; background: ${COLORS.battery}"></span></div>
                  </div>
                  ${charges
                    ? charges.length
                      ? charges.map(
                          (w) => html`
                            <div class="battery-bar">
                              <div class="row">
                                <span class="muted">
                                  ${t("last.charge", { from: at(w.start), to: at(w.end) })}${w.name || w.targetSoc !== null
                                    ? html`<br />${t("last.charge_to", {
                                        name: w.name,
                                        soc: w.targetSoc !== null ? formatPercent(hass, w.targetSoc) : "?",
                                      })}`
                                    : nothing}
                                </span>
                                <b style="color: ${COLORS.battery}">${w.kwh !== null ? `~${formatEnergy(hass, w.kwh)}` : "?"}</b>
                              </div>
                            </div>
                          `,
                        )
                      : html`<div class="muted" style="font-size: 12px">${t("last.charge_none")}</div>`
                    : nothing}
                  <div class="verdict">${verdict?.text}</div>
                  ${suggestion
                    ? html`
                        <div class="battery-bar">
                          <div class="row">
                            <span class="muted">
                              ${suggestion.start
                                ? html`${t("last.suggest", { from: at(suggestion.start), to: at(suggestion.end) })}<br />${t(
                                      "last.suggest_sub",
                                      { runout: at(suggestion.runOut), price: suggestion.price },
                                    )}`
                                : t("last.runout", { runout: at(suggestion.runOut) })}
                            </span>
                            <b style="color: ${COLORS.battery}">~${formatEnergy(hass, suggestion.kwh)}</b>
                          </div>
                        </div>
                      `
                    : nothing}
                `
              : html`<div class="muted" style="font-size: 12px">${t("last.no_capacity")}</div>`}
          `
        : html`<div class="muted">${t("forecast.unavailable")}</div>`}

      ${solarTomorrow !== null
        ? html`<div class="tiles">
            <div class="tile" @click=${() => ctx.moreInfo(config.solar?.forecast_tomorrow)}>
              <span class="muted">${t("tile.solar_tomorrow")}</span>
              <b>~${formatEnergy(hass, solarTomorrow)}</b>
            </div>
          </div>`
        : nothing}
    </div>
  `;
};
