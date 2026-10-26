// Reads recorder history over the websocket and turns it into the series
// that src/review.ts works on.
import { friendlyName } from "./hass";
import { LOAD_PALETTE } from "./model";
import type { ReviewBattery, ReviewInput, ReviewLoad, Series } from "./review";
import { mapSeries, sumSeries } from "./review";
import type { CardConfig, EntityList, HomeAssistant } from "./types";

/** Compressed state from history/history_during_period (times in seconds). */
interface CompressedState {
  s: string;
  lu: number;
  lc?: number;
}

const DEFAULT_LOAD_THRESHOLD_W = 30;
const POWER_FACTORS: Record<string, number> = { w: 1, kw: 1000, mw: 1_000_000 };

const list = (e: EntityList | undefined): string[] => (e === undefined ? [] : Array.isArray(e) ? e : [e]);

/** Every entity the Review needs, without duplicates. */
export const reviewEntities = (config: CardConfig): string[] => {
  const ids = [
    config.grid?.entity,
    config.grid?.price,
    config.solar?.entity,
    ...(config.batteries ?? []).flatMap((b) => [
      b.state_of_charge,
      ...list(b.entity),
      ...list(b.charge_entity),
      ...list(b.discharge_entity),
    ]),
    ...(config.large_loads ?? []).flatMap((l) => [l.entity, l.soc, l.session_cost]),
    ...(config.phases ?? []),
  ];
  return [...new Set(ids.filter((id): id is string => !!id))];
};

export const toSeries = (states: CompressedState[] | undefined): Series =>
  (states ?? []).map((st) => {
    const v = st.s === "" || st.s === "unknown" || st.s === "unavailable" ? NaN : Number(st.s);
    return { t: (st.lc ?? st.lu) * 1000, v: Number.isFinite(v) ? v : NaN };
  });

export const fetchHistory = async (
  hass: HomeAssistant,
  entityIds: string[],
  start: number,
  end: number,
): Promise<Record<string, Series>> => {
  if (!hass.callWS) throw new Error("history is not available");
  if (!entityIds.length) return {};
  const raw = await hass.callWS<Record<string, CompressedState[]>>({
    type: "history/history_during_period",
    start_time: new Date(start).toISOString(),
    end_time: new Date(end).toISOString(),
    entity_ids: entityIds,
    minimal_response: true,
    no_attributes: true,
    significant_changes_only: false,
  });
  return Object.fromEntries(entityIds.map((id) => [id, toSeries(raw?.[id])]));
};

/** History in W, using the entity's current unit (history is fetched without attributes). */
const powerSeries = (hass: HomeAssistant, history: Record<string, Series>, ids: string[]): Series | undefined => {
  const parts = ids
    .filter((id) => history[id]?.length)
    .map((id) => {
      const unit = String(hass.states[id]?.attributes?.unit_of_measurement ?? "W").toLowerCase();
      const factor = POWER_FACTORS[unit] ?? 1;
      return factor === 1 ? history[id] : mapSeries(history[id], (v) => v * factor);
    });
  return parts.length ? sumSeries(parts) : undefined;
};

const present = (history: Record<string, Series>, id: string | undefined): Series | undefined =>
  id && history[id]?.length ? history[id] : undefined;

export const buildReviewInput = (
  hass: HomeAssistant,
  config: CardConfig,
  history: Record<string, Series>,
  start: number,
  end: number,
): ReviewInput => {
  const grid = config.grid?.entity ? powerSeries(hass, history, [config.grid.entity]) : undefined;
  const batteries: ReviewBattery[] = (config.batteries ?? []).map((b, i, all) => {
    let power: Series | undefined;
    if (b.entity !== undefined) {
      power = powerSeries(hass, history, list(b.entity));
      if (power && b.invert_state) power = mapSeries(power, (v) => -v);
    } else {
      const charge = powerSeries(hass, history, list(b.charge_entity));
      const discharge = powerSeries(hass, history, list(b.discharge_entity));
      power = charge && discharge ? sumSeries([charge, mapSeries(discharge, (v) => -v)]) : charge;
    }
    const firstOutside = all.findIndex((x) => !x.inside_home);
    return {
      name: b.name ?? friendlyName(hass, b.state_of_charge),
      power,
      soc: present(history, b.state_of_charge),
      primary: i === (firstOutside >= 0 ? firstOutside : 0),
    };
  });
  const loads: ReviewLoad[] = (config.large_loads ?? []).flatMap((l, i) => {
    const power = powerSeries(hass, history, [l.entity]);
    return power
      ? [{
          name: l.name ?? friendlyName(hass, l.entity),
          icon: l.icon ?? "mdi:flash",
          color: l.color ?? LOAD_PALETTE[i % LOAD_PALETTE.length],
          power,
          threshold: l.threshold ?? DEFAULT_LOAD_THRESHOLD_W,
          soc: present(history, l.soc),
          sessionCost: present(history, l.session_cost),
        }]
      : [];
  });
  return {
    start,
    end,
    grid: grid && config.grid?.invert_state ? mapSeries(grid, (v) => -v) : grid,
    price: present(history, config.grid?.price),
    solar: config.solar?.entity ? powerSeries(hass, history, [config.solar.entity]) : undefined,
    batteries,
    loads,
    phases: (config.phases ?? []).map((id) => present(history, id)).filter((s): s is Series => !!s),
  };
};
