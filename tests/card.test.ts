import { beforeEach, describe, expect, test } from "vitest";
import pkg from "../package.json";
import { PowerFlowCardNowFlowForecast, VERSION } from "../src/power-flow-card-now-flow-forecast";
import type { CardConfig, HomeAssistant } from "../src/types";
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
    const price = root(card).querySelector(".price")?.textContent?.replace(/\s+/g, " ");
    expect(price).toContain("1.23");
    expect(price).toContain("SEK/kWh");
  });

  test("battery bank shows discharge and charge separately, not a net figure", async () => {
    const card = await mount(houseConfig, { ...eveningStates, "sensor.anker_charge": "1210" });
    const head = root(card).querySelector(".bank .row b")?.textContent?.replace(/\s+/g, " ");
    expect(head).toContain("↑ 1.95 kW");
    expect(head).toContain("↓ 1.21 kW");
  });

  test("Flow leaves an inside-home battery out of the Sankey", async () => {
    const card = await mount({ ...houseConfig, default_view: "flow" }, { ...eveningStates, "sensor.anker_charge": "1210" });
    expect(root(card).querySelector("svg.sankey")?.textContent).not.toContain("Charging Anker");
  });

  test("starts on Now; a running large load gets a tile, idle ones do not", async () => {
    const card = await mount(houseConfig, { ...eveningStates, "sensor.ev": "11000" });
    expect(tab(card, "Now").getAttribute("aria-pressed")).toBe("true");
    const tiles = root(card).querySelectorAll(".load-tile");
    expect(tiles).toHaveLength(1);
    expect(tiles[0].textContent).toContain("EV");
  });

  test("Now shows today's solar forecast and today's purchase and cost at the nodes", async () => {
    const card = await mount(
      {
        ...houseConfig,
        solar: { ...houseConfig.solar!, forecast_today: "sensor.solar_forecast_today" },
        grid: { ...houseConfig.grid!, today_cost: "sensor.cost_today" },
      },
      {
        ...eveningStates,
        "sensor.solar_forecast_today": ["43.23", { unit_of_measurement: "kWh" }],
        "sensor.cost_today": ["42.24", { unit_of_measurement: "SEK" }],
      },
    );
    const labels = [...root(card).querySelectorAll(".node-label")].map((l) => l.textContent?.replace(/\s+/g, ""));
    expect(labels).toContain("Solar35kWhtoday~43kWhforecast");
    expect(labels).toContain("Grid46kWh·42SEK");
  });

  test("without the optional entities the node labels stay short", async () => {
    const card = await mount({ ...houseConfig, solar: { entity: "sensor.solar" }, grid: { entity: "sensor.grid" } });
    const labels = [...root(card).querySelectorAll(".node-label")].map((l) => l.textContent?.replace(/\s+/g, " ").trim());
    expect(labels).toContain("Solar");
    expect(labels).toContain("Grid");
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

  test("Review fetches history once, shows what happened and switches to 12 h", async () => {
    const now = Date.now() / 1000;
    const calls: Record<string, unknown>[] = [];
    const history = {
      "sensor.grid": [{ s: "300", lu: now - 24 * 3600 }, { s: "11400", lu: now - 6 * 3600 }, { s: "300", lu: now - 2 * 3600 }],
      "sensor.price": [{ s: "0.9", lu: now - 24 * 3600 }, { s: "0.34", lu: now - 6 * 3600 }, { s: "0.9", lu: now - 2 * 3600 }],
      "sensor.growatt_power": [{ s: "0", lu: now - 24 * 3600 }, { s: "11000", lu: now - 6 * 3600 }, { s: "0", lu: now - 2 * 3600 }],
      "sensor.growatt_soc": [{ s: "46", lu: now - 24 * 3600 }, { s: "100", lu: now - 2 * 3600 }],
    };
    const card = await mount(houseConfig);
    const hass = makeHass(eveningStates);
    hass.callWS = (async (msg: Record<string, unknown>) => {
      calls.push(msg);
      return history;
    }) as HomeAssistant["callWS"];
    card.hass = hass;
    tab(card, "Review").click();
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "history/history_during_period", minimal_response: true, no_attributes: true });
    const text = root(card).textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("Bought");
    expect(text).toContain("Growatt charged");
    expect(text).toContain("46 → 100 %");
    expect(root(card).querySelector("svg.chart")).not.toBeNull();

    // a new hass object within 5 min does not fetch again
    card.hass = { ...hass };
    await card.updateComplete;
    expect(calls).toHaveLength(1);

    [...root(card).querySelectorAll<HTMLButtonElement>(".pills button")].find((b) => b.textContent?.trim() === "12 h")!.click();
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toHaveLength(2);
    expect(localStorage.getItem("power-flow-card-now-flow-forecast:review-hours:default")).toBe("12");
  });

  test("Review shows the error when history cannot be loaded", async () => {
    const card = await mount({ ...houseConfig, default_view: "review" });
    const hass = makeHass(eveningStates);
    hass.callWS = (async () => {
      throw new Error("Unauthorized");
    }) as HomeAssistant["callWS"];
    card.hass = hass;
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    expect(root(card).textContent).toContain("Could not load history: Unauthorized");
  });

  test("a minimal config (home only) renders all four views", async () => {
    const card = await mount({ type: "x", home: { entity: "sensor.home" } });
    for (const label of ["Now", "Flow", "Forecast", "Review"]) {
      tab(card, label).click();
      await card.updateComplete;
      expect(root(card).querySelector(".view")).not.toBeNull();
    }
  });
});
