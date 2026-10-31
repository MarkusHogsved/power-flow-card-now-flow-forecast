import { friendlyName, readNumber, readPowerSumW, readPowerW } from "./hass";
import type { CardConfig, HomeAssistant, LoadConfig } from "./types";

/** Below this, a power reading counts as zero (W). */
export const IDLE_W = 30;
/** Grid/solar/battery must exceed this to drive the status line (W). */
const STATUS_W = 50;
const DEFAULT_LOAD_THRESHOLD_W = 30;

export const COLORS = {
  solar: "#F5B942",
  grid: "#6CA8E8",
  battery: "#4FC1B0",
  batteryLow: "#E0A93B",
  home: "var(--primary-text-color, #ECEFF2)",
  /** LoadCast's home demand forecast (line and band). */
  demand: "#B39DF0",
};

/** Palette for large loads without their own color, in config order. */
export const LOAD_PALETTE = ["#B39DF0", "#E0A93B", "#6CA8E8", "#E57F84", "#7FC97F", "#F0C05A"];

export interface BatteryState {
  name: string;
  icon: string;
  soc: number | null;
  /** Positive = charging, negative = discharging (W). */
  powerW: number;
  capacityKwh: number | null;
  reserveSoc: number;
  stateOfChargeEntity: string;
  /** Measured inside home consumption: shown, but left out of the flows. */
  insideHome: boolean;
}

export interface LoadState {
  name: string;
  icon: string;
  color: string;
  powerW: number;
  entity: string;
  /** Vehicles: battery level and charge limit (%), null when unknown. */
  soc?: number | null;
  /** The battery level entity, when the load is a vehicle. */
  socEntity?: string;
  socLimit?: number | null;
  /** Energy drawn to reach the limit (kWh, with losses); needs capacity_kwh. */
  toLimitKwh?: number | null;
  /** Price per kWh from `cost_price`, null when not configured or unavailable. */
  costPrice?: number | null;
  /** Cost of the session so far from `session_cost`, null when not configured or unavailable. */
  sessionCost?: number | null;
  /** Planned charging window from `charge_plan`, null when not set or unreadable. */
  plan?: { start: Date; end: Date } | null;
  /** False when `presence` says the vehicle is away. */
  home?: boolean;
}

/** Battery level, charge limit and energy still to draw for a load that is a vehicle. */
/** A date and time from an entity's state ("2026-10-27 19:45:00" or ISO), null if unreadable. */
const readDateTime = (hass: HomeAssistant, entityId: string | undefined): Date | null => {
  const s = entityId ? hass.states[entityId]?.state : undefined;
  if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s.includes("T") ? s : s.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
};

const vehicle = (hass: HomeAssistant, l: LoadConfig): Partial<LoadState> => {
  if (!l.soc) return {};
  const soc = readNumber(hass, l.soc);
  const socLimit = typeof l.soc_limit === "number" ? l.soc_limit : readNumber(hass, l.soc_limit);
  const toLimitKwh =
    soc !== null && socLimit !== null && l.capacity_kwh
      ? (Math.max(socLimit - soc, 0) / 100) * l.capacity_kwh / (l.charge_efficiency ?? 0.9)
      : null;
  const costPrice = l.cost_price ? readNumber(hass, l.cost_price) : null;
  const sessionCost = l.session_cost ? readNumber(hass, l.session_cost) : null;
  const start = readDateTime(hass, l.charge_plan?.[0]);
  const end = readDateTime(hass, l.charge_plan?.[1]);
  const plan = start && end && end > start ? { start, end } : null;
  const presence = l.presence === undefined ? [] : Array.isArray(l.presence) ? l.presence : [l.presence];
  const home = presence.every((id) => {
    const s = hass.states[id]?.state;
    return s === undefined || ["home", "on", "unknown", "unavailable"].includes(s);
  });
  return { soc, socEntity: l.soc, socLimit, toLimitKwh, costPrice, sessionCost, plan, home };
};

export interface Flows {
  solarToHome: number;
  solarToBattery: number;
  solarToGrid: number;
  gridToHome: number;
  gridToBattery: number;
  batteryToHome: number;
  batteryToGrid: number;
}

export type StatusKind = "importing" | "exporting" | "solar" | "battery" | "idle";

export interface Model {
  solarW: number;
  gridImportW: number;
  gridExportW: number;
  homeW: number;
  batteries: BatteryState[];
  /** Charge/discharge of the batteries in the flows (inside-home batteries excluded). */
  batteryChargeW: number;
  batteryDischargeW: number;
  /** Large loads at or above their threshold, highest power first. */
  running: LoadState[];
  /** Large loads that are a vehicle (have `soc`), running or not, in config order. */
  vehicles: LoadState[];
  /** Always-on loads, in config order. */
  loads: LoadState[];
  /** Home power not covered by any configured load. */
  restW: number;
  flows: Flows;
  status: StatusKind;
  price: number | null;
  priceUnit: string;
  phases: { name: string; amps: number | null }[];
  fuseA: number;
}

const positive = (w: number): number => (w > IDLE_W ? w : 0);

