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

export const friendlyName = (hass: HomeAssistant, entityId: string): string =>
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

export const formatPercent = (hass: HomeAssistant, value: number): string =>
  `${formatNumber(hass, Math.round(value), 0)} %`;
