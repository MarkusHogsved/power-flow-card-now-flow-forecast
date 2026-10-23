import { html, nothing, svg } from "lit";
import { formatEnergy, formatNumber, formatPercent, formatPower, readNumber } from "../hass";
import { expectedImportKwh, readLoadCast, readSolarP10ByHour } from "../forecast";
import { COLORS, type BatteryState, type LoadState } from "../model";
import { t } from "../strings";
import type { ViewContext } from "./context";

// Geometry of the diagram in a 400 x 372 box (nodes are placed in % of it).
const BOX_W = 400;
const BOX_H = 372;
const pct = (v: number, of: number): string => `${(v / of) * 100}%`;

const PATHS = {
  solarToHome: "M201 76 C201 150 260 170 316 170",
  solarToBattery: "M201 76 L201 262",
  solarToGrid: "M201 76 C201 150 140 172 76 172",
  gridToHome: "M76 172 L316 172",
  gridToBattery: "M38 210 C38 290 60 314 92 314",
  batteryToHome: "M310 314 C345 314 358 280 358 212",
  batteryToGrid: "M92 314 C60 314 38 290 38 210",
};

/** Thicker and faster with more power, capped at 5 kW. */
const strokeWidth = (w: number): number => 2 + 6 * Math.min(w, 5000) / 5000;
const dotSeconds = (w: number): number => 1.5 + 4.5 * (1 - Math.min(w, 5000) / 5000);

const flowLine = (path: string, watts: number, color: string) =>
  watts > 0
    ? svg`<path d=${path} stroke=${color} stroke-width=${strokeWidth(watts)} stroke-linecap="round" fill="none"></path>
        <circle r="3.5" fill="var(--primary-text-color, #eceff2)">
          <animateMotion dur=${`${dotSeconds(watts)}s`} repeatCount="indefinite" path=${path}></animateMotion>
        </circle>`
    : nothing;

const idleLine = (path: string) =>
  svg`<path d=${path} stroke="var(--nff-track)" stroke-width="1.5" stroke-dasharray="4 5" fill="none"></path>`;

const batteryColor = (b: BatteryState): string => (b.soc !== null && b.soc < 30 ? COLORS.batteryLow : COLORS.battery);

// Same arrows as the bank header: up = out of the battery, down = into it.
const arrow = (b: BatteryState): string => (b.powerW < 0 ? " ↑" : b.powerW > 0 ? " ↓" : "");

const cell = (ctx: ViewContext, b: BatteryState) => html`
  <div
    class="cell"
    @click=${() => ctx.moreInfo(b.stateOfChargeEntity)}
    title="${b.name}${b.powerW ? ` · ${formatPower(ctx.hass, b.powerW)}` : ""}"
  >
    <div class="cell-icon"><span style="height: ${b.soc ?? 0}%; background: ${batteryColor(b)}"></span></div>
    <span>
      <b>${b.soc === null ? "–" : formatPercent(ctx.hass, b.soc)}</b><b style="color: ${COLORS.battery}">${arrow(b)}</b><br />
      <span class="muted">${b.name}</span>
    </span>
  </div>
`;

const loadTile = (ctx: ViewContext, l: LoadState) => html`
  <div class="load-tile" style="border-top-color: ${l.color}" @click=${() => ctx.moreInfo(l.entity)}>
    <ha-icon .icon=${l.icon} style="color: ${l.color}"></ha-icon>
    <span class="muted" style="font-size: 12px">${l.name}</span>
    <b style="font-size: 14px">${formatPower(ctx.hass, l.powerW)}</b>
  </div>
`;

