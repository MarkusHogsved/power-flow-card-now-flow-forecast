import { describe, expect, test } from "vitest";
import { buildReviewInput, reviewEntities, toSeries } from "../src/history";
import {
  average,
  cheapestWindow,
  combine,
  computeReview,
  extreme,
  findRuns,
  hourlyPrices,
  integrate,
  priceVerdict,
  valueAt,
  type Series,
} from "../src/review";
import { houseConfig, makeHass } from "./helpers";

const H = 3_600_000;
const M = 60_000;
/** 21/10 07:00 local time - the start of a 24 h review ending 22/10 07:00. */
const T0 = new Date(2026, 9, 21, 7, 0).getTime();
const at = (h: number, m = 0) => T0 + h * H + m * M;

/** Step series from [hour offset, value] pairs. */
const steps = (pairs: [number, number][]): Series => pairs.map(([h, v]) => ({ t: at(0) + h * H, v }));

describe("series helpers", () => {
  const s = steps([[0, 1000], [1, 3000], [2, NaN], [3, 0]]);

  test("valueAt holds the last value", () => {
    expect(valueAt(s, at(0, 30))).toBe(1000);
    expect(valueAt(s, at(1))).toBe(3000);
    expect(valueAt(s, at(-1))).toBeNaN();
  });

  test("integrate gives value-hours and skips unknown segments", () => {
    expect(integrate(s, at(0), at(4))).toBe(4000);
    expect(integrate(s, at(0, 30), at(1, 30))).toBe(500 + 1500);
  });

  test("average ignores unknown time", () => {
    expect(average(s, at(0), at(3))).toBe(2000);
    expect(average(s, at(2), at(3))).toBeNaN();
  });

  test("combine evaluates at the union of breakpoints", () => {
    const a = steps([[0, 1], [2, 3]]);
    const b = steps([[0, 10], [1, 20]]);
    expect(combine([a, b], ([x, y]) => x * y).map((p) => p.v)).toEqual([10, 20, 60]);
  });

  test("extreme finds the minimum and when", () => {
    expect(extreme(s, at(0), at(4), "min")).toEqual({ v: 0, t: at(3) });
    expect(extreme(s, at(0), at(4), "max")).toEqual({ v: 3000, t: at(1) });
  });

  test("findRuns merges short gaps and drops short runs", () => {
    const p: Series = [
      { t: at(0), v: 0 },
      { t: at(1), v: 2000 },
      { t: at(1, 30), v: 0 },
      { t: at(1, 35), v: 2000 }, // 5 min gap -> merged
      { t: at(2), v: 0 },
      { t: at(3), v: 2000 }, // 5 min run -> dropped
      { t: at(3, 5), v: 0 },
    ];
    expect(findRuns(p, 500, at(0), at(4), 10 * M, 10 * M)).toEqual([{ start: at(1), end: at(2) }]);
  });

  test("hourly prices and the cheapest window", () => {
    const price = steps([[0, 1.0], [1, 0.5], [2, 0.3], [3, 0.4], [4, 1.2]]);
    expect(hourlyPrices(price, at(0), at(5)).map((p) => p.mean)).toEqual([1.0, 0.5, 0.3, 0.4, 1.2]);
    expect(cheapestWindow(price, H, at(0), at(5))).toBeCloseTo(0.3);
    expect(cheapestWindow(price, 2 * H, at(0), at(5))).toBeCloseTo(0.35);
    expect(cheapestWindow(price, 6 * H, at(0), at(5))).toBeNull();
  });

  test("price verdict", () => {
    expect(priceVerdict(0.34, 0.34)).toBe("good");
    expect(priceVerdict(1.16, 0.34)).toBe("bad");
    expect(priceVerdict(0.5, 0.4)).toBe("ok");
    expect(priceVerdict(-0.02, -0.05)).toBe("good");
    expect(priceVerdict(0.5, null)).toBe("neutral");
  });
});

/**
 * A night like 21-22/10: the solar battery is charged from the grid in the
 * cheapest hours (01:00-05:00, 0.34), the EV tops up in the afternoon at
 * 1.16, solar 09-16, nothing sold.
 */
