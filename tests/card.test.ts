import { beforeEach, describe, expect, test } from "vitest";
import pkg from "../package.json";
import { PowerFlowCardNowFlowForecast, VERSION } from "../src/power-flow-card-now-flow-forecast";
import type { CardConfig } from "../src/types";
import { eveningStates, houseConfig, makeHass } from "./helpers";

const mount = async (config: CardConfig, states = eveningStates) => {
  const card = document.createElement("power-flow-card-now-flow-forecast") as PowerFlowCardNowFlowForecast;
  card.setConfig(config);
  card.hass = makeHass(states);
  document.body.appendChild(card);
  await card.updateComplete;
  return card;
};

const root = (card: PowerFlowCardNowFlowForecast) => card.shadowRoot as ShadowRoot;
const tab = (card: PowerFlowCardNowFlowForecast, label: string) =>
  [...root(card).querySelectorAll<HTMLButtonElement>(".tabs button")].find((b) => b.textContent?.trim() === label)!;

beforeEach(() => {
  document.body.innerHTML = "";
  localStorage.clear();
});

describe("card", () => {
  test("version constant matches package.json", () => {
    expect(VERSION).toBe(pkg.version);
  });

  test("home.entity is required", () => {
    const card = document.createElement("power-flow-card-now-flow-forecast") as PowerFlowCardNowFlowForecast;
    expect(() => card.setConfig({ type: "x" } as CardConfig)).toThrow(/home.entity/);
  });

  test("header shows status, home power and price", async () => {
    const card = await mount(houseConfig);
    expect(root(card).querySelector(".title")?.textContent).toBe("Running on battery");
    expect(root(card).querySelector(".subtitle")?.textContent).toContain("1.95 kW");
    expect(root(card).querySelector(".price")?.textContent).toContain("1.23 SEK");
  });

  test("starts on Now; a running large load gets a tile, idle ones do not", async () => {
    const card = await mount(houseConfig, { ...eveningStates, "sensor.ev": "11000" });
    expect(tab(card, "Now").getAttribute("aria-pressed")).toBe("true");
    const tiles = root(card).querySelectorAll(".load-tile");
    expect(tiles).toHaveLength(1);
    expect(tiles[0].textContent).toContain("EV");
  });

  test("no running loads -> no 'Running now' section", async () => {
    const card = await mount(houseConfig);
    expect(root(card).textContent).not.toContain("Running now");
  });

  test("switching to Flow draws the Sankey and remembers the view", async () => {
    const card = await mount(houseConfig);
    tab(card, "Flow").click();
    await card.updateComplete;
    expect(root(card).querySelector("svg.sankey")).not.toBeNull();
    expect(localStorage.getItem("power-flow-card-now-flow-forecast:view:default")).toBe("flow");

    const again = await mount(houseConfig);
    expect(tab(again, "Flow").getAttribute("aria-pressed")).toBe("true");
  });

  test("Forecast without LoadCast data says so instead of breaking", async () => {
    const card = await mount({ ...houseConfig, default_view: "forecast" });
    expect(root(card).textContent).toContain("No LoadCast forecast available.");
    expect(root(card).textContent).toContain("Solar tomorrow");
  });

  test("a minimal config (home only) renders all three views", async () => {
    const card = await mount({ type: "x", home: { entity: "sensor.home" } });
    for (const label of ["Now", "Flow", "Forecast"]) {
      tab(card, label).click();
      await card.updateComplete;
      expect(root(card).querySelector(".view")).not.toBeNull();
    }
  });
});
