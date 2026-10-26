// Minimal Home Assistant types - only what the card reads.
export interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
}

export interface HomeAssistant {
  states: Record<string, HassEntity>;
  /** time_format: the profile's clock setting ("language", "system", "24" or "12"). */
  locale?: { language?: string; time_format?: string };
  language?: string;
  /** Websocket call - used by Review to read recorder history. */
  callWS?: <T>(msg: Record<string, unknown>) => Promise<T>;
}

export type ViewName = "now" | "flow" | "forecast" | "review";

export interface SolarConfig {
  /** Solar production power (W/kW). */
  entity: string;
  /** Energy produced today (kWh). */
  today_energy?: string;
  /** Total forecast for today (kWh), e.g. Solcast "forecast today". Shown at the solar node. */
  forecast_today?: string;
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
  /** Cost of the energy bought today, in its own currency unit (e.g. Tibber "accumulated cost"). */
  today_cost?: string;
  /**
   * Why the home is buying from the grid right now. The state is a short
   * reason; optional attributes `until` (ISO time the reason ends) and
   * `detail` (longer explanation). Shown under the header while importing.
   */
  import_reason?: string;
}

/** One entity, or several whose values are summed (e.g. two BMS packs). */
export type EntityList = string | string[];

export interface BatteryConfig {
  name?: string;
  icon?: string;
  /** State of charge (%). */
  state_of_charge: string;
  /** Battery power. Positive = charging, negative = discharging (flip with invert_state). */
  entity?: EntityList;
  /** Alternative to `entity`: separate charge and discharge power, both positive. */
  charge_entity?: EntityList;
  discharge_entity?: EntityList;
  invert_state?: boolean;
  /**
   * The battery charges from (and is measured inside) the home's own
   * consumption - e.g. a UPS plugged into a socket. Its level and power are
   * shown, but it is left out of the flows so it is not counted twice.
   */
  inside_home?: boolean;
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
