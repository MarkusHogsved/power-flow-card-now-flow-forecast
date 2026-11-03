import { html, nothing, svg } from "lit";
import { formatEnergy, formatPercent, formatPower, readNumber } from "../hass";
import { readLoadCast } from "../forecast";
import { COLORS, IDLE_W, loadIndexOf, type BatteryState, type LoadState, type Model } from "../model";
import { t } from "../strings";
import type { CardConfig } from "../types";
import type { ViewContext } from "./context";
import { nowFigures, phasesRow, vehicleLines } from "./now";
import { vehiclePanel } from "./vehicle";

// Now, tree layout: the sources above the home, the home's buildings below it
// and each running large load under the building it is measured in.

export interface TreeSource {
  kind: "solar" | "grid" | "battery";
  /** Power on the line to the home (W, always positive). */
  watts: number;
  /** True when it flows from the home out to the source (export, charging). */
  reverse: boolean;
}

export interface TreeBuilding {
  name: string;
  icon: string;
  /** Entity opened on click (the home's own entity for the house). */
  entity: string;
  powerW: number;
  /** Running large loads measured inside this building, highest power first. */
  children: LoadState[];
  /** The building's power not covered by its running children. */
  otherW: number;
}

export interface Tree {
  sources: TreeSource[];
  main: BatteryState | null;
  backups: BatteryState[];
  buildings: TreeBuilding[];
  /** Share of the home's power from each source (0..1). */
  mix: { solar: number; battery: number; grid: number };
}

/** The tree's content from the model: which line goes which way, and what sits under which building. */
export const computeTree = (config: CardConfig, m: Model): Tree => {
  const sources: TreeSource[] = [];
  if (config.solar) sources.push({ kind: "solar", watts: m.solarW, reverse: false });
  if (config.grid) {
    sources.push({ kind: "grid", watts: m.gridImportW || m.gridExportW, reverse: !m.gridImportW && m.gridExportW > 0 });
  }
  // Inside-home batteries charge from the home's own consumption, so they stay off the line (as in the flows)
  const main = m.batteries.find((b) => !b.insideHome) ?? m.batteries[0] ?? null;
  if (m.batteries.length) {
    const net = m.batteryChargeW - m.batteryDischargeW;
    sources.push({ kind: "battery", watts: Math.abs(net) > IDLE_W ? Math.abs(net) : 0, reverse: net > IDLE_W });
  }

  const houseChildren = m.running.filter((l) => loadIndexOf(m.loads, l.under) < 0);
  const metered = m.loads.reduce((s, l) => s + l.powerW, 0);
  const building = (name: string, icon: string, entity: string, powerW: number, children: LoadState[]): TreeBuilding => ({
    name,
    icon,
    entity,
    powerW,
    children,
    otherW: Math.max(powerW - children.reduce((s, l) => s + l.powerW, 0), 0),
  });
  const buildings = [
    building(
      config.home.name ?? t("tree.house"),
      config.home.icon ?? "mdi:home",
      config.home.entity,
      Math.max(m.homeW - metered, 0),
      houseChildren,
    ),
    ...m.loads.map((l, i) =>
      building(
        l.name,
        config.loads?.[i]?.icon ?? "mdi:home-outline",
        l.entity,
        l.powerW,
        m.running.filter((r) => loadIndexOf(m.loads, r.under) === i),
      ),
    ),
  ];

  const f = m.flows;
  const total = f.solarToHome + f.batteryToHome + f.gridToHome;
  const share = (w: number) => (total > 0 ? w / total : 0);
  return {
    sources,
    main,
    backups: m.batteries.filter((b) => b !== main),
    buildings,
    mix: { solar: share(f.solarToHome), battery: share(f.batteryToHome), grid: share(f.gridToHome) },
  };
};