const night = () => {
  const price: [number, number][] = [];
  for (let h = 0; h < 24; h++) price.push([h, h >= 18 && h < 22 ? 0.34 : h >= 7 && h < 12 ? 1.16 : 0.9]);
  const grid = steps([[0, 400], [7, 11400], [7.25, 400], [18, 11400], [22, 300]]);
  const battery = steps([[0, -300], [2, 0], [18, 11000], [22, 0]]);
  const soc = steps([[0, 70], [10, 60], [18, 46], [22, 100]]);
  const ev = steps([[0, 0], [7, 11000], [7.25, 0]]);
  const solar = steps([[0, 0], [2, 800], [5, 4000], [6, 2000], [9, 0]]);
  return {
    start: at(0),
    end: at(24),
    grid,
    price: steps(price),
    solar,
    batteries: [{ name: "Solar battery", power: battery, soc, primary: true }],
    loads: [{ name: "EV", color: "#B39DF0", power: ev, threshold: 300 }],
    phases: [steps([[0, 5], [18, 21.4], [22, 4]])],
  };
};

describe("computeReview", () => {
  const r = computeReview(night());

  test("bought energy and cost", () => {
    // 0.25 h * 11.4 kW + 4 h * 11.4 kW + the base 0.3-0.4 kW the rest of the time
    expect(r.bought?.kwh).toBeCloseTo(0.4 * 7 + 11.4 * 0.25 + 0.4 * 10.75 + 11.4 * 4 + 0.3 * 2, 5);
    expect(r.sold?.kwh).toBe(0);
    expect(r.avgBuyPrice).toBeLessThan(r.avgPrice as number);
  });

  test("lowest SOC of the main battery", () => {
    expect(r.lowestSoc).toEqual({ name: "Solar battery", v: 46, t: at(18) });
  });

  test("the night charge is a good event, the EV top-up a bad one", () => {
    const charge = r.events.find((e) => e.kind === "battery");
    expect(charge).toMatchObject({ start: at(18), end: at(22), socFrom: 46, socTo: 100, verdict: "good" });
    expect(charge?.kwh).toBeCloseTo(44);
    expect(charge?.avgPrice).toBeCloseTo(0.34);

    const ev = r.events.find((e) => e.kind === "load");
    expect(ev).toMatchObject({ name: "EV", start: at(7), end: at(7, 15), verdict: "bad" });
    expect(ev?.avgPrice).toBeCloseTo(1.16);
    expect(ev?.cheapest).toBeCloseTo(0.34);
  });

  test("solar span and peak; newest event first", () => {
    const solar = r.events.find((e) => e.kind === "solar");
    expect(solar).toMatchObject({ start: at(2), end: at(9), peakW: 4000, peakAt: at(5) });
    expect(r.events.map((e) => e.start)).toEqual([...r.events.map((e) => e.start)].sort((a, b) => b - a));
  });

  test("peak grid and highest phase", () => {
    expect(r.peakImportW).toBe(11400);
    expect(r.maxPhaseA).toBe(21.4);
  });

  test("chart buckets cover the period", () => {
    expect(r.importBuckets).toHaveLength(24 * 12);
    expect(r.socBuckets[0]).toBe(70);
    expect(r.prices).toHaveLength(24);
  });

  test("charging from solar gets no price verdict", () => {
    const input = night();
    input.grid = steps([[0, 0]]);
    const c = computeReview(input).events.find((e) => e.kind === "battery");
    expect(c).toMatchObject({ avgPrice: null, verdict: "neutral" });
  });

  test("selling is an export event", () => {
    const input = night();
    input.grid = steps([[0, 0], [20, -10000], [21, 0]]);
    const sold = computeReview(input);
    expect(sold.sold?.kwh).toBeCloseTo(10);
    expect(sold.sold?.revenue).toBeCloseTo(3.4);
    expect(sold.events.find((e) => e.kind === "export")).toMatchObject({ start: at(20), end: at(21) });
  });

  test("short load runs are summarised in one event", () => {
    const input = night();
    const runs: [number, number][] = [];
    for (let h = 1; h < 6; h++) runs.push([h, 2000], [h + 0.1, 0]);
    input.loads = [{ name: "Water heater", color: "#E0A93B", power: steps([[0, 0], ...runs]), threshold: 100 }];
    const events = computeReview(input).events.filter((e) => e.kind === "load");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ runs: 5 });
    expect(events[0].kwh).toBeCloseTo(1.0);
  });

  test("small solar top-ups of a battery are one summary event; a tiny export is no event", () => {
    const input = night();
    input.grid = steps([[0, 0], [3, -1000], [3.1, 0]]); // 0.1 kWh sold
    input.batteries = [{
      name: "UPS",
      power: steps([[0, 0], [3, 1000], [3.25, 0], [5, 1000], [5.25, 0]]),
      soc: steps([[0, 50]]),
      primary: true,
    }];
    const r = computeReview(input);
    expect(r.events.filter((e) => e.kind === "battery")).toMatchObject([{ name: "UPS", runs: 2, avgPrice: null }]);
    expect(r.events.some((e) => e.kind === "export")).toBe(false);
  });

  test("highest phase is a 5-minute average, not a single spike", () => {
    const input = night();
    input.phases = [[{ t: at(0), v: 10 }, { t: at(3), v: 27 }, { t: at(3, 0) + 20_000, v: 10 }]];
    expect(computeReview(input).maxPhaseA).toBeLessThan(13);
  });

  test("no data at all gives an empty review, not a crash", () => {
    const empty = computeReview({ start: at(0), end: at(12), batteries: [], loads: [], phases: [] });
    expect(empty).toMatchObject({ bought: null, sold: null, solarKwh: null, lowestSoc: null, events: [] });
  });
});

