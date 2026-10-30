import { describe, expect, test } from "vitest";
import { cheapestBlock, expectedImportKwh, netDemandKwh, readLoadCast, readSolarP10ByHour, readUpcomingPrices, solarTakeoverIndex, sumKwh, usableBatteryKwh, vehicleByHour } from "../src/forecast";
import type { BatteryState } from "../src/model";
import { niceStep, stepDecimals } from "../src/snapshot";
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

describe("expectedImportKwh", () => {
  const H = 3_600_000;
  const at = (h: number) => new Date(2026, 9, 23, h, 0);
  const hours = (from: number, kwh: number[]) =>
    kwh.map((k, i) => ({ start: at(from + i), kwh: k, p10: k, p90: k }));
  const battery = (soc: number) => ({
    name: "B", icon: "", soc, powerW: 0, capacityKwh: 60, reserveSoc: 10, stateOfChargeEntity: "s", insideHome: false,
  });

  test("a battery that covers the evening means nothing more from the grid", () => {
    expect(expectedImportKwh(hours(20, [2, 2, 2, 2]), new Map(), [battery(91)], at(20), at(24))).toBe(0);
  });

  test("shortfall beyond the reserve comes from the grid", () => {
    // 6 kWh above the 10 % reserve, 8 kWh needed
    expect(expectedImportKwh(hours(20, [2, 2, 2, 2]), new Map(), [battery(20)], at(20), at(24))).toBeCloseTo(2);
  });

  test("only the part of the current hour still ahead counts, and nothing after midnight", () => {
    const now = new Date(at(22).getTime() + H / 2);
    expect(expectedImportKwh(hours(22, [2, 2, 5]), new Map(), [], now, at(24))).toBeCloseTo(3);
  });

  test("a solar surplus refills the battery for later hours", () => {
    const solar = new Map([[at(12).getTime(), 6]]);
    // 12: +4 kWh into an empty battery, 13: 3 kWh drawn from it
    expect(expectedImportKwh(hours(12, [2, 3]), solar, [battery(10)], at(12), at(24))).toBe(0);
  });
});

describe("vehicleByHour", () => {
  const hours = [0, 1, 2, 3].map((h) => ({ start: new Date(2026, 9, 27, 19 + h), kwh: 1, p10: 1, p90: 1 }));
  test("spreads the energy evenly over the planned window", () => {
    // 19:45-23:00 = 3.25 h; 30 kWh
    const kwh = vehicleByHour(hours, 30, { start: new Date(2026, 9, 27, 19, 45), end: new Date(2026, 9, 27, 23) }, new Date(2026, 9, 27, 19, 30));
    expect(kwh[0]).toBeCloseTo((30 * 0.25) / 3.25);
    expect(kwh[1]).toBeCloseTo(30 / 3.25);
    expect(kwh.reduce((a, b) => a + b, 0)).toBeCloseTo(30);
  });
  test("only the part of the window still ahead counts", () => {
    const kwh = vehicleByHour(hours, 10, { start: new Date(2026, 9, 27, 19), end: new Date(2026, 9, 27, 21) }, new Date(2026, 9, 27, 20));
    expect(kwh).toEqual([0, 10, 0, 0]);
  });
  test("a window that has ended gives nothing", () => {
    const kwh = vehicleByHour(hours, 10, { start: new Date(2026, 9, 27, 17), end: new Date(2026, 9, 27, 18) }, new Date(2026, 9, 27, 19));
    expect(kwh).toEqual([0, 0, 0, 0]);
  });
});

