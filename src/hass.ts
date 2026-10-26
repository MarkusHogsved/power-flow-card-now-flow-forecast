import type { HomeAssistant } from "./types";

/** Numeric state, or null when the entity is missing, unknown or unavailable. */
export const readNumber = (hass: HomeAssistant, entityId: string | undefined): number | null => {
  if (!entityId) return null;
  const state = hass.states[entityId]?.state;
  if (state === undefined || state === "" || state === "unknown" || state === "unavailable") return null;
  const value = Number(state);
  return Number.isFinite(value) ? value : null;
};

const POWER_FACTORS: Record<string, number> = { w: 1, kw: 1000, mw: 1_000_000 };

/** Power in watts, converting kW/MW by the entity's unit_of_measurement. */
export const readPowerW = (hass: HomeAssistant, entityId: string | undefined): number | null => {
  const value = readNumber(hass, entityId);
  if (value === null || !entityId) return null;
  const unit = String(hass.states[entityId]?.attributes?.unit_of_measurement ?? "W").toLowerCase();
  return value * (POWER_FACTORS[unit] ?? 1);
};

/** Sum of one or several power entities in W; null if none of them has a value. */
export const readPowerSumW = (hass: HomeAssistant, entities: string | string[] | undefined): number | null => {
  const ids = entities === undefined ? [] : Array.isArray(entities) ? entities : [entities];
  const values = ids.map((id) => readPowerW(hass, id)).filter((v): v is number => v !== null);
  return values.length ? values.reduce((s, v) => s + v, 0) : null;
};

export const friendlyName =(hass: HomeAssistant, entityId: string): string =>
  String(hass.states[entityId]?.attributes?.friendly_name ?? entityId);

const locale = (hass: HomeAssistant): string => hass.locale?.language ?? hass.language ?? "en";

export const formatNumber = (hass: HomeAssistant, value: number, decimals: number): string =>
  new Intl.NumberFormat(locale(hass), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);

/** "870 W" below 1 kW, "1.95 kW" above (2 decimals under 10 kW, 1 above). */
export const formatPower = (hass: HomeAssistant, watts: number): string => {
  const w = Math.abs(watts);
  if (w < 1000) return `${formatNumber(hass, Math.round(w), 0)} W`;
  const kw = w / 1000;
  return `${formatNumber(hass, kw, kw < 10 ? 2 : 1)} kW`;
};

export const formatEnergy = (hass: HomeAssistant, kwh: number): string =>
  `${formatNumber(hass, kwh, kwh < 10 ? 1 : 0)} kWh`;

/** Clock time ("12:00"), with "tomorrow" when the time is on a later day than `now`. */
export const formatUntil = (hass: HomeAssistant, until: Date, now: Date): { time: string; tomorrow: boolean } => ({
  time: new Intl.DateTimeFormat(locale(hass), { hour: "2-digit", minute: "2-digit" }).format(until),
  tomorrow: until.toDateString() !== now.toDateString() && until > now,
});

export const formatPercent = (hass: HomeAssistant, value: number): string =>
  `${formatNumber(hass, Math.round(value), 0)} %`;
