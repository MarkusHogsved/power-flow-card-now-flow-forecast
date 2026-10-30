import { describe, expect, it } from "vitest";
import { nodeDetails } from "../src/details";
import { houseConfig, makeHass } from "./helpers";

const NOW = new Date("2026-10-30T14:00:00+01:00");
const H = 3_600_000;
const end = NOW.getTime();
const start = end - 24 * H;
const hourAt = (ms: number) => new Date(ms).toISOString();

describe("home detail: LoadCast forecast against the outcome", () => {
  // Each published forecast says 1 kWh/h for its first hour and 2 kWh/h after it
  const issue = (at: number) => ({
    at,
    hours: Array.from({ length: 48 }, (_, i) => ({ start: at + i * H, kwh: i === 0 ? 1 : 2 })),
  });
  const live = Array.from({ length: 24 }, (_, i) => ({ period_start: hourAt(end + i * H), kwh: 3 }));
  const hass = makeHass({ "sensor.home": "1000", "sensor.loadcast": ["40", { forecast: live }] });

  it("takes for each past hour the forecast in force when the hour began", () => {
    const loadcast = Array.from({ length: 24 }, (_, i) => issue(start + i * H));
    const home = nodeDetails(hass, houseConfig, { start, end, history: {}, loadcast }, NOW).find((d) => d.id === "home");
    // The issue made at the hour's start says 1 kWh for it = 1000 W, not the 2000 W of earlier issues
    expect(home?.forecast?.every((v) => v === 1000)).toBe(true);
    expect(home?.legend.forecast).toBe("forecast");
    expect(home?.stats.find((s) => s.label === "Forecast, 24 h")?.value).toMatch(/^24(\.0)? kWh$/);
  });

  it("falls back to the earliest forecast that covers an hour issued before history starts", () => {
    const loadcast = [issue(start + 6 * H)];
    const home = nodeDetails(hass, houseConfig, { start, end, history: {}, loadcast }, NOW).find((d) => d.id === "home");
    expect(home?.forecast?.slice(0, 24).every((v) => v === null)).toBe(true);
    expect(home?.forecast?.[24]).toBe(1000);
    expect(home?.forecast?.[28]).toBe(2000);
    // Not the whole window covered: no 24 h total that would compare badly with "Used"
    expect(home?.stats.some((s) => s.label === "Forecast, 24 h")).toBe(false);
  });

  it("has no forecast line without LoadCast history", () => {
    const home = nodeDetails(hass, houseConfig, { start, end, history: {} }, NOW).find((d) => d.id === "home");
    expect(home?.forecast).toBeNull();
  });
});
