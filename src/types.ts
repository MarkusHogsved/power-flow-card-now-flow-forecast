// Minimal Home Assistant types - only what the card reads.
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  locale?: { language?: string };
  language?: string;
}

export type ViewName = "now" | "flow" | "forecast";

export interface SolarConfig {
  /** Solar production power (W/kW). */
  entity: string;
  /** Energy produced today (kWh). */
  today_energy?: string;
  /** Total forecast for tomorrow (kWh), e.g. Solcast "forecast tomorrow". */
  forecast_tomorrow?: string;
  /**
   * Entities carrying a `detailedForecast` attribute (Solcast today/tomorrow).
   * Used to find the hour when solar takes over from the batteries.
   */
  forecast_entities?: string[];
}

export interface GridConfig {
  /** Grid power. Positive = import, negative = export (flip with invert_state). */
  entity: string;
  invert_state?: boolean;
  /** Current electricity price. */
  price?: string;
  today_import?: string;
  today_export?: string;
}

export interface BatteryConfig {
  name?: string;
  icon?: string;
  /** State of charge (%). */
  state_of_charge: string;
  /** Battery power. Positive = charging, negative = discharging (flip with invert_state). */
  entity?: string;
  invert_state?: boolean;
  /** Usable capacity in kWh - enables "will the battery last" in Forecast. */
  capacity_kwh?: number;
  /** SOC the battery never goes below (%), default 0. */
  reserve_soc?: number;
}

export interface LoadConfig {
  name?: string;
  icon?: string;
  /** Power entity (W/kW). */
  entity: string;
  /** Large loads only: shown in "Running now" at or above this power (W). Default 30. */
  threshold?: number;
  color?: string;
}

export interface LoadCastConfig {
  /** LoadCast "forecast next 24 h" sensor (attribute `forecast`). */
  forecast: string;
  /** LoadCast "forecast error yesterday" sensor (%). */
  error?: string;
}

export interface CardConfig {
  type: string;
  default_view?: ViewName;
  /** Key for remembering the last view on this device (one per card on a dashboard). */
  view_key?: string;
  home: { entity: string };
  solar?: SolarConfig;
  grid?: GridConfig;
  batteries?: BatteryConfig[];
  /** Loads that only appear when running (EV, water heater, heat pump, washing machine ...). */
  large_loads?: LoadConfig[];
  /** Always-on loads listed under "Other" (garage, workshop ...). */
  loads?: LoadConfig[];
  /** Phase currents L1-L3 (A). */
  phases?: string[];
  /** Main fuse (A), default 25. */
  fuse_current?: number;
  loadcast?: LoadCastConfig;
}