/** LoadCast's forecast for the whole of tomorrow (kWh), null unless every hour of it is covered. */
export const loadCastTomorrowKwh = (ctx: ViewContext): number | null => {
  const start = new Date(ctx.now);
  start.setHours(24, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const hours = readLoadCast(ctx.hass, ctx.config.loadcast?.forecast, ctx.now, 72).filter(
    (h) => h.start >= start && h.start < end,
  );
  const covered = (end.getTime() - start.getTime()) / 3_600_000; // 23 or 25 on a DST day
  return hours.length >= covered ? hours.reduce((s, h) => s + h.kwh, 0) : null;
};

/** Thicker and faster with more power, capped at 5 kW (as in the classic diagram). */
const strokeWidth = (w: number): number => 2 + 6 * Math.min(w, 5000) / 5000;
const dashSeconds = (w: number): number => 0.6 + 2.4 * (1 - Math.min(w, 5000) / 5000);

/** A line in a stretched viewBox: stroke and dashes keep their pixel size. */
const line = (d: string, watts: number, color: string, reverse = false) =>
  watts > 0
    ? svg`<path d=${d} stroke=${color} stroke-width=${strokeWidth(watts)} stroke-linecap="round" fill="none" vector-effect="non-scaling-stroke"></path>
        <path class="tree-dash${reverse ? " rev" : ""}" d=${d} stroke="var(--card-background-color, #1c1c1c)" stroke-width=${Math.max(strokeWidth(watts) / 2.5, 1.5)}
          fill="none" vector-effect="non-scaling-stroke" style="animation-duration: ${dashSeconds(watts)}s"></path>`
    : svg`<path d=${d} stroke="var(--nff-track)" stroke-width="1.5" stroke-dasharray="4 5" fill="none" vector-effect="non-scaling-stroke"></path>`;

const SOURCE_WEIGHT = { solar: 1, grid: 1, battery: 1.8 };
const SOURCE_GAP = 3; // % between source boxes (the row's gap in styles.ts)
const SOURCE_COLOR = { solar: COLORS.solar, grid: COLORS.grid, battery: COLORS.battery };

/** Left edge and width of each source box, in % of the row. */
export const sourceSlots = (sources: TreeSource[]): { left: number; width: number }[] => {
  const weights = sources.map((s) => SOURCE_WEIGHT[s.kind]);
  const sum = weights.reduce((a, b) => a + b, 0);
  const free = 100 - SOURCE_GAP * Math.max(sources.length - 1, 0);
  let left = 0;
  return weights.map((w) => {
    const slot = { left, width: (free * w) / sum };
    left += slot.width + SOURCE_GAP;
    return slot;
  });
};

const batteryColor = (b: BatteryState): string => (b.soc !== null && b.soc < 30 ? COLORS.batteryLow : COLORS.battery);
const arrow = (b: BatteryState): string => (b.powerW < 0 ? " ↑" : b.powerW > 0 ? " ↓" : "");

// The box tells the main battery's own power; the line carries all batteries outside the home
const batteryBox = (ctx: ViewContext, tree: Tree) => {
  const { hass } = ctx;
  const b = tree.main as BatteryState;
  const state = b.powerW === 0 ? t("tree.idle") : `${b.powerW > 0 ? "↓" : "↑"} ${formatPower(hass, b.powerW)}`;
  return html`
    <div class="tree-battery">
      <div class="row" @click=${() => ctx.moreInfo(b.stateOfChargeEntity)}>
        <span class="tree-name"><ha-icon .icon=${b.icon} style="color: ${COLORS.battery}"></ha-icon>${b.name}</span>
        <span class="muted tree-small">${state}</span>
      </div>
      <div class="tree-soc" @click=${() => ctx.moreInfo(b.stateOfChargeEntity)}>
        <span class="track"><span style="width: ${b.soc ?? 0}%; background: ${batteryColor(b)}"></span></span>
        <b>${b.soc === null ? "–" : formatPercent(hass, b.soc)}</b>
      </div>
      ${b.capacityKwh ? html`<span class="muted tree-small">${t("tree.main_battery", { energy: formatEnergy(hass, b.capacityKwh) })}</span>` : nothing}
      ${tree.backups.length
        ? html`<div class="tree-backups">
            ${tree.backups.map(
              (x) => html`<span
                @click=${() => ctx.moreInfo(x.stateOfChargeEntity)}
                title="${x.name}${x.powerW ? ` · ${formatPower(hass, x.powerW)}` : ""}"
                >${x.name} <b>${x.soc === null ? "–" : formatPercent(hass, x.soc)}</b><b style="color: ${COLORS.battery}">${arrow(x)}</b></span
              >`,
            )}
          </div>`
        : nothing}
    </div>
  `;
};

const sourceBox = (ctx: ViewContext, tree: Tree, src: TreeSource, slot: { left: number; width: number }) => {
  const { hass, config } = ctx;
  const fig = nowFigures(ctx);
  const color = SOURCE_COLOR[src.kind];
  const style = `width: ${slot.width}%; border-color: ${src.watts > 0 ? color : ""}`;
  if (src.kind === "battery") return html`<div class="tree-source wide" style=${style}>${batteryBox(ctx, tree)}</div>`;
  const solar = src.kind === "solar";
  // Tomorrow at a glance: solar forecast under Solar, the home's forecast use (LoadCast) under Grid
  const tomorrow = solar ? readNumber(hass, config.solar?.forecast_tomorrow) : loadCastTomorrowKwh(ctx);
  return html`
    <div
      class="tree-source ${src.watts > 0 ? "active" : "idle"}"
      style=${style}
      @click=${() => ctx.moreInfo(solar ? config.solar?.entity : config.grid?.entity)}
    >
      <ha-icon icon=${solar ? "mdi:solar-power-variant" : "mdi:transmission-tower"} style="color: ${color}"></ha-icon>
      <b>${formatPower(hass, src.watts)}</b>
      <span class="muted tree-small">
        ${solar ? t("node.solar") : src.reverse ? t("tree.grid_export") : t("node.grid")}
      </span>
      ${solar
        ? fig.solarToday !== null
          ? html`<span class="muted tree-small">${fig.solarToday}</span>`
          : nothing
        : fig.gridToday !== null
          ? html`<span class="muted tree-small">${fig.gridToday}${fig.gridCost !== null ? ` · ${fig.gridCost}` : ""}</span>`
          : nothing}
      ${tomorrow !== null
        ? html`<span
            class="muted tree-small"
            @click=${(e: Event) => {
              e.stopPropagation();
              ctx.moreInfo(solar ? config.solar?.forecast_tomorrow : config.loadcast?.forecast);
            }}
            >${t(solar ? "tree.solar_tomorrow" : "tree.use_tomorrow", { energy: formatEnergy(hass, tomorrow) })}</span
          >`
        : nothing}
    </div>
  `;
};

const childTile = (ctx: ViewContext, l: LoadState) => html`
  <svg class="tree-stem" viewBox="0 0 10 14" preserveAspectRatio="none" aria-hidden="true">${line("M5 0 L5 14", l.powerW, l.color)}</svg>
  <div
    class="tree-load"
    style="border-color: ${l.color}"
    aria-expanded=${l.socEntity ? (ctx.vehicle?.entity === l.entity ? "true" : "false") : nothing}
    @click=${() => (l.socEntity ? ctx.toggleVehicle(l.entity) : ctx.moreInfo(l.entity))}
  >
    <span class="tree-name" style="color: ${l.color}"><ha-icon .icon=${l.icon}></ha-icon>${l.name}</span>
    <b>${formatPower(ctx.hass, l.powerW)}</b>
    ${vehicleLines(ctx, l)}
  </div>
`;

const buildingColumn = (ctx: ViewContext, b: TreeBuilding, first: boolean) => html`
  <div class="tree-col">
    <div class="tree-building ${b.powerW > IDLE_W ? "active" : "idle"}${first ? " house" : ""}" @click=${() => ctx.moreInfo(b.entity)}>
      <span class="tree-name"><ha-icon .icon=${b.icon}></ha-icon>${b.name}</span>
      <b>${formatPower(ctx.hass, b.powerW)}</b>
    </div>
    ${b.children.map((l) => childTile(ctx, l))}
    ${b.children.length && b.otherW > IDLE_W
      ? html`<div class="tree-other"><span class="muted">${t("tree.other")}</span><b>${formatPower(ctx.hass, b.otherW)}</b></div>`
      : nothing}
  </div>
`;

export const renderTree = (ctx: ViewContext) => {
  const { hass, model: m } = ctx;
  const tree = computeTree(ctx.config, m);
  const slots = sourceSlots(tree.sources);
  const n = tree.buildings.length;
  // Each source line ends on the hub's top edge, pulled in towards its middle
  const hubEnd = (center: number) => 50 + (center - 50) * 0.45;

  return html`
    <div class="view">
      <div class="tree">
        ${tree.sources.length
          ? html`
              <div class="tree-sources">${tree.sources.map((s, i) => sourceBox(ctx, tree, s, slots[i]))}</div>
              <svg class="tree-band" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
                ${tree.sources.map((s, i) => {
                  const x = slots[i].left + slots[i].width / 2;
                  const e = hubEnd(x);
                  return line(`M${x} 0 C${x} 22 ${e} 18 ${e} 40`, s.watts, SOURCE_COLOR[s.kind], s.reverse);
                })}
              </svg>
            `
          : nothing}
        <div class="tree-hub" @click=${() => ctx.moreInfo(ctx.config.home.entity)}>
          <ha-icon icon="mdi:home-lightning-bolt-outline"></ha-icon>
          <span>
            <span class="muted tree-small">${t("tree.home_uses")}</span><br />
            <b class="tree-hub-power">${formatPower(hass, m.homeW)}</b>
          </span>
          <span class="tree-mix" aria-hidden="true">
            <span style="flex: ${tree.mix.solar}; background: ${COLORS.solar}"></span>
            <span style="flex: ${tree.mix.battery}; background: ${COLORS.battery}"></span>
            <span style="flex: ${tree.mix.grid}; background: ${COLORS.grid}"></span>
          </span>
        </div>
        <svg class="tree-band" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
          ${tree.buildings.map((b, i) => {
            const x = ((i + 0.5) / n) * 100;
            return line(`M50 0 C50 20 ${x} 16 ${x} 36`, b.powerW > IDLE_W ? b.powerW : 0, COLORS.home);
          })}
        </svg>
        <div class="tree-buildings" style="grid-template-columns: repeat(${n}, minmax(0, 1fr))">
          ${tree.buildings.map((b, i) => buildingColumn(ctx, b, i === 0))}
        </div>
      </div>

      ${m.stopped.length
        ? html`<div class="tree-off">
            <span class="muted tree-small">${t("tree.off")}</span>
            <div>
              ${m.stopped.map(
                (l) => html`<span @click=${() => (l.socEntity ? ctx.toggleVehicle(l.entity) : ctx.moreInfo(l.entity))}
                  ><ha-icon .icon=${l.icon}></ha-icon>${l.name}</span
                >`,
              )}
            </div>
          </div>`
        : nothing}
      ${[...m.running, ...m.stopped].map((l) => vehiclePanel(ctx, l, ctx.vehicle))}
      ${phasesRow(ctx)}
    </div>
  `;
};
