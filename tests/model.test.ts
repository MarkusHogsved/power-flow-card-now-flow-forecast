import { describe, expect, test } from "vitest";
import { formatPower, readPowerW } from "../src/hass";
import { computeFlows, computeModel, computeStatus } from "../src/model";
import { eveningStates, houseConfig, makeHass } from "./helpers";

describe("readPowerW", () => {
  test("converts kW and treats unavailable as null", () => {
    const hass = makeHass({ "sensor.a": ["1.5", { unit_of_measurement: "kW" }], "sensor.b": "unavailable" });
    expect(readPowerW(hass, "sensor.a")).toBe(1500);
    expect(readPowerW(hass, "sensor.b")).toBeNull();
    expect(readPowerW(hass, "sensor.missing")).toBeNull();
  });
});

describe("formatPower", () => {
  test("W below 1 kW, two decimals below 10 kW, one above", () => {
    const hass = makeHass({});
    expect(formatPower(hass, 870)).toBe("870 W");
    expect(formatPower(hass, -1951)).toBe("1.95 kW");
    expect(formatPower(hass, 11000)).toBe("11.0 kW");
  });
});

describe("computeModel - 20/10 evening on batteries", () => {
  const model = computeModel(makeHass(eveningStates), houseConfig);

  test("status is 'battery' and batteries cover the home", () => {
    expect(model.status).toBe("battery");
    expect(model.batteryDischargeW).toBe(1686 + 265);
    expect(model.flows.batteryToHome).toBe(1951);
    expect(model.flows.gridToHome).toBe(0);
  });

  test("large loads below their threshold are not running", () => {
    expect(model.running).toEqual([]);
  });

  test("rest of home = home minus measured loads", () => {
    expect(model.restW).toBe(1951 - 83 - 87);
  });

  test("a battery without a power entity is idle, SOC still read", () => {
    const anker = model.batteries[2];
    expect(anker.powerW).toBe(0);
    expect(anker.soc).toBe(31);
  });

  test("price and phases are read", () => {
    expect(model.price).toBeCloseTo(1.227);
    expect(model.priceUnit).toBe("SEK/kWh");
    expect(model.phases.map((p) => p.amps)).toEqual([1.9, 1, 1.6]);
  });
});

describe("running loads", () => {
  test("shown only at or above their threshold, highest first", () => {
    const hass = makeHass({ ...eveningStates, "sensor.ev": "11000", "sensor.water_heater": "3000", "sensor.washer": "29" });
    const model = computeModel(hass, houseConfig);
    expect(model.running.map((l) => l.name)).toEqual(["EV", "Water heater"]);
    expect(model.restW).toBe(0);
  });

  test("each large load gets a distinct default colour", () => {
    const hass = makeHass({ ...eveningStates, "sensor.ev": "11000", "sensor.water_heater": "3000", "sensor.washer": "1900" });
    const colors = computeModel(hass, houseConfig).running.map((l) => l.color);
    expect(new Set(colors).size).toBe(3);
  });
});

describe("computeFlows", () => {
  test("solar covers home first, then batteries, then export", () => {
    const f = computeFlows({ solarW: 9000, homeW: 2000, gridImportW: 0, gridExportW: 3000, batteryChargeW: 4000, batteryDischargeW: 0 });
    expect(f).toMatchObject({ solarToHome: 2000, solarToBattery: 4000, solarToGrid: 3000, gridToHome: 0 });
  });

  test("night grid charging: grid feeds home and battery", () => {
    const f = computeFlows({ solarW: 0, homeW: 1500, gridImportW: 11500, gridExportW: 0, batteryChargeW: 10000, batteryDischargeW: 0 });
    expect(f).toMatchObject({ gridToHome: 1500, gridToBattery: 10000, batteryToHome: 0 });
  });

  test("selling from the battery in an evening window", () => {
    const f = computeFlows({ solarW: 0, homeW: 1200, gridImportW: 0, gridExportW: 14000, batteryChargeW: 0, batteryDischargeW: 15200 });
    expect(f).toMatchObject({ batteryToHome: 1200, batteryToGrid: 14000 });
  });
});

describe("computeStatus", () => {
  const base = { solarW: 0, homeW: 1000, gridImportW: 0, gridExportW: 0, batteryDischargeW: 0 };
  test.each([
    [{ gridImportW: 2000 }, "importing"],
    [{ gridExportW: 5000 }, "exporting"],
    [{ solarW: 1000 }, "solar"],
    [{ batteryDischargeW: 1000 }, "battery"],
    [{}, "idle"],
  ])("%o -> %s", (patch, expected) => {
    expect(computeStatus({ ...base, ...patch })).toBe(expected);
  });
});

describe("config", () => {
  test("only home is required - everything else is optional", () => {
    const model = computeModel(makeHass({ "sensor.home": "500" }), {
      type: "custom:power-flow-card-now-flow-forecast",
      home: { entity: "sensor.home" },
    });
    expect(model.homeW).toBe(500);
    expect(model.batteries).toEqual([]);
    expect(model.phases).toEqual([]);
    expect(model.price).toBeNull();
  });

  test("invert_state flips grid and battery signs", () => {
    const model = computeModel(makeHass({ "sensor.home": "1000", "sensor.g": "-800", "sensor.soc": "50", "sensor.b": "500" }), {
      type: "x",
      home: { entity: "sensor.home" },
      grid: { entity: "sensor.g", invert_state: true },
      batteries: [{ state_of_charge: "sensor.soc", entity: "sensor.b", invert_state: true }],
    });
    expect(model.gridImportW).toBe(800);
    expect(model.batteries[0].powerW).toBe(-500);
  });
});
