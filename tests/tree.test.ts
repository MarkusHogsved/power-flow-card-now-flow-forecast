import { beforeEach, describe, expect, test } from "vitest";
import "../src/power-flow-card-now-flow-forecast";
import type { PowerFlowCardNowFlowForecast } from "../src/power-flow-card-now-flow-forecast";
import { computeModel } from "../src/model";
import type { CardConfig } from "../src/types";
import { flowData } from "../src/views/flow";
import { computeTree, sourceSlots } from "../src/views/tree";
import { eveningStates, houseConfig, makeHass } from "./helpers";

/** The author's house with the tree layout: the heat pump sits on the garage's meter. */
const treeConfig: CardConfig = {
  ...houseConfig,
  now_layout: "tree",
  home: { entity: "sensor.home", name: "Main house" },
  large_loads: [
    ...(houseConfig.large_loads ?? []),
    { name: "Heat pump", entity: "sensor.heat_pump", icon: "mdi:heat-pump", under: "Garage" },
  ],
};

/** 3/11 20:14: the car charges from the grid, the heat pump runs, the batteries rest. */
const carEvening = {
  ...eveningStates,
  "sensor.home": "14300",
  "sensor.grid": "12600",
  "sensor.solar": "300",
  "sensor.growatt_power": "0",
  "sensor.victron_power": "0",
  "sensor.ev": "11000",
  "sensor.washer": "0",
  "sensor.heat_pump": "2400",
  "sensor.garage": "2650",
  "sensor.workshop": "100",
};

