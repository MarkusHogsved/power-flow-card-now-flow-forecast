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

const eventStatesWithEv = () => ({ ...eveningStates, "sensor.ev": "11000", "sensor.ev_soc": "73", "sensor.ev_session_cost": "8.4" });

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

  test("snapshot carries the Now view as plain data with the card's own texts", async () => {
    const card = await mount(houseConfig, { ...eveningStates, "sensor.anker_charge": "1210", "sensor.ev": "11000" });
    const snap = card.snapshot()!;
    const r = root(card);
    expect(snap.v).toBe(1);
    expect(snap.header.title).toBe(r.querySelector(".title")?.textContent);
    expect(snap.header.subtitle).toBe(r.querySelector(".subtitle")?.textContent?.trim());
    expect(snap.header.price?.value).toBe("1.23");
    expect(snap.bank.text).toBe(r.querySelector(".bank .row b")?.textContent?.trim());
    expect(snap.home.text).toBe("1.95 kW");
    expect(snap.running.map((l) => l.text)).toEqual(["11.0 kW"]);
    expect(snap.colors.solar).toBe(0xf5b942);
    // Plain data: survives JSON, as it travels to the display
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
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

  test("Forecast shows the solar forecast and the planned grid charging: when and how much", async () => {
    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const at = (h: number) => new Date(hourStart.getTime() + h * 3_600_000);
    const forecast = Array.from({ length: 24 }, (_, i) => ({ period_start: at(i).toISOString(), kwh: 2, kwh_p10: 1.5, kwh_p90: 3 }));
    // Solcast half-hours: 4 kW (P50) in hours 3-5 from now, nothing else
    const periods = Array.from({ length: 96 }, (_, i) => {
      const start = new Date(hourStart.getTime() + (i - 48) * 1_800_000);
      const h = (start.getTime() - hourStart.getTime()) / 3_600_000;
      const on = h >= 3 && h < 6;
      return { period_start: start.toISOString(), pv_estimate: on ? 4 : 0, pv_estimate10: on ? 2 : 0, pv_estimate90: on ? 6 : 0 };
    });
    const states = {
      ...eveningStates,
      "sensor.loadcast": ["48", { forecast }],
      "sensor.solcast_a": ["0", { detailedForecast: periods.slice(0, 48) }],
      "sensor.solcast_b": ["0", { detailedForecast: periods.slice(48) }],
      "sensor.plan": [
        "22",
        { windows: [{ start: at(6).toISOString(), end: at(9).toISOString(), kwh: 22, target_soc: 80, name: "Night charging" }] },
      ],
    } as typeof eveningStates;
    const config = {
      ...houseConfig,
      default_view: "forecast" as const,
      solar: { ...houseConfig.solar!, forecast_entities: ["sensor.solcast_a", "sensor.solcast_b"] },
      battery_plan: "sensor.plan",
    };
    let card = await mount(config, states);
    let text = root(card).textContent?.replace(/\s+/g, " ") ?? "";
    // 3 h × 4 kW P50
    expect(text).toContain("Solar, next 24 h ~12 kWh");
    expect(text).toContain("+ 22 kWh battery charging");
    expect(text).toMatch(/Grid charging (tomorrow )?\d{1,2}[:.]\d\d/);
    expect(text).toMatch(/Night charging · to 80\s?%/);
    expect(text).toContain("~22 kWh");
    // two charts: demand (band, charging, line) and solar (band, area, line)
    expect(root(card).querySelectorAll("svg.chart")).toHaveLength(2);
    expect(root(card).querySelectorAll("svg.chart path")).toHaveLength(6);

    // Verdict in time order (Codex #34): 3 kWh/h, no sun until hour 18, so
    // ~54 kWh is needed from the batteries before solar takes over
    states["sensor.loadcast"] = ["72", { forecast: forecast.map((f) => ({ ...f, kwh: 3, kwh_p10: 2, kwh_p90: 4 })) }];
    const late = periods.map((p, i) => {
      const h = (i - 48) / 2;
      return h >= 18 && h < 22 ? { ...p, pv_estimate: 8, pv_estimate10: 6, pv_estimate90: 9 } : { ...p, pv_estimate: 0, pv_estimate10: 0, pv_estimate90: 0 };
    });
    states["sensor.solcast_a"] = ["0", { detailedForecast: late.slice(0, 48) }];
    states["sensor.solcast_b"] = ["0", { detailedForecast: late.slice(48) }];
    const plan = (from: number, to: number) => ["40", { windows: [{ start: at(from).toISOString(), end: at(to).toISOString(), kwh: 40, target_soc: 100, name: "X" }] }];
    // 40 kWh early enough: covered
    states["sensor.plan"] = plan(1, 4) as typeof states["sensor.plan"];
    card = await mount(config, states);
    expect(root(card).textContent).toContain("Covered with the planned grid charging");
    // the same 40 kWh after solar has taken over: still short
    states["sensor.plan"] = plan(19, 22) as typeof states["sensor.plan"];
    card = await mount(config, states);
    text = root(card).textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).not.toContain("Covered with the planned grid charging");
    expect(text).toContain("Short by");

    // Charging more than the battery can hold does not count (Codex #34): a
    // huge early window only fills the 54 kWh above the reserve, and 4 kWh/h
    // until solar at hour 18 needs more than that
    states["sensor.loadcast"] = ["96", { forecast: forecast.map((f) => ({ ...f, kwh: 4, kwh_p10: 3, kwh_p90: 5 })) }];
    states["sensor.plan"] = ["400", { windows: [{ start: at(1).toISOString(), end: at(2).toISOString(), kwh: 400, target_soc: 100, name: "X" }] }] as typeof states["sensor.plan"];
    card = await mount(config, states);
    expect(root(card).textContent).not.toContain("Covered with the planned grid charging");
    expect(root(card).textContent).toContain("Short by");

    // A plan entity with no windows says so
    states["sensor.plan"] = ["0", { windows: [] }];
    card = await mount(config, states);
    text = root(card).textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("No grid charging planned");
    expect(text).not.toContain("battery charging");
  });

  test("Forecast short and nothing planned: when the batteries run out and the cheapest charging before then", async () => {
    const now = new Date();
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    const at = (h: number) => new Date(hourStart.getTime() + h * 3_600_000);
    // 4 kWh/h, no sun: 43 kWh usable runs out after ~10 h
    const forecast = Array.from({ length: 24 }, (_, i) => ({ period_start: at(i).toISOString(), kwh: 4, kwh_p10: 3, kwh_p90: 5 }));
    // Quarter prices by wall clock: 0.50 from 3 to 9 h from now, 2.00 otherwise
    const day = (offset: number) =>
      Array.from({ length: 96 }, (_, q) => {
        const d = new Date(hourStart);
        d.setDate(d.getDate() + offset);
        d.setHours(Math.floor(q / 4), (q % 4) * 15, 0, 0);
        return d >= at(3) && d < at(9) ? 0.5 : 2;
      });
    const states = {
      ...eveningStates,
      "sensor.loadcast": ["96", { forecast }],
      "sensor.price": ["2", { unit_of_measurement: "SEK/kWh", today: day(0), tomorrow: day(1) }],
    } as typeof eveningStates;
    const config = {
      ...houseConfig,
      default_view: "forecast" as const,
      batteries: [{ ...houseConfig.batteries![0], max_charge_kw: 10 }, ...houseConfig.batteries!.slice(1)],
    };
    const card = await mount(config, states);
    const text = root(card).textContent?.replace(/\s+/g, " ") ?? "";
    expect(text).toContain("Short by");
    expect(text).toMatch(/Cheapest charging before then: (tomorrow )?\d{1,2}[:.]\d\d( [AP]M)?-/);
    expect(text).toMatch(/batteries empty ~(tomorrow )?\d{1,2}[:.]\d\d( [AP]M)? · avg 0\.50 SEK\/kWh/);
    // 53 kWh short but only ~45 kWh fit during the block (54 kWh room, ~31 kWh
    // left at its start, ~22 kWh used meanwhile): the rest is bought later
    expect(text).toMatch(/fills the batteries - ~\d+ kWh more from the grid later/);
    // grid lines carry their value
    expect(text).toMatch(/\d+(\.\d+)? kWh/);
    expect(root(card).querySelectorAll("svg.chart line[stroke-dasharray]").length).toBeGreaterThan(0);
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

  test("snapshotFull carries every view; Review and vehicle texts match the rendered card", async () => {
    const now = Math.floor(Date.now() / 1000);
    const ev = { ...houseConfig.large_loads![0], soc: "sensor.ev_soc", session_cost: "sensor.ev_session_cost" };
    const config = { ...houseConfig, large_loads: [ev] };
    const states = { ...eventStatesWithEv() };
    const card = await mount(config, states);
    const hass = makeHass(states);
    const calls: Record<string, unknown>[] = [];
    hass.callWS = (async (msg: Record<string, unknown>) => {
      calls.push(msg);
      return {
        "sensor.ev": [{ s: "0", lu: now - 20 * 3600 }, { s: "10000", lu: now - 3 * 3600 }],
        "sensor.ev_soc": [{ s: "48", lu: now - 20 * 3600 }, { s: "73", lu: now - 1800 }],
        "sensor.ev_session_cost": [{ s: "0", lu: now - 3 * 3600 }, { s: "8.4", lu: now - 1800 }],
      };
    }) as HomeAssistant["callWS"];
    card.hass = hass;
    // The first snapshot answers at once; the history arrives in the background
    const first = (await card.snapshotFull())!;
    expect(first.vehicles).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    const snap = (await card.snapshotFull())!;
    expect(snap.v).toBe(2);
    expect(snap.tabs).toEqual(["Now", "Flow", "Forecast", "Review", "Price"]);
    expect(snap.home.text).toBe("1.95 kW");
    expect(snap.flow.ribbons.length).toBeGreaterThan(0);
    expect(snap.flow.sinks.map((b) => b.label)).toContain("EV 11.0 kW");
    expect(snap.forecast.title).toBe("Home demand, next 24 h");
    // Review: the event text is the rendered card's, piece by piece
    const review = snap.review as Extract<typeof snap.review, { events: unknown }>;
    const evEvent = review.events.find((e) => e.title.includes("EV"))!;
    tab(card, "Review").click();
    await card.updateComplete;
    await new Promise((r) => setTimeout(r, 0));
    await card.updateComplete;
    const rendered = [...root(card).querySelectorAll<HTMLElement>(".event")].find((e) => e.textContent?.includes("EV"))!;
    expect(rendered.querySelector(".event-text")?.textContent?.replace(/\s+/g, " ").trim()).toBe(
      evEvent.text.map((s) => s.t).join("").replace(/\s+/g, " ").trim(),
    );
    // The running vehicle's last 12 h, in even buckets
    expect(snap.vehicles).toHaveLength(1);
    expect(snap.vehicles[0].power).toHaveLength(144);
    expect(snap.vehicles[0].power[143]).toBeCloseTo(10000, -2);
    expect(snap.vehicles[0].soc[143]).toBe(73);
    // Plain data
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    // A further snapshot within the cache times fetches nothing
    const n = calls.length;
    await card.snapshotFull();
    expect(calls.length).toBe(n);
  });

  test("snapshotFull: tap-to-open details for solar, grid, home and each battery from 24 h of history", async () => {
    const now = Math.floor(Date.now() / 1000);
    const card = await mount(houseConfig);
    const hass = makeHass(eveningStates);
    hass.callWS = (async () => ({
      "sensor.solar": [{ s: "0", lu: now - 23 * 3600 }, { s: "6000", lu: now - 12 * 3600 }, { s: "0", lu: now - 6 * 3600 }],
      "sensor.grid": [{ s: "2000", lu: now - 23 * 3600 }, { s: "-3000", lu: now - 12 * 3600 }, { s: "0", lu: now - 6 * 3600 }],
      "sensor.home": [{ s: "1500", lu: now - 24 * 3600 }],
      "sensor.growatt_power": [{ s: "5000", lu: now - 12 * 3600 }, { s: "-1000", lu: now - 6 * 3600 }],
      "sensor.growatt_soc": [{ s: "40", lu: now - 12 * 3600 }, { s: "90", lu: now - 6 * 3600 }],
    })) as HomeAssistant["callWS"];
    card.hass = hass;
    expect((await card.snapshotFull())!.details).toEqual([]); // history arrives in the background
    await new Promise((r) => setTimeout(r, 0));
    const d = (await card.snapshotFull())!.details;
    expect(d.map((x) => x.id)).toEqual(["solar", "grid", "home", "battery-0", "battery-1", "battery-2"]);
    const by = Object.fromEntries(d.map((x) => [x.id, x]));
    expect(by.solar.series).toHaveLength(96);
    expect(Math.max(...by.solar.series)).toBe(6000);
    expect(Math.min(...by.grid.series)).toBe(-3000); // sold below zero
    expect(by.grid.stats.map((s) => s.label)).toContain("Highest export");
    expect(by.home.stats[0]).toEqual({ label: "Used, 24 h", value: "36 kWh" });
    const g = by["battery-0"];
    expect(g.soc).not.toBeNull();
    expect(g.stats.find((s) => s.label === "Charged, 24 h")?.value).toBe("30 kWh");
    expect(g.stats.find((s) => s.label === "Discharged, 24 h")?.value).toBe("6.0 kWh");
    expect(JSON.parse(JSON.stringify(d))).toEqual(d);
  });

  test("details: an hourly Solcast forecast fills every bucket of its hour", async () => {
    const now = Math.floor(Date.now() / 1000);
    const hourStart = (h: number) => new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000 - h * 3_600_000).toISOString();
    const hourly = Array.from({ length: 24 }, (_, h) => ({ period_start: hourStart(h), pv_estimate: 2 }));
    const card = await mount({ ...houseConfig, solar: { ...houseConfig.solar!, forecast_entities: ["sensor.fc"] } }, {
      ...eveningStates,
      "sensor.fc": ["1", { detailedForecast: hourly }],
    });
    const hass = makeHass({ ...eveningStates, "sensor.fc": ["1", { detailedForecast: hourly }] });
    hass.callWS = (async () => ({ "sensor.solar": [{ s: "0", lu: now - 24 * 3600 }] })) as HomeAssistant["callWS"];
    card.hass = hass;
    await card.snapshotFull();
    await new Promise((r) => setTimeout(r, 0));
    const solar = (await card.snapshotFull())!.details.find((d) => d.id === "solar")!;
    const known = (solar.forecast ?? []).slice(4, 90);
    expect(known.every((v) => v === 2000)).toBe(true);
  });

  test("snapshotFull never waits for history: a hanging recorder still gives live figures", async () => {
    const ev = { ...houseConfig.large_loads![0], soc: "sensor.ev_soc" };
    const states = eventStatesWithEv();
    const card = await mount({ ...houseConfig, large_loads: [ev] }, states);
    const hass = makeHass(states);
    let calls = 0;
    hass.callWS = (() => {
      calls++;
      return new Promise(() => undefined); // never answers
    }) as HomeAssistant["callWS"];
    card.hass = hass;
    const snap = await Promise.race([card.snapshotFull(), new Promise((r) => setTimeout(() => r("timeout"), 100))]);
    expect(snap).not.toBe("timeout");
    expect((snap as { home: { text: string } }).home.text).toBe("1.95 kW");
    // and it does not ask again on every poll
    const n = calls;
    await card.snapshotFull();
    expect(calls).toBe(n);
  });

  test("snapshot: price chart on Now and the Price view, from the price entity's quarter lists", async () => {
    const quarters = (base: number) => Array.from({ length: 96 }, (_, i) => base + (i % 8) / 10);
    const states = {
      ...eveningStates,
      "sensor.price": ["1.23", { unit_of_measurement: "SEK/kWh", today: quarters(1), tomorrow: quarters(2) }] as [string, Record<string, unknown>],
      "sensor.sell": ["0.9", { today: quarters(0.5), tomorrow: [] }] as [string, Record<string, unknown>],
    };
    const config = { ...houseConfig, grid: { ...houseConfig.grid!, sell_price: "sensor.sell" } };
    const card = await mount(config, states);
    const snap = (await card.snapshotFull())!;
    expect(snap.prices!.bars).toHaveLength(48);
    const p = snap.price as Extract<typeof snap.price, { bars: unknown }>;
    expect(p.title).toBe("Price today and tomorrow");
    expect(p.bars).toHaveLength(192);
    expect(p.sell).toHaveLength(192);
    expect(p.sell[100]).toBeNull(); // no sell price tomorrow
    expect(p.now).toBeGreaterThanOrEqual(0);
    expect(p.tiles.map((x) => x.label)).toEqual(["Now", "Today", "Tomorrow", "Cheapest hour", "Cheapest 3 h"]);
    expect(p.tiles[0].value).toBe(`${(1 + (p.now % 8) / 10).toFixed(2)} SEK/kWh`);
    expect(p.grid.length).toBeGreaterThan(0);
  });

  test("Price view: hourly sell under quarter-hour buy still draws a line; negative prices go below zero", async () => {
    const buyQ = Array.from({ length: 96 }, (_, i) => (i % 8 === 0 ? -0.5 : 1 + (i % 8) / 10));
    const sellH = Array.from({ length: 24 }, (_, h) => (h === 3 ? -0.2 : 0.8));
    const states = {
      ...eveningStates,
      "sensor.price": ["1.23", { unit_of_measurement: "SEK/kWh", today: buyQ, tomorrow: [] }] as [string, Record<string, unknown>],
      "sensor.sell": ["0.8", { today: sellH, tomorrow: [] }] as [string, Record<string, unknown>],
    };
    const card = await mount({ ...houseConfig, grid: { ...houseConfig.grid!, sell_price: "sensor.sell" } }, states);
    const p = (await card.snapshotFull())!.price as { sell: (number | null)[]; bars: { f: number }[]; zero: number };
    expect(p.sell.every((v) => v !== null)).toBe(true);
    expect(p.sell[12]).toBe(p.sell[13]); // 03:00 and 03:15: the same hourly sell price
    expect(p.zero).toBeGreaterThan(0);
    expect(p.bars[0].f).toBeLessThan(p.zero); // -0.50 below the zero line
    expect(p.sell[12]!).toBeLessThan(p.zero); // -0.20 too
    expect(p.bars[1].f).toBeGreaterThan(p.zero);
  });

  test("Price view: a card with only the prices, no tabs, bars with time and price", async () => {
    const quarters = Array.from({ length: 96 }, (_, i) => 1 + (i % 8) / 10);
    const states = {
      ...eveningStates,
      "sensor.price": ["1.23", { unit_of_measurement: "SEK/kWh", today: quarters, tomorrow: [] }] as [string, Record<string, unknown>],
    };
    const card = await mount({ ...houseConfig, views: ["price"], show_header: false }, states);
    const r = root(card);
    expect(r.querySelector(".tabs")).toBeNull();
    expect(r.querySelector(".header")).toBeNull();
    expect(r.querySelector(".section-title")?.textContent).toBe("Price today");
    const bars = r.querySelectorAll("svg.price-chart rect");
    expect(bars).toHaveLength(96);
    expect(bars[0].querySelector("title")?.textContent).toBe("00:00 1.00 SEK/kWh");
    expect(r.querySelectorAll(".price-tiles .tile").length).toBeGreaterThanOrEqual(4);
  });

  test("views picks and orders the tabs; the header price opens Price", async () => {
    const quarters = Array.from({ length: 96 }, () => 1.5);
    const states = {
      ...eveningStates,
      "sensor.price": ["1.23", { unit_of_measurement: "SEK/kWh", today: quarters, tomorrow: [] }] as [string, Record<string, unknown>],
    };
    const card = await mount({ ...houseConfig, views: ["now", "price"] }, states);
    const labels = [...root(card).querySelectorAll(".tabs button")].map((b) => b.textContent?.trim());
    expect(labels).toEqual(["Now", "Price"]);
    root(card).querySelector<HTMLElement>(".price")!.click();
    await card.updateComplete;
    expect(tab(card, "Price").getAttribute("aria-pressed")).toBe("true");
    expect(root(card).querySelector("svg.price-chart")).not.toBeNull();
  });

  test("unknown views are refused", () => {
    const card = document.createElement("power-flow-card-now-flow-forecast") as PowerFlowCardNowFlowForecast;
    expect(() => card.setConfig({ ...houseConfig, views: ["prices" as "price"] })).toThrow(/views: unknown prices/);
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
