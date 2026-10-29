import { formatNumber, formatPercent, formatPower, formatUntil } from "./hass";
import { COLORS, type Flows, type Model } from "./model";
import { t } from "./strings";
import type { CardConfig, HomeAssistant } from "./types";
import type { ViewContext } from "./views/context";
import { nowFigures, phaseBar, vehicleTexts } from "./views/now";

/** Header texts: status, what drives it, the import reason and the price. */
export const headerTexts = (hass: HomeAssistant, config: CardConfig, model: Model, now: Date) => {
  const detail: Record<string, string> = {
    importing: t("status.detail.importing", { power: formatPower(hass, model.gridImportW) }),
    exporting: t("status.detail.exporting", { power: formatPower(hass, model.gridExportW) }),
    solar: t("status.detail.solar", { power: formatPower(hass, model.solarW) }),
    battery: t("status.detail.battery"),
    idle: "",
  };
  let reason: { text: string; detail: string } | null = null;
  const entity = config.grid?.import_reason ? hass.states[config.grid.import_reason] : undefined;
  if (model.status === "importing" && entity?.state && !["unknown", "unavailable"].includes(entity.state)) {
    const untilRaw = entity.attributes.until;
    const until = typeof untilRaw === "string" && untilRaw ? new Date(untilRaw) : null;
    let untilText = "";
    if (until && !Number.isNaN(until.getTime())) {
      const u = formatUntil(hass, until, now);
      untilText = t(u.tomorrow ? "reason.until_tomorrow" : "reason.until", { time: u.time });
    }
    reason = {
      text: `${entity.state}${untilText ? ` · ${untilText}` : ""}`,
      detail: typeof entity.attributes.detail === "string" ? entity.attributes.detail : "",
    };
  }
  return {
    title: t(`status.${model.status}`),
    subtitle: `${formatPower(hass, model.homeW)}${detail[model.status] ? ` · ${detail[model.status]}` : ""}`,
    reason,
    price:
      model.price !== null
        ? { name: config.grid?.price_name ?? t("price"), value: formatNumber(hass, model.price, 2), unit: model.priceUnit }
        : null,
  };
};

/** Colors as 0xRRGGBB, for displays that draw the card themselves. */
const rgb = (hex: string): number => parseInt(hex.replace("#", "").slice(0, 6), 16);

/**
 * Everything the Now view shows, as plain data with the texts already
 * formatted - for a display that draws its own interface (display/esphome)
 * instead of showing a picture of the card. Powers are in W, flows too.
 */
export const nowSnapshot = (ctx: ViewContext) => {
  const { hass, config, model: m } = ctx;
  const fig = nowFigures(ctx);
  const flows: Flows = m.flows;
  return {
    v: 1,
    time: formatUntil(hass, ctx.now, ctx.now).time,
    header: headerTexts(hass, config, m, ctx.now),
    colors: { solar: rgb(COLORS.solar), grid: rgb(COLORS.grid), battery: rgb(COLORS.battery), low: rgb(COLORS.batteryLow) },
    labels: {
      solar: t("node.solar"),
      grid: t("node.grid"),
      home: t("node.home"),
      batteries: t("node.batteries"),
      running: t("running_now"),
      other: t("other"),
      rest: t("rest_of_home"),
      fuse: t("fuse", { amps: String(m.fuseA) }),
    },
    solar: config.solar
      ? { w: m.solarW, text: formatPower(hass, m.solarW), today: fig.solarToday, forecast: fig.solarForecast }
      : null,
    grid: config.grid
      ? {
          importW: m.gridImportW,
          exportW: m.gridExportW,
          text: `${m.gridExportW > 0 ? "← " : ""}${formatPower(hass, m.gridImportW || m.gridExportW)}`,
          today: fig.gridToday,
          cost: fig.gridCost,
          expected: fig.gridExpected,
        }
      : null,
    home: { w: m.homeW, text: formatPower(hass, m.homeW) },
    flows,
    bank: {
      text: fig.bankText,
      cells: m.batteries.map((b) => ({
        name: b.name,
        soc: b.soc,
        socText: b.soc === null ? "–" : formatPercent(hass, b.soc),
        arrow: b.powerW < 0 ? "↑" : b.powerW > 0 ? "↓" : "",
        powerText: b.powerW ? formatPower(hass, b.powerW) : "",
        low: b.soc !== null && b.soc < 30,
      })),
    },
    running: m.running.map((l) => {
      const v = vehicleTexts(ctx, l);
      return {
        name: l.name,
        icon: l.icon,
        color: rgb(l.color),
        w: l.powerW,
        text: formatPower(hass, l.powerW),
        lines: v ? [v.level, v.left, v.cost].filter((s) => s) : [],
      };
    }),
    others: m.loads.length
      ? [
          { name: t("rest_of_home"), text: formatPower(hass, m.restW) },
          ...m.loads.map((l) => ({ name: l.name, text: formatPower(hass, l.powerW) })),
        ]
      : [],
    phases: m.phases.map((p) => ({
      name: p.name,
      text: p.amps === null ? "–" : `${formatNumber(hass, Math.abs(p.amps), 1)} A`,
      ...phaseBar(p.amps, m.fuseA),
    })),
  };
};

export type NowSnapshot = ReturnType<typeof nowSnapshot>;
