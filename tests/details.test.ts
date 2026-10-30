import { describe, expect, it } from "vitest";
import { nodeDetails } from "../src/details";
import { houseConfig, makeHass } from "./helpers";

const NOW = new Date("2026-10-30T14:00:00+01:00");
const H = 3_600_000;
const end = NOW.getTime();
const start = end - 24 * H;
const hourAt = (ms: number) => new Date(ms).toISOString();

describe("home detail: LoadCast forecast against the outcome", () => {
  // Live forecast: 3 kWh/h from the hour now running on
  const live = Array.from({ length: 24 }, (_, i) => ({ period_start: hourAt(end + i * H), kwh: 3 }));
  const home = (past?: unknown[]) =>
    nodeDetails(
      makeHass({ "sensor.home": "1000", "sensor.loadcast": ["40", { forecast: live, ...(past ? { past } : {}) }] }),
      houseConfig,
      { start, end, history: {} },
      NOW,
    ).find((d) => d.id === "home");

  it("draws each past hour as LoadCast forecast it when it began", () => {
    const past = Array.from({ length: 48 }, (_, i) => ({ period_start: hourAt(end - (47 - i) * H), kwh: 1 }));
    const d = home(past);
    expect(d?.forecast?.every((v) => v === 1000)).toBe(true);
    expect(d?.legend.forecast).toBe("forecast");
    expect(d?.forecastColor).toBe(0xb39df0);
    expect(d?.stats.find((s) => s.label === "Forecast, 24 h")?.value).toMatch(/^24(\.0)? kWh$/);
  });

  it("leaves hours without an issued forecast empty and gives no 24 h total then", () => {
    const past = Array.from({ length: 6 }, (_, i) => ({ period_start: hourAt(end - (6 - i) * H), kwh: 2 }));
    const d = home(past);
    expect(d?.forecast?.slice(0, 72).every((v) => v === null)).toBe(true);
    expect(d?.forecast?.[72]).toBe(2000);
    expect(d?.forecast?.[95]).toBe(2000);
    expect(d?.stats.some((s) => s.label === "Forecast, 24 h")).toBe(false);
  });

  it("has no forecast line before LoadCast 0.1.7 (no `past`)", () => {
    expect(home()?.forecast).toBeNull();
  });
});
