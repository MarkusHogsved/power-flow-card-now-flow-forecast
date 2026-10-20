import type { CardConfig, HomeAssistant } from "../src/types";

type StateSpec = string | [string, Record<string, unknown>];

/** Builds a minimal hass object. A plain string state gets unit W. */
export const makeHass = (states: Record<string, StateSpec>): HomeAssistant => ({
  locale: { language: "en" },
  states: Object.fromEntries(
    Object.entries(states).map(([id, spec]) => {
      const [state, attributes] = typeof spec === "string" ? [spec, { unit_of_measurement: "W" }] : spec;
      return [id, { entity_id: id, state, attributes }];
    }),
  ),
});

/** The author's house as an example configuration (all entities configurable). */
export const houseConfig: CardConfig = {
  type: "custom:power-flow-card-now-flow-forecast",
  home: { entity: "sensor.home" },
  solar: { entity: "sensor.solar", today_energy: "sensor.solar_today", forecast_tomorrow: "sensor.solar_tomorrow" },
  grid: { entity: "sensor.grid", price: "sensor.price", today_import: "sensor.import_today", today_export: "sensor.export_today" },
  batteries: [
    { name: "Growatt", state_of_charge: "sensor.growatt_soc", entity: "sensor.growatt_power", capacity_kwh: 60, reserve_soc: 10 },
    { name: "Victron", state_of_charge: "sensor.victron_soc", entity: "sensor.victron_power" },
    { name: "Anker", state_of_charge: "sensor.anker_soc", entity: "sensor.anker_charge", inside_home: true },
  ],
  large_loads: [
    { name: "EV", entity: "sensor.ev", icon: "mdi:car-electric", threshold: 100 },
    { name: "Water heater", entity: "sensor.water_heater", icon: "mdi:water-boiler" },
    { name: "Washing machine", entity: "sensor.washer", icon: "mdi:washing-machine", threshold: 30 },
  ],
  loads: [
    { name: "Garage", entity: "sensor.garage" },
    { name: "Workshop", entity: "sensor.workshop" },
  ],
  phases: ["sensor.l1", "sensor.l2", "sensor.l3"],
  loadcast: { forecast: "sensor.loadcast", error: "sensor.loadcast_error" },
};

/** 20/10 evening: the house runs on the batteries, nothing bought or sold. */
export const eveningStates: Record<string, StateSpec> = {
  "sensor.home": "1951",
  "sensor.solar": "0",
  "sensor.grid": "0",
  "sensor.growatt_soc": ["82", { unit_of_measurement: "%" }],
  "sensor.growatt_power": "-1686",
  "sensor.victron_soc": ["86", { unit_of_measurement: "%" }],
  "sensor.victron_power": "-265",
  "sensor.anker_soc": ["31", { unit_of_measurement: "%" }],
  "sensor.anker_charge": "0",
  "sensor.ev": "0",
  "sensor.water_heater": "0",
  "sensor.washer": "2.5",
  "sensor.garage": "83",
  "sensor.workshop": "87",
  "sensor.price": ["1.227", { unit_of_measurement: "SEK/kWh" }],
  "sensor.l1": ["1.9", { unit_of_measurement: "A" }],
  "sensor.l2": ["1.0", { unit_of_measurement: "A" }],
  "sensor.l3": ["1.6", { unit_of_measurement: "A" }],
  "sensor.solar_today": ["35.1", { unit_of_measurement: "kWh" }],
  "sensor.solar_tomorrow": ["13.6", { unit_of_measurement: "kWh" }],
  "sensor.import_today": ["46.2", { unit_of_measurement: "kWh" }],
  "sensor.export_today": ["7.2", { unit_of_measurement: "kWh" }],
  "sensor.loadcast_error": ["9.6", { unit_of_measurement: "%" }],
};