/** Splits measured powers into source-to-sink flows (solar first, then batteries, then grid). */
export const computeFlows = (p: {
  solarW: number;
  homeW: number;
  gridImportW: number;
  gridExportW: number;
  batteryChargeW: number;
  batteryDischargeW: number;
}): Flows => {
  const solarToHome = Math.min(p.solarW, p.homeW);
  const solarToBattery = Math.min(p.solarW - solarToHome, p.batteryChargeW);
  const solarToGrid = Math.min(Math.max(p.solarW - solarToHome - solarToBattery, 0), p.gridExportW);
  const batteryToHome = Math.min(p.batteryDischargeW, Math.max(p.homeW - solarToHome, 0));
  const batteryToGrid = Math.min(
    Math.max(p.batteryDischargeW - batteryToHome, 0),
    Math.max(p.gridExportW - solarToGrid, 0),
  );
  const gridToHome = Math.min(Math.max(p.homeW - solarToHome - batteryToHome, 0), p.gridImportW);
  const gridToBattery = Math.min(
    Math.max(p.batteryChargeW - solarToBattery, 0),
    Math.max(p.gridImportW - gridToHome, 0),
  );
  return { solarToHome, solarToBattery, solarToGrid, gridToHome, gridToBattery, batteryToHome, batteryToGrid };
};

export const computeStatus = (p: {
  solarW: number;
  homeW: number;
  gridImportW: number;
  gridExportW: number;
  batteryDischargeW: number;
}): StatusKind => {
  if (p.gridImportW > STATUS_W) return "importing";
  if (p.gridExportW > STATUS_W) return "exporting";
  if (p.solarW > STATUS_W && p.solarW >= p.homeW * 0.9) return "solar";
  if (p.batteryDischargeW > STATUS_W) return "battery";
  return "idle";
};

export const computeModel = (hass: HomeAssistant, config: CardConfig): Model => {
  const solarW = positive(readPowerW(hass, config.solar?.entity) ?? 0);
  const gridRaw = (readPowerW(hass, config.grid?.entity) ?? 0) * (config.grid?.invert_state ? -1 : 1);
  const gridImportW = positive(gridRaw);
  const gridExportW = positive(-gridRaw);
  const homeW = Math.max(readPowerW(hass, config.home.entity) ?? 0, 0);

  const batteries: BatteryState[] = (config.batteries ?? []).map((b) => {
    const signed =
      b.charge_entity !== undefined || b.discharge_entity !== undefined
        ? (readPowerSumW(hass, b.charge_entity) ?? 0) - (readPowerSumW(hass, b.discharge_entity) ?? 0)
        : (readPowerSumW(hass, b.entity) ?? 0);
    const raw = signed * (b.invert_state ? -1 : 1);
    return {
      name: b.name ?? friendlyName(hass, b.state_of_charge),
      icon: b.icon ?? "mdi:battery-outline",
      soc: readNumber(hass, b.state_of_charge),
      powerW: Math.abs(raw) > IDLE_W ? raw : 0,
      capacityKwh: b.capacity_kwh ?? null,
      reserveSoc: b.reserve_soc ?? 0,
      stateOfChargeEntity: b.state_of_charge,
      insideHome: b.inside_home ?? false,
    };
  });
  const inFlows = batteries.filter((b) => !b.insideHome);
  const batteryChargeW = inFlows.reduce((s, b) => s + Math.max(b.powerW, 0), 0);
  const batteryDischargeW = inFlows.reduce((s, b) => s + Math.max(-b.powerW, 0), 0);

  const toLoad = (l: NonNullable<CardConfig["loads"]>[number], i: number): LoadState => ({
    name: l.name ?? friendlyName(hass, l.entity),
    icon: l.icon ?? "mdi:flash",
    color: l.color ?? LOAD_PALETTE[i % LOAD_PALETTE.length],
    powerW: Math.max(readPowerW(hass, l.entity) ?? 0, 0),
    entity: l.entity,
    ...vehicle(hass, l),
  });
  const large = (config.large_loads ?? []).map((l, i) => ({
    state: toLoad(l, i),
    threshold: l.threshold ?? DEFAULT_LOAD_THRESHOLD_W,
  }));
  const running = large
    .filter((l) => l.state.powerW >= l.threshold)
    .map((l) => l.state)
    .sort((a, b) => b.powerW - a.powerW);
  const loads = (config.loads ?? []).map(toLoad);
  const measured = running.reduce((s, l) => s + l.powerW, 0) + loads.reduce((s, l) => s + l.powerW, 0);
  const restW = Math.max(homeW - measured, 0);

  const powers = { solarW, homeW, gridImportW, gridExportW, batteryChargeW, batteryDischargeW };
  const priceEntity = config.grid?.price;
  return {
    ...powers,
    batteries,
    running,
    vehicles: large.map((l) => l.state).filter((l) => l.soc !== undefined),
    loads,
    restW,
    flows: computeFlows(powers),
    status: computeStatus(powers),
    price: readNumber(hass, priceEntity),
    priceUnit: priceEntity ? String(hass.states[priceEntity]?.attributes?.unit_of_measurement ?? "") : "",
    phases: (config.phases ?? []).map((id, i) => ({ name: `L${i + 1}`, amps: readNumber(hass, id) })),
    fuseA: config.fuse_current ?? 25,
  };
};
