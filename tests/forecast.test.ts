import { describe, expect, test } from "vitest";
import { netDemandKwh, readLoadCast, readSolarP10ByHour, solarTakeoverIndex, sumKwh, usableBatteryKwh } from "../src/forecast";
import type { BatteryState } from "../src/model";
import { makeHass } from "./helpers";

const NOW = new Date("2026-10-20T21:20:00+02:00");

// LoadCast 20/10 21:00: 24 hours, roughly 1.6-3.2 kWh per hour.
const KWH = [1.74, 1.73, 1.64, 1.56, 1.66, 1.92, 1.96, 1.92, 1.85, 1.93, 2.29, 2.1, 1.92, 1.96, 2.49, 3.16, 3.16, 2.65, 2.1, 1.68, 1.55, 1.63, 1.67, 1.66];
const hourIso = (i: number) => new Date(new Date("2026-10-20T21:00:00+02:00").getTime() + i * 3_600_000).toISOString();
const loadcast = [
  { period_start: new Date(new Date("2026-10-20T20:00:00+02:00")).toISOString(), kwh: 9, kwh_p10: 9, kwh_p90: 9 },
  ...KWH.map((kwh, i) => ({ period_start: hourIso(i), kwh, kwh_p10: kwh * 0.6, kwh_p90: kwh * 1.6 })),
];

const hass = makeHass({ "sensor.loadcast": ["47.9", { forecast: loadcast, ready: true }] });

describe("readLoadCast", () => {
  test("starts at the current hour and skips past hours", () => {
    const hours = readLoadCast(hass, "sensor.loadcast", NOW);
    expect(hours).toHaveLength(24);
    expect(hours[0].kwh).toBe(1.74);
  });

  test("missing entity or attribute gives no hours", () => {
    expect(readLoadCast(hass, undefined, NOW)).toEqual([]);
    expect(readLoadCast(makeHass({ "sensor.x": "1" }), "sensor.x", NOW)).toEqual([]);
  });
});

describe("solar takeover", () => {
  const hours = readLoadCast(hass, "sensor.loadcast", NOW);

  // Solcast half-hours (kW): P10 reaches 5 kW from 11:00 the next day.
  const periods = Array.from({ length: 48 }, (_, i) => {
    const start = new Date("2026-10-21T00:00:00+02:00");
    start.setMinutes(i * 30);
    const hour = start.getHours();
    return { period_start: start.toISOString(), pv_estimate10: hour >= 11 && hour < 15 ? 5 : hour >= 8 && hour < 11 ? 1 : 0 };
  });
  const solar = makeHass({ "sensor.solcast_tomorrow": ["13.6", { detailedForecast: periods }] });

  test("first hour where P10 covers the forecast demand", () => {
    const idx = solarTakeoverIndex(hours, readSolarP10ByHour(solar, ["sensor.solcast_tomorrow"]));
    expect(idx).not.toBeNull();
    expect(hours[idx!].start.getHours()).toBe(11);
  });

  test("demand until takeover is the sum of the hours before it", () => {
    const idx = solarTakeoverIndex(hours, readSolarP10ByHour(solar, ["sensor.solcast_tomorrow"]))!;
    expect(sumKwh(hours, idx)).toBeCloseTo(KWH.slice(0, 14).reduce((s, v) => s + v, 0));
  });

  test("no solar data -> no takeover", () => {
    expect(solarTakeoverIndex(hours, new Map())).toBeNull();
  });

  test("net demand subtracts solar per hour and never goes negative", () => {
    const pv = readSolarP10ByHour(solar, ["sensor.solcast_tomorrow"]);
    const net = netDemandKwh(hours, pv);
    // 08-11 solar covers 1 kWh/h, 11-15 all of it; nothing else
    const covered = hours.reduce((s, h) => {
      const hr = h.start.getHours();
      return s + (hr >= 11 && hr < 15 ? h.kwh : hr >= 8 && hr < 11 ? 1 : 0);
    }, 0);
    expect(net).toBeCloseTo(sumKwh(hours) - covered);
    expect(netDemandKwh(hours, new Map())).toBeCloseTo(sumKwh(hours));
  });
});

describe("usableBatteryKwh", () => {
  const battery = (soc: number | null, capacityKwh: number | null, reserveSoc = 0): BatteryState => ({
    name: "b",
    icon: "",
    soc,
    powerW: 0,
    capacityKwh,
    reserveSoc,
    stateOfChargeEntity: "sensor.b",
    insideHome: false,
  });

  test("energy above the reserve, batteries without capacity ignored", () => {
    expect(usableBatteryKwh([battery(82, 60, 10), battery(86, null)])).toBeCloseTo(43.2);
  });

  test("below the reserve counts as empty, not negative", () => {
    expect(usableBatteryKwh([battery(5, 60, 10)])).toBe(0);
  });

  test("no capacity anywhere -> null", () => {
    expect(usableBatteryKwh([battery(50, null)])).toBeNull();
  });
});