export const renderNow = (ctx: ViewContext) => {
  const { hass, config, model: m } = ctx;
  const f = m.flows;
  const hasSolar = !!config.solar;
  const hasGrid = !!config.grid;
  const hasBatteries = m.batteries.length > 0;
  // Bank header: all batteries, inside-home ones too - discharge and charge
  // separately, since a net figure hides one battery charging another.
  const bankOut = m.batteries.reduce((s, b) => s + Math.max(-b.powerW, 0), 0);
  const bankIn = m.batteries.reduce((s, b) => s + Math.max(b.powerW, 0), 0);
  const solarToday = readNumber(hass, config.solar?.today_energy);
  const solarForecast = readNumber(hass, config.solar?.forecast_today);
  const gridToday = readNumber(hass, config.grid?.today_import);
  const gridCost = readNumber(hass, config.grid?.today_cost);
  // Expected further purchases until midnight, from LoadCast (needs its forecast)
  const demand = readLoadCast(hass, config.loadcast?.forecast, ctx.now);
  const midnight = new Date(ctx.now);
  midnight.setHours(24, 0, 0, 0);
  const gridExpected = demand.length
    ? expectedImportKwh(demand, readSolarP10ByHour(hass, config.solar?.forecast_entities), m.batteries, ctx.now, midnight)
    : null;
  const costUnit = String(hass.states[config.grid?.today_cost ?? ""]?.attributes?.unit_of_measurement ?? "");

  return html`
    <div class="view">
      <div class="diagram">
        <svg class="lines" viewBox="0 0 ${BOX_W} ${BOX_H}" aria-hidden="true">
          ${hasSolar ? idleLine(PATHS.solarToHome) : nothing}
          ${hasGrid ? idleLine(PATHS.gridToHome) : nothing}
          ${hasSolar && hasBatteries ? idleLine(PATHS.solarToBattery) : nothing}
          ${flowLine(PATHS.solarToHome, f.solarToHome, COLORS.solar)}
          ${flowLine(PATHS.solarToBattery, f.solarToBattery, COLORS.solar)}
          ${flowLine(PATHS.solarToGrid, f.solarToGrid, COLORS.solar)}
          ${flowLine(PATHS.gridToHome, f.gridToHome, COLORS.grid)}
          ${flowLine(PATHS.gridToBattery, f.gridToBattery, COLORS.grid)}
          ${flowLine(PATHS.batteryToHome, f.batteryToHome, COLORS.battery)}
          ${flowLine(PATHS.batteryToGrid, f.batteryToGrid, COLORS.battery)}
        </svg>

        ${hasSolar
          ? html`
              <div
                class="node ${m.solarW > 0 ? "active" : "idle"}"
                style="left: ${pct(163, BOX_W)}; top: 0; width: ${pct(76, BOX_W)}; border-color: ${m.solarW > 0 ? COLORS.solar : ""}"
                @click=${() => ctx.moreInfo(config.solar?.entity)}
              >
                <ha-icon icon="mdi:solar-power-variant" style="color: ${COLORS.solar}"></ha-icon>
                <span>${formatPower(hass, m.solarW)}</span>
              </div>
              <div class="node-label" style="left: ${pct(250, BOX_W)}; top: ${pct(14, BOX_H)}">
                ${t("node.solar")}${solarToday !== null
                  ? html`<br />${t("solar.today", { energy: formatEnergy(hass, solarToday) })}`
                  : nothing}${solarForecast !== null
                  ? html`<br /><span @click=${() => ctx.moreInfo(config.solar?.forecast_today)}
                      >${t("solar.forecast_today", { energy: formatEnergy(hass, solarForecast) })}</span
                    >`
                  : nothing}
              </div>
            `
          : nothing}
        ${hasGrid
          ? html`
              <div
                class="node ${m.gridImportW + m.gridExportW > 0 ? "active" : "idle"}"
                style="left: 0; top: ${pct(134, BOX_H)}; width: ${pct(76, BOX_W)}; border-color: ${m.gridImportW + m.gridExportW > 0 ? COLORS.grid : ""}"
                @click=${() => ctx.moreInfo(config.grid?.entity)}
              >
                <ha-icon icon="mdi:transmission-tower" style="color: ${COLORS.grid}"></ha-icon>
                <span>${m.gridExportW > 0 ? "← " : ""}${formatPower(hass, m.gridImportW || m.gridExportW)}</span>
              </div>
              <div class="node-label grid-label" style="left: 0; top: ${pct(216, BOX_H)}">
                ${t("node.grid")}${gridToday !== null || gridCost !== null ? html`<br />` : nothing}${gridToday !== null
                  ? html`<span @click=${() => ctx.moreInfo(config.grid?.today_import)}
                      >${t("grid.today", { energy: formatEnergy(hass, gridToday) })}</span
                    >`
                  : nothing}${gridToday !== null && gridCost !== null ? " · " : nothing}${gridCost !== null
                  ? html`<span @click=${() => ctx.moreInfo(config.grid?.today_cost)}
                      >${`${formatNumber(hass, gridCost, gridCost < 10 ? 2 : 0)}${costUnit ? ` ${costUnit}` : ""}`}</span
                    >`
                  : nothing}${gridExpected !== null
                  ? html`<br /><span @click=${() => ctx.moreInfo(config.loadcast?.forecast)}
                      >${t("grid.expected", { energy: formatEnergy(hass, gridExpected) })}</span
                    >`
                  : nothing}
              </div>
            `
          : nothing}
        <div
          class="node active"
          style="left: ${pct(316, BOX_W)}; top: ${pct(128, BOX_H)}; width: ${pct(84, BOX_W)}; border: 3px solid var(--primary-text-color)"
          @click=${() => ctx.moreInfo(config.home.entity)}
        >
          <ha-icon icon="mdi:home"></ha-icon>
          <span style="font-size: 15px; font-weight: 700">${formatPower(hass, m.homeW)}</span>
        </div>
        ${hasBatteries
          ? html`
              <div
                class="bank"
                style="left: ${pct(92, BOX_W)}; top: ${pct(262, BOX_H)}; width: ${pct(218, BOX_W)}; min-height: ${pct(104, BOX_H)}"
              >
                <div class="row">
                  <span class="muted" style="font-size: 12px; font-weight: 600">${t("node.batteries")}</span>
                  <b style="font-size: 13px; color: ${COLORS.battery}">
                    ${bankOut > 0 ? `↑ ${formatPower(hass, bankOut)}` : ""}${bankOut > 0 && bankIn > 0 ? "  " : ""}${bankIn > 0
                      ? `↓ ${formatPower(hass, bankIn)}`
                      : ""}${bankOut + bankIn === 0 ? formatPower(hass, 0) : ""}
                  </b>
                </div>
                <div class="bank-cells">${m.batteries.map((b) => cell(ctx, b))}</div>
              </div>
            `
          : nothing}
      </div>

      ${m.running.length
        ? html`
            <div class="section-title">${t("running_now")}</div>
            <div class="running">${m.running.map((l) => loadTile(ctx, l))}</div>
          `
        : nothing}

      ${m.loads.length
        ? html`
            <div class="section-title">${t("other")}</div>
            <div class="others">
              <div class="row"><span>${t("rest_of_home")}</span><b>${formatPower(hass, m.restW)}</b></div>
              ${m.loads.map(
                (l) => html`<div class="row" @click=${() => ctx.moreInfo(l.entity)}>
                  <span>${l.name}</span><b>${formatPower(hass, l.powerW)}</b>
                </div>`,
              )}
            </div>
          `
        : nothing}

      ${m.phases.length
        ? html`
            <div class="phases">
              <span class="muted">${t("fuse", { amps: String(m.fuseA) })}</span>
              ${m.phases.map(
                (p) => html`<span class="phase">
                  ${p.name}
                  <span class="track small">
                    <span
                      style="width: ${Math.min(Math.abs(p.amps ?? 0) / m.fuseA, 1) * 100}%; background: ${Math.abs(p.amps ?? 0) > m.fuseA * 0.88 ? "#E57F84" : COLORS.grid}"
                    ></span>
                  </span>
                  ${p.amps === null ? "–" : `${formatNumber(hass, Math.abs(p.amps), 1)} A`}
                </span>`,
              )}
            </div>
          `
        : nothing}
    </div>
  `;
};