describe("readUpcomingPrices", () => {
  const quarters = (base: number) => Array.from({ length: 96 }, (_, i) => base + i / 100);

  test("today/tomorrow quarter lists: from the quarter that holds now, at most 12 h, over midnight", () => {
    const now = new Date(2026, 9, 30, 18, 20);
    const hass = makeHass({ "sensor.price": ["1", { today: quarters(1), tomorrow: quarters(2) }] });
    const p = readUpcomingPrices(hass, "sensor.price", now);
    expect(p).toHaveLength(48);
    expect(p[0].start).toEqual(new Date(2026, 9, 30, 18, 15));
    expect(p[0].value).toBeCloseTo(1 + 73 / 100);
    expect(p[47].start).toEqual(new Date(2026, 9, 31, 6, 0));
    expect(p[47].value).toBeCloseTo(2 + 24 / 100);
  });

  test("without tomorrow it stops at midnight", () => {
    const now = new Date(2026, 9, 30, 21, 0);
    const hass = makeHass({ "sensor.price": ["1", { today: quarters(1), tomorrow: [] }] });
    expect(readUpcomingPrices(hass, "sensor.price", now)).toHaveLength(12);
  });

  test("100 quarters on the day clocks go back: real 15-minute steps from midnight", () => {
    // 25/10 2026 in Stockholm (tests run with TZ=Europe/Stockholm): 02:00-03:00 twice
    const now = new Date("2026-10-25T03:10:00+01:00");
    const today = Array.from({ length: 100 }, (_, i) => i);
    const hass = makeHass({ "sensor.price": ["1", { today, tomorrow: [] }] });
    const p = readUpcomingPrices(hass, "sensor.price", now);
    // 03:00 CET is 4 h of real time after midnight CEST: quarter 16
    expect(p[0].value).toBe(16);
    expect(p[0].start.getTime()).toBe(new Date("2026-10-25T03:00:00+01:00").getTime());
  });

  test("25 hours on the day clocks go back: hourly steps", () => {
    const now = new Date("2026-10-25T03:10:00+01:00");
    const today = Array.from({ length: 25 }, (_, i) => i);
    const hass = makeHass({ "sensor.price": ["1", { today, tomorrow: [] }] });
    expect(readUpcomingPrices(hass, "sensor.price", now)[0].value).toBe(4);
  });

  test("explicit raw timestamps win over the plain lists", () => {
    const now = new Date(2026, 9, 30, 10, 30);
    const raw = Array.from({ length: 24 }, (_, h) => ({ start: new Date(2026, 9, 30, h).toISOString(), value: h }));
    const hass = makeHass({ "sensor.np": ["1", { today: Array(24).fill(99), raw_today: raw }] });
    expect(readUpcomingPrices(hass, "sensor.np", now)[0].value).toBe(10);
  });

  test("Nord Pool raw_today entries work too", () => {
    const now = new Date(2026, 9, 30, 10, 30);
    const raw = Array.from({ length: 24 }, (_, h) => ({ start: new Date(2026, 9, 30, h).toISOString(), value: h }));
    const hass = makeHass({ "sensor.np": ["1", { raw_today: raw }] });
    const p = readUpcomingPrices(hass, "sensor.np", now);
    expect(p[0].value).toBe(10);
    expect(p).toHaveLength(12);
  });
});

describe("price axis and cheapest window", () => {
  test("the axis step keeps to at most five lines, in kr and öre", () => {
    for (const max of [0.4, 2.3, 4.8, 48, 500, 1234]) {
      const step = niceStep(max);
      expect(max / step).toBeLessThanOrEqual(5);
      expect(max / step).toBeGreaterThan(1);
    }
    expect(niceStep(500)).toBe(100);
    expect(niceStep(4.8)).toBe(1);
  });

  test("axis labels have the decimals the step needs", () => {
    expect([1, 100, 2.5, 0.25, 0.5, 0.0025].map(stepDecimals)).toEqual([0, 0, 1, 2, 1, 4]);
  });

  test("cheapestBlock from a given index", () => {
    const start = new Date(2026, 9, 30, 10).getTime();
    const pts = [5, 1, 3, 2, 2, 9].map((value, i) => ({ start: new Date(start + i * 3_600_000), value }));
    expect(cheapestBlock(pts, 0, 1)).toEqual({ index: 1, avg: 1 });
    expect(cheapestBlock(pts, 2, 2)).toEqual({ index: 3, avg: 2 });
    expect(cheapestBlock(pts, 5, 2)).toBeNull();
  });

  test("cheapestBlock skips runs with a missing period", () => {
    const at = (h: number) => new Date(2026, 9, 30, h);
    // 13:00 is missing: 12, 14, 15 must not count as three hours in a row
    const pts = [
      { start: at(10), value: 5 },
      { start: at(11), value: 5 },
      { start: at(12), value: 1 },
      { start: at(14), value: 1 },
      { start: at(15), value: 1 },
      { start: at(16), value: 4 },
    ];
    expect(cheapestBlock(pts, 0, 3)).toEqual({ index: 3, avg: 2 });
  });
});