const mount = async (config: CardConfig, states: Record<string, unknown>) => {
  const card = document.createElement("power-flow-card-now-flow-forecast") as PowerFlowCardNowFlowForecast;
  card.setConfig(config);
  card.hass = makeHass(states as Parameters<typeof makeHass>[0]);
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
};
const root = (card: PowerFlowCardNowFlowForecast) => card.shadowRoot as ShadowRoot;
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, " ").trim() ?? "";

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("tree layout", () => {
  test("loads go under their building; the house is the home minus the metered buildings", () => {
    const tree = computeTree(treeConfig, computeModel(makeHass(carEvening), treeConfig));
    expect(tree.buildings.map((b) => b.name)).toEqual(["Main house", "Garage", "Workshop"]);
    const [house, garage, workshop] = tree.buildings;
    expect(house.powerW).toBe(14300 - 2650 - 100);
    expect(house.children.map((l) => l.name)).toEqual(["EV"]);
    expect(house.otherW).toBe(11550 - 11000);
    expect(garage.children.map((l) => l.name)).toEqual(["Heat pump"]);
    expect(garage.otherW).toBe(250);
    expect(workshop.children).toEqual([]);
  });

  test("a load under a building is not subtracted twice from the rest of the home", () => {
    const m = computeModel(makeHass(carEvening), treeConfig);
    // home - EV - garage - workshop; the heat pump is inside the garage's figure
    expect(m.restW).toBe(14300 - 11000 - 2650 - 100);
  });

  test("Flow counts a load under a building once: the building's sink is what is left of it", () => {
    const hass = makeHass(carEvening);
    const model = computeModel(hass, treeConfig);
    const ctx = { hass, config: treeConfig, model, now: new Date(), moreInfo: () => {}, toggleVehicle: () => {}, toggleReviewEvent: () => {} };
    const sinks = flowData(ctx).sinks;
    const byKey = Object.fromEntries(sinks.map((x) => [x.key, x.value]));
    expect(byKey["sensor.heat_pump"]).toBe(2400);
    expect(byKey["sensor.garage"]).toBe(250);
    const homeSinks = sinks.filter((x) => !x.key.startsWith("charge-")).reduce((a, x) => a + x.value, 0);
    expect(homeSinks).toBe(14300);
  });

  test("an unknown building name puts the load in the house", () => {
    const config: CardConfig = {
      ...treeConfig,
      large_loads: [{ name: "Heat pump", entity: "sensor.heat_pump", under: "Barn" }],
    };
    const tree = computeTree(config, computeModel(makeHass(carEvening), config));
    expect(tree.buildings[0].children.map((l) => l.name)).toEqual(["Heat pump"]);
  });

  test("battery and grid each have one line whose direction follows the power", () => {
    const discharging = computeTree(treeConfig, computeModel(makeHass(eveningStates), treeConfig));
    const battery = discharging.sources.find((s) => s.kind === "battery")!;
    expect(battery).toEqual({ kind: "battery", watts: 1686 + 265, reverse: false });

    const sunny = { ...eveningStates, "sensor.solar": "9800", "sensor.grid": "-500", "sensor.growatt_power": "6200", "sensor.victron_power": "0", "sensor.home": "3100" };
    const charging = computeTree(treeConfig, computeModel(makeHass(sunny), treeConfig));
    expect(charging.sources.find((s) => s.kind === "battery")).toEqual({ kind: "battery", watts: 6200, reverse: true });
    expect(charging.sources.find((s) => s.kind === "grid")).toEqual({ kind: "grid", watts: 500, reverse: true });
    expect(charging.sources.find((s) => s.kind === "solar")).toEqual({ kind: "solar", watts: 9800, reverse: false });
  });

  test("the first battery outside the home is the main one, the rest are backups", () => {
    const tree = computeTree(treeConfig, computeModel(makeHass(eveningStates), treeConfig));
    expect(tree.main?.name).toBe("Growatt");
    expect(tree.backups.map((b) => b.name)).toEqual(["Victron", "Anker"]);
  });

  test("the inside-home battery's charging stays off the battery line", () => {
    const states = { ...eveningStates, "sensor.growatt_power": "0", "sensor.victron_power": "0", "sensor.anker_charge": "1210" };
    const tree = computeTree(treeConfig, computeModel(makeHass(states), treeConfig));
    expect(tree.sources.find((s) => s.kind === "battery")?.watts).toBe(0);
  });

  test("source boxes fill the row with the gaps between them", () => {
    const slots = sourceSlots([
      { kind: "solar", watts: 0, reverse: false },
      { kind: "grid", watts: 0, reverse: false },
      { kind: "battery", watts: 0, reverse: false },
    ]);
    const last = slots[slots.length - 1];
    expect(last.left + last.width).toBeCloseTo(100);
    expect(slots[2].width).toBeGreaterThan(slots[0].width);
  });

  test("Now draws the tree: buildings, the running loads under them and what is off", async () => {
    const card = await mount(treeConfig, carEvening);
    const r = root(card);
    expect(r.querySelector(".diagram")).toBeNull();
    const cols = [...r.querySelectorAll(".tree-col")];
    expect(cols.map((c) => text(c.querySelector(".tree-building .tree-name")))).toEqual(["Main house", "Garage", "Workshop"]);
    expect(text(cols[0].querySelector(".tree-load"))).toContain("EV");
    expect(text(cols[1].querySelector(".tree-load"))).toContain("Heat pump");
    expect(text(cols[1].querySelector(".tree-other"))).toContain("250 W");
    expect(text(r.querySelector(".tree-hub"))).toContain("14.3 kW");
    expect(text(r.querySelector(".tree-off"))).toContain("Water heater");
    expect(text(r.querySelector(".tree-backups"))).toContain("Victron");
    expect(r.querySelector(".phases")).not.toBeNull();
  });

  test("without now_layout the classic diagram stays", async () => {
    const card = await mount({ ...treeConfig, now_layout: undefined }, carEvening);
    expect(root(card).querySelector(".diagram")).not.toBeNull();
    expect(root(card).querySelector(".tree")).toBeNull();
  });

  test("an unknown now_layout is refused", () => {
    const card = document.createElement("power-flow-card-now-flow-forecast") as PowerFlowCardNowFlowForecast;
    expect(() => card.setConfig({ ...treeConfig, now_layout: "grid" as "tree" })).toThrow(/now_layout/);
  });
});
