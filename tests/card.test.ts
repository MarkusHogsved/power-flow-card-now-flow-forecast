import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

  test("a vehicle tile shows level → limit, energy left, finish time and cost", async () => {
    const ev = { ...houseConfig.large_loads![0], soc: "sensor.ev_soc", soc_limit: "number.ev_limit", capacity_kwh: 79 };
    const card = await mount(
      { ...houseConfig, large_loads: [ev] },
      {
        ...eveningStates,
        "sensor.ev": "10400",
        "sensor.ev_soc": ["61", { unit_of_measurement: "%" }],
        "number.ev_limit": ["80", { unit_of_measurement: "%" }],
      },
    );
    const text = root(card).querySelector(".load-tile")?.textContent?.replace(/\s+/g, " ");
    expect(text).toMatch(/61\s?% → 80\s?%/);
    // (80 − 61) % of 79 kWh / 0.9 ≈ 16.7 kWh, ≈ 1.6 h at 10.4 kW, 16.7 × 1.227 ≈ 20 SEK.
    expect(text).toMatch(/17 kWh to go → (tomorrow )?\d/);
    expect(text).toContain("~20 SEK at current price");
  });

  test("a vehicle with cost_price uses that price instead of the spot price", async () => {
    const ev = { ...houseConfig.large_loads![0], soc: "sensor.ev_soc", soc_limit: 80, capacity_kwh: 79, cost_price: "sensor.ev_price" };
    const card = await mount(
      { ...houseConfig, large_loads: [ev] },
      {
        ...eveningStates,
        "sensor.ev": "10400",
        "sensor.ev_soc": ["61", { unit_of_measurement: "%" }],
        "sensor.ev_price": ["0.074", { unit_of_measurement: "SEK/kWh" }],
      },
    );
    const text = root(card).querySelector(".load-tile")?.textContent?.replace(/\s+/g, " ");
    // 16.7 kWh × 0.074 ≈ 1 SEK.
    expect(text).toContain("~1 SEK estimated");
    expect(text).not.toContain("current price");
  });

  test("a vehicle with session_cost shows the whole session: so far plus what is left", async () => {
    const ev = {
      ...houseConfig.large_loads![0],
      soc: "sensor.ev_soc",
      soc_limit: 80,
      capacity_kwh: 79,
      cost_price: "sensor.ev_price",
      session_cost: "sensor.ev_session_cost",
    };
    const states = {
      ...eveningStates,
      "sensor.ev": "10400",
      "sensor.ev_soc": ["61", { unit_of_measurement: "%" }],
      "sensor.ev_price": ["0.5", { unit_of_measurement: "SEK/kWh" }],
      "sensor.ev_session_cost": ["12", { unit_of_measurement: "SEK" }],
    } as typeof eveningStates;
    let text = root(await mount({ ...houseConfig, large_loads: [ev] }, states)).querySelector(".load-tile")?.textContent?.replace(/\s+/g, " ");
    // 12 SEK so far + 16.7 kWh × 0.5 ≈ 20 SEK.
    expect(text).toContain("~20 SEK this charge");
    // At the limit only what the session cost.
    states["sensor.ev_soc"] = ["80", { unit_of_measurement: "%" }];
    text = root(await mount({ ...houseConfig, large_loads: [ev] }, states)).querySelector(".load-tile")?.textContent?.replace(/\s+/g, " ");
    expect(text).toContain("~12 SEK this charge");
  });

  test("tapping a vehicle tile unfolds its power and battery level history", async () => {
    const now = Math.floor(Date.now() / 1000);
    const calls: Record<string, unknown>[] = [];
    const ev = { ...houseConfig.large_loads![0], soc: "sensor.ev_soc", soc_limit: 80, capacity_kwh: 79 };
    const states = { ...eveningStates, "sensor.ev": "10400", "sensor.ev_soc": ["61", { unit_of_measurement: "%" }] } as typeof eveningStates;
    const card = await mount({ ...houseConfig, large_loads: [ev] }, states);
    const hass = makeHass(states);
    hass.callWS = (async (msg: Record<string, unknown>) => {
      calls.push(msg);
      return {
        "sensor.ev": [{ s: "0", lu: now - 20 * 3600 }, { s: "10400", lu: now - 3600 }],
        "sensor.ev_soc": [{ s: "48", lu: now - 20 * 3600 }, { s: "61", lu: now - 60 }],
      };
    }) as HomeAssistant["callWS"];
    card.hass = hass;
    await card.updateComplete;
    const tile = root(card).querySelector<HTMLElement>(".load-tile")!;
    tile.click();
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ type: "history/history_during_period", entity_ids: ["sensor.ev", "sensor.ev_soc"] });
    const panel = root(card).querySelector(".vehicle-panel");
    expect(panel?.textContent).toContain("EV · last 12 h");
    expect(panel?.querySelectorAll("svg.chart path")).toHaveLength(2);
    expect(panel?.querySelector("svg.chart line")).not.toBeNull();
    // tapping again folds it
    root(card).querySelector<HTMLElement>(".load-tile")!.click();
    await card.updateComplete;
    expect(root(card).querySelector(".vehicle-panel")).toBeNull();
  });

  test("a vehicle at its limit says so and shows no cost", async () => {
    const ev = { ...houseConfig.large_loads![0], soc: "sensor.ev_soc", soc_limit: 80, capacity_kwh: 79 };
    const card = await mount(
      { ...houseConfig, large_loads: [ev] },
      { ...eveningStates, "sensor.ev": "800", "sensor.ev_soc": ["80", { unit_of_measurement: "%" }] },
    );
    const text = root(card).querySelector(".load-tile")?.textContent?.replace(/\s+/g, " ");
    expect(text).toMatch(/80\s?% · at limit/);
    expect(text).not.toContain("spot price");
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

  test("Forecast shows a vehicle's charging need: planned from the grid, otherwise from the batteries", async () => {
    const now = new Date();
    const forecast = Array.from({ length: 24 }, (_, i) => {
      const d = new Date(now);
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + i);
      return { period_start: d.toISOString(), kwh: 1, kwh_p10: 0.8, kwh_p90: 1.4 };
    });
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:00`;
    const ev = {
      ...houseConfig.large_loads![0],
      soc: "sensor.ev_soc",
      soc_limit: 80,
      capacity_kwh: 79,
      charge_plan: ["input_datetime.plan_start", "input_datetime.plan_end"] as [string, string],
    };
    const states = {
      ...eveningStates,
      "sensor.loadcast": ["24", { forecast }],
      "sensor.ev_soc": ["46", { unit_of_measurement: "%" }],
      "input_datetime.plan_start": fmt(new Date(now.getTime() + 2 * 3_600_000)),
      "input_datetime.plan_end": fmt(new Date(now.getTime() + 5 * 3_600_000)),
    } as typeof eveningStates;
    let card = await mount({ ...houseConfig, default_view: "forecast", large_loads: [ev] }, states);
    let text = root(card).textContent?.replace(/\s+/g, " ") ?? "";
    // (80 - 46) % of 79 kWh / 0.9 ≈ 29.8 kWh
    expect(text).toContain("+ 30 kWh car");
    expect(text).toMatch(/EV 46\s?% → 80\s?%/);
    expect(text).toContain("bought from the grid");
    expect(root(card).querySelectorAll("svg.chart path")).toHaveLength(3);

    // without a plan it counts against the batteries
    states["input_datetime.plan_end"] = "unknown";
    card = await mount({ ...houseConfig, default_view: "forecast", large_loads: [ev] }, states);
    text = root(card).textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("no charging plan - counted against the batteries");
    expect(root(card).querySelectorAll("svg.chart path")).toHaveLength(2);

    // away: not counted at all; a tracker that dropped out still counts as home
    const away = { ...ev, presence: "device_tracker.ev" };
    states["device_tracker.ev"] = "not_home";
    card = await mount({ ...houseConfig, default_view: "forecast", large_loads: [away] }, states);
    expect(root(card).textContent).not.toContain("kWh car");
    states["device_tracker.ev"] = "unavailable";
    card = await mount({ ...houseConfig, default_view: "forecast", large_loads: [away] }, states);
    expect(root(card).textContent).toContain("+ 30 kWh car");
    // a switch next to the tracker: off leaves the vehicle out even at home
    states["device_tracker.ev"] = "home";
    states["input_boolean.include_ev"] = "off";
    card = await mount(
      { ...houseConfig, default_view: "forecast", large_loads: [{ ...ev, presence: ["device_tracker.ev", "input_boolean.include_ev"] }] },
      states,
    );
    expect(root(card).textContent).not.toContain("kWh car");
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

  test("Review shows a vehicle's charge outcome and unfolds its chart", async () => {
    const now = Math.floor(Date.now() / 1000);
    const ev = { ...houseConfig.large_loads![0], soc: "sensor.ev_soc", session_cost: "sensor.ev_session_cost" };
    const card = await mount({ ...houseConfig, large_loads: [ev] });
    const hass = makeHass(eveningStates);
    hass.callWS = (async () => ({
      "sensor.ev": [{ s: "0", lu: now - 20 * 3600 }, { s: "10000", lu: now - 3 * 3600 }, { s: "0", lu: now - 3600 }],
      "sensor.ev_soc": [{ s: "48", lu: now - 20 * 3600 }, { s: "73", lu: now - 3600 }],
      "sensor.ev_session_cost": [{ s: "0", lu: now - 3 * 3600 }, { s: "8.4", lu: now - 3600 }],
    })) as HomeAssistant["callWS"];
    card.hass = hass;
    tab(card, "Review").click();
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    const event = [...root(card).querySelectorAll<HTMLElement>(".event")].find((e) => e.textContent?.includes("EV"))!;
    const text = event.textContent?.replace(/\s+/g, " ");
    expect(text).toMatch(/48 → 73\s?%/);
    expect(text).toContain("~20 kWh");
    expect(text).toContain("8.40 SEK");
    expect(event.querySelector("svg.chart")).toBeNull();
    event.click();
    await card.updateComplete;
    expect(event.querySelector("svg.chart")).not.toBeNull();
  });

  test("all phases share one row, under the fuse label", async () => {
    const card = await mount(houseConfig);
    const row = root(card).querySelector<HTMLElement>(".phases")!;
    expect(row.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    expect(row.querySelector(".phases-title")?.textContent).toContain("25");
    expect(row.querySelectorAll(".phase")).toHaveLength(3);
  });

  test("the header price can be renamed", async () => {
    const card = await mount({ ...houseConfig, grid: { ...houseConfig.grid!, price_name: "Price" } });
    expect(root(card).querySelector(".price")?.textContent).toContain("Price");
    expect(root(card).querySelector(".price")?.textContent).not.toContain("Spot");
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

describe("import reason", () => {
  // 07:30 local time; the reason ends 12:00 the same day or 05:30 the next
  const now = new Date("2026-10-26T07:30:00+01:00");
  const importing = { ...eveningStates, "sensor.grid": "2910", "sensor.growatt_power": "0", "sensor.victron_power": "0" };
  const reason = (until: string, detail = "Battery First until 12:00, the battery is kept for later.") => ({
    ...importing,
    "sensor.why": ["Cheap power: battery full, kept", { until, detail }] as [string, Record<string, unknown>],
  });
  const config = { ...houseConfig, grid: { ...houseConfig.grid!, import_reason: "sensor.why" } };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
  });
  afterEach(() => vi.useRealTimers());

  test("shows the reason and until when, while importing", async () => {
    const card = await mount(config, reason("2026-10-26T12:00:00+01:00"));
    expect(root(card).querySelector(".title")?.textContent).toBe("Buying from the grid");
    // the clock follows hass.locale ("12:00 PM" in en, "12:00" in sv)
    expect(root(card).querySelector(".reason span")?.textContent).toMatch(/^Cheap power: battery full, kept · until 12:00/);
  });

  test("follows the profile's 24 h clock even with an English interface", async () => {
    const card = document.createElement("power-flow-card-now-flow-forecast") as PowerFlowCardNowFlowForecast;
    card.setConfig(config);
    card.hass = { ...makeHass(reason("2026-10-26T13:00:00+01:00")), locale: { language: "en", time_format: "24" } };
    document.body.appendChild(card);
    await card.updateComplete;
    expect(root(card).querySelector(".reason span")?.textContent).toMatch(/until 13:00$/);
  });

  test("says tomorrow when the reason ends on a later day", async () => {
    const card = await mount(config, reason("2026-10-27T05:30:00+01:00"));
    expect(root(card).querySelector(".reason span")?.textContent).toContain("until tomorrow 05:30");
  });

  test("the info button unfolds the detail", async () => {
    const card = await mount(config, reason("2026-10-26T12:00:00+01:00"));
    expect(root(card).querySelector(".reason-detail")).toBeNull();
    root(card).querySelector<HTMLButtonElement>(".reason-info")!.click();
    await card.updateComplete;
    expect(root(card).querySelector(".reason-detail")?.textContent).toContain("kept for later");
  });

  test("hidden when not importing, and without an until or detail it is just the text", async () => {
    const idle = await mount(config, { ...reason("2026-10-26T12:00:00+01:00"), "sensor.grid": "0" });
    expect(root(idle).querySelector(".reason")).toBeNull();
    document.body.innerHTML = "";
    const bare = await mount(config, { ...importing, "sensor.why": ["Unknown cause", {}] });
    expect(root(bare).querySelector(".reason span")?.textContent).toBe("Unknown cause");
    expect(root(bare).querySelector(".reason-info")).toBeNull();
  });
});
