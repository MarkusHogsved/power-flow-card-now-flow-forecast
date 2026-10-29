import { html, nothing, svg } from "lit";
import {
  netDemandKwh,
  peakIndex,
  readLoadCast,
  readSolarP10ByHour,
  solarTakeoverIndex,
  sumKwh,
  usableBatteryKwh,
  vehicleByHour,
  type ForecastHour,
} from "../forecast";
import { formatEnergy, formatNumber, formatPercent, formatUntil, readNumber } from "../hass";
import { COLORS } from "../model";
import { t } from "../strings";
import type { ViewContext } from "./context";

const W = 400;
const PLOT_H = 76;
const SVG_H = 96;

const hh = (d: Date): string => String(d.getHours()).padStart(2, "0");

/** A vehicle's planned charging on top of the home demand, per hour. */
export interface VehicleLayer {
  kwh: number[];
  color: string;
}

const chart = (hours: ForecastHour[], ev: VehicleLayer | null) => {
  const top = (i: number) => hours[i].kwh + (ev?.kwh[i] ?? 0);
  const max = Math.max(...hours.map((h, i) => Math.max(h.p90, top(i))), 0.1) * 1.08;
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
  const evArea = ev
    ? hours
        .map((h, i) => {
          const x0 = (step * i).toFixed(1);
          const x1 = (step * (i + 1)).toFixed(1);
          return ev.kwh[i] > 0
            ? `M${x0} ${y(h.kwh).toFixed(1)} L${x0} ${y(top(i)).toFixed(1)} L${x1} ${y(top(i)).toFixed(1)} L${x1} ${y(h.kwh).toFixed(1)} Z`
            : "";
        })
        .join(" ")
    : "";
  const peak = peakIndex(hours);
  const peakEnd = new Date(hours[peak].start.getTime() + 3_600_000);
  const ticks = hours
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => i > 1 && h.start.getHours() % 6 === 0);

  return svg`
    <svg class="chart" viewBox="0 0 ${W} ${SVG_H}" role="img" aria-label=${t("forecast.title")}>
      <path d=${band} fill="#9AA3AB" fill-opacity="0.18"></path>
      ${evArea && ev ? svg`<path d=${evArea} fill=${ev.color} fill-opacity="0.55"></path>` : nothing}
      <path d=${line} fill="none" stroke="var(--primary-text-color, #eceff2)" stroke-width="2" stroke-linejoin="round"></path>
      <line x1="0" y1=${PLOT_H + 0.5} x2=${W} y2=${PLOT_H + 0.5} stroke="var(--nff-track)"></line>
      <circle cx=${x(0)} cy=${y(hours[0].kwh)} r="3.5" fill="var(--primary-text-color, #eceff2)"></circle>
      <text x=${Math.min(x(peak) + 8, W - 70)} y="10">${t("forecast.peak", { from: hh(hours[peak].start), to: hh(peakEnd) })}</text>
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
  const at = (d: Date) => {
    const u = formatUntil(hass, d, now);
    return u.tomorrow ? t("forecast.tomorrow_at", { time: u.time }) : u.time;
  };
  return { hours, error, solarTomorrow, takeover, homeDemand, usable, vehicles, evLayer, evTotal, demand, scale, at };
};

export const renderForecast = (ctx: ViewContext) => {
  const { hass, config } = ctx;
  const { hours, error, solarTomorrow, takeover, homeDemand, usable, vehicles, evLayer, evTotal, demand, scale, at } =
    forecastData(ctx);

  return html`
    <div class="view">
      <div class="row">
        <span class="section-title">${t("forecast.title")}</span>
        ${hours.length
          ? html`<b style="font-size: 13px">~${formatEnergy(hass, sumKwh(hours))}${evTotal > 0
              ? html` <span style="color: ${vehicles[0].v.color}">${t("forecast.plus_vehicle", { energy: formatEnergy(hass, evTotal) })}</span>`
              : nothing}</b>`
          : nothing}
      </div>
      ${hours.length
        ? html`
            ${chart(hours, evLayer)}
            <span class="muted" style="font-size: 12px">
              ${t("forecast.band")}${error !== null
                ? html` · ${t("forecast.error", { value: `${formatNumber(hass, error, 1)} %` })}`
                : nothing}
            </span>

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
              <div class="track"><span style="width: ${(homeDemand / scale) * 100}%; background: var(--primary-text-color)"></span></div>
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
                  <div class="verdict">
                    ${usable >= demand
                      ? t("last.covered", { margin: formatEnergy(hass, usable - demand) })
                      : t("last.short", { missing: formatEnergy(hass, demand - usable) })}
                  </div>
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
