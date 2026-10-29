import { html, nothing, svg } from "lit";
import { formatEnergy, formatPercent, formatPower, readNumber } from "../hass";
import { COLORS } from "../model";
import { layoutSankey, spreadLabels, type SankeyNode } from "../sankey";
import { t } from "../strings";
import type { ViewContext } from "./context";

const HEAD_H = 22;
const SANKEY_H = 200;
const LEFT_X = 8; // right edge of the source bars
const RIGHT_X = 232; // left edge of the sink bars
const BAR_W = 8;
const LABEL_GAP = 15;

const ribbonPath = (y0: number, y1: number, y2: number, y3: number): string => {
  const mid = (LEFT_X + RIGHT_X) / 2;
  return `M${LEFT_X} ${y0} C${mid} ${y0} ${mid} ${y2} ${RIGHT_X} ${y2} L${RIGHT_X} ${y3} C${mid} ${y3} ${mid} ${y1} ${LEFT_X} ${y1} Z`;
};

/** Sources and uses for the Sankey, the batteries and today's totals - shared with the display snapshot. */
export const flowData = (ctx: ViewContext) => {
  const { hass, config, model: m } = ctx;

  // Inside-home batteries are already part of home consumption - leave them out.
  const flowBatteries = m.batteries.filter((b) => !b.insideHome);
  const sources: SankeyNode[] = [
    { key: "solar", label: t("node.solar"), value: m.solarW, color: COLORS.solar },
    { key: "grid", label: t("node.grid"), value: m.gridImportW, color: COLORS.grid },
    ...flowBatteries.map((b, i) => ({
      key: `battery-${i}`,
      label: b.name,
      value: Math.max(-b.powerW, 0),
      color: COLORS.battery,
    })),
  ];
  const sinks: SankeyNode[] = [
    ...m.running.map((l) => ({ key: l.entity, label: l.name, value: l.powerW, color: l.color })),
    { key: "rest", label: t("rest_of_home"), value: m.restW, color: "#C9D0D6" },
    ...m.loads.map((l) => ({ key: l.entity, label: l.name, value: l.powerW, color: "#C9D0D6" })),
    ...flowBatteries.map((b, i) => ({
      key: `charge-${i}`,
      label: t("flow.charging", { name: b.name }),
      value: Math.max(b.powerW, 0),
      color: COLORS.battery,
    })),
    { key: "export", label: t("flow.export"), value: m.gridExportW, color: COLORS.grid },
  ];

  const stats = [
    { label: t("today.solar"), value: readNumber(hass, config.solar?.today_energy) },
    { label: t("today.import"), value: readNumber(hass, config.grid?.today_import) },
    { label: t("today.export"), value: readNumber(hass, config.grid?.today_export) },
  ]
    .filter((s) => s.value !== null)
    .map((s) => ({ label: s.label, value: formatEnergy(hass, s.value as number) }));

  const batteries = m.batteries.map((b) => ({
    name: b.name,
    state:
      b.powerW > 0
        ? t("battery.charging", { power: formatPower(hass, b.powerW) })
        : b.powerW < 0
          ? t("battery.discharging", { power: formatPower(hass, b.powerW) })
          : t("battery.idle"),
    soc: b.soc,
    socText: b.soc === null ? "–" : formatPercent(hass, b.soc),
    color: b.soc !== null && b.soc < 30 ? COLORS.batteryLow : COLORS.battery,
    entity: b.stateOfChargeEntity,
  }));
  return { sources, sinks, stats, batteries };
};

export const renderFlow = (ctx: ViewContext) => {
  const { hass } = ctx;
  const { sources, sinks, stats, batteries } = flowData(ctx);
  const layout = layoutSankey(sources, sinks, SANKEY_H, 6);

  const leftLabels = spreadLabels(layout.sources.map((b) => HEAD_H + b.y + b.height / 2), LABEL_GAP);
  const rightLabels = spreadLabels(layout.sinks.map((b) => HEAD_H + b.y + b.height / 2), LABEL_GAP);
  const svgH = Math.max(HEAD_H + SANKEY_H, ...leftLabels.map((y) => y + 8), ...rightLabels.map((y) => y + 8));

  return html`
    <div class="view">
      ${layout.ribbons.length
        ? html`
            <svg class="sankey" viewBox="0 0 400 ${svgH}" role="img" aria-label="${t("flow.sources")} → ${t("flow.uses")}">
              <text class="head" x="0" y="12">${t("flow.sources").toUpperCase()}</text>
              <text class="head" x=${RIGHT_X} y="12">${t("flow.uses").toUpperCase()}</text>
              ${layout.ribbons.map(
                (r) => svg`<path d=${ribbonPath(HEAD_H + r.y0, HEAD_H + r.y1, HEAD_H + r.y2, HEAD_H + r.y3)}
                  fill=${r.color} fill-opacity="0.35"></path>`,
              )}
              ${layout.sources.map(
                (b, i) => svg`
                  <rect x="0" y=${HEAD_H + b.y} width=${BAR_W} height=${Math.max(b.height, 1)} rx="2" fill=${b.color}></rect>
                  <text x=${LEFT_X + 6} y=${leftLabels[i] + 4}>${b.label} ${formatPower(hass, b.value)}</text>`,
              )}
              ${layout.sinks.map(
                (b, i) => svg`
                  <rect x=${RIGHT_X} y=${HEAD_H + b.y} width=${BAR_W} height=${Math.max(b.height, 1)} rx="2" fill=${b.color}></rect>
                  <text x=${RIGHT_X + BAR_W + 6} y=${rightLabels[i] + 4}>${b.label} ${formatPower(hass, b.value)}</text>`,
              )}
            </svg>
          `
        : html`<div class="muted">${t("flow.nothing")}</div>`}

      ${batteries.length
        ? html`
            <div class="battery-bars">
              ${batteries.map(
                (b) => html`<div class="battery-bar" @click=${() => ctx.moreInfo(b.entity)}>
                  <div class="row">
                    <span><b>${b.name}</b> · ${b.state}</span>
                    <b>${b.socText}</b>
                  </div>
                  <div class="track">
                    <span style="width: ${b.soc ?? 0}%; background: ${b.color}"></span>
                  </div>
                </div>`,
              )}
            </div>
          `
        : nothing}

      ${stats.length
        ? html`<div class="stats">
            ${stats.map((s) => html`<div class="stat"><span class="muted">${s.label}</span><b>${s.value}</b></div>`)}
          </div>`
        : nothing}
    </div>
  `;
};