describe("history", () => {
  test("compressed states become series in ms; unknown is NaN", () => {
    const s = toSeries([{ s: "1.5", lu: 1000, lc: 990 }, { s: "unavailable", lu: 1010 }, { s: "on", lu: 1020 }]);
    expect(s.map((p) => p.t)).toEqual([990_000, 1_010_000, 1_020_000]);
    expect(s[0].v).toBe(1.5);
    expect(s[1].v).toBeNaN();
    expect(s[2].v).toBeNaN();
  });

  test("entities to fetch include summed battery entities, without duplicates", () => {
    const ids = reviewEntities({
      ...houseConfig,
      batteries: [{ state_of_charge: "sensor.soc", charge_entity: ["sensor.c1", "sensor.c2"], discharge_entity: ["sensor.d1"] }],
    });
    expect(ids).toEqual(expect.arrayContaining(["sensor.grid", "sensor.price", "sensor.soc", "sensor.c1", "sensor.c2", "sensor.d1", "sensor.ev", "sensor.l3"]));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("units come from the current state; charge minus discharge; main battery is the first outside the home", () => {
    const hass = makeHass({
      "sensor.grid": ["1.5", { unit_of_measurement: "kW" }],
      "sensor.c1": "0",
      "sensor.d1": "0",
    });
    const input = buildReviewInput(
      hass,
      {
        ...houseConfig,
        batteries: [
          { name: "UPS", state_of_charge: "sensor.ups", entity: "sensor.ups_power", inside_home: true },
          { name: "Main", state_of_charge: "sensor.soc", charge_entity: "sensor.c1", discharge_entity: "sensor.d1" },
        ],
      },
      {
        "sensor.grid": [{ t: 0, v: 1.5 }],
        "sensor.c1": [{ t: 0, v: 2000 }],
        "sensor.d1": [{ t: 0, v: 500 }],
        "sensor.soc": [{ t: 0, v: 50 }],
      },
      0,
      H,
    );
    expect(input.grid).toEqual([{ t: 0, v: 1500 }]);
    expect(input.batteries[1].power).toEqual([{ t: 0, v: 1500 }]);
    expect(input.batteries.map((b) => b.primary)).toEqual([false, true]);
  });
});
