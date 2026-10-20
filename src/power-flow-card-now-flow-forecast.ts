import { LitElement, html, nothing } from "lit";
import { formatNumber, formatPower } from "./hass";
import { computeModel, type Model } from "./model";
import { t } from "./strings";
import { styles } from "./styles";
import type { CardConfig, HomeAssistant, ViewName } from "./types";
import type { ViewContext } from "./views/context";
import { renderFlow } from "./views/flow";
import { renderForecast } from "./views/forecast";
import { renderNow } from "./views/now";

const CARD_TYPE = "power-flow-card-now-flow-forecast";
export const VERSION = "0.1.0";
const VIEWS: ViewName[] = ["now", "flow", "forecast"];

const storageKey = (config: CardConfig): string => `${CARD_TYPE}:view:${config.view_key ?? "default"}`;

const loadView = (config: CardConfig): ViewName => {
  try {
    const saved = localStorage.getItem(storageKey(config)) as ViewName | null;
    if (saved && VIEWS.includes(saved)) return saved;
  } catch {
    // storage blocked (private mode, previews) - fall back to the default view
  }
  return config.default_view ?? "now";
};

export class PowerFlowCardNowFlowForecast extends LitElement {
  static override styles = styles;

  static override properties = {
    hass: { attribute: false },
    _config: { state: true },
    _view: { state: true },
  };

  hass?: HomeAssistant;
  private _config?: CardConfig;
  private _view: ViewName = "now";

  setConfig(config: CardConfig): void {
    if (!config?.home?.entity) throw new Error("home.entity is required");
    if (config.default_view && !VIEWS.includes(config.default_view)) {
      throw new Error(`default_view must be one of ${VIEWS.join(", ")}`);
    }
    this._config = config;
    this._view = loadView(config);
  }

  getCardSize(): number {
    return 9;
  }

  static getStubConfig(): Partial<CardConfig> {
    return { home: { entity: "" } };
  }

  private _select(view: ViewName): void {
    this._view = view;
    try {
      if (this._config) localStorage.setItem(storageKey(this._config), view);
    } catch {
      // not persisted - fine
    }
  }

  private _moreInfo = (entityId: string | undefined): void => {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  };

  private _header(model: Model) {
    const hass = this.hass as HomeAssistant;
    const detail: Record<string, string> = {
      importing: t("status.detail.importing", { power: formatPower(hass, model.gridImportW) }),
      exporting: t("status.detail.exporting", { power: formatPower(hass, model.gridExportW) }),
      solar: t("status.detail.solar", { power: formatPower(hass, model.solarW) }),
      battery: t("status.detail.battery"),
      idle: "",
    };
    return html`
      <div class="header">
        <div>
          <div class="title">${t(`status.${model.status}`)}</div>
          <div class="subtitle">
            ${formatPower(hass, model.homeW)}${detail[model.status] ? ` · ${detail[model.status]}` : ""}
          </div>
        </div>
        ${model.price !== null
          ? html`<div class="price" @click=${() => this._moreInfo(this._config?.grid?.price)}>
              ${t("price")}
              <b>${formatNumber(hass, model.price, 2)} ${model.priceUnit.split("/")[0]}</b>
            </div>`
          : nothing}
      </div>
    `;
  }

  protected override render() {
    if (!this._config || !this.hass) return nothing;
    const model = computeModel(this.hass, this._config);
    const ctx: ViewContext = {
      hass: this.hass,
      config: this._config,
      model,
      now: new Date(),
      moreInfo: this._moreInfo,
    };
    return html`
      <ha-card>
        ${this._header(model)}
        <div class="tabs" role="group">
          ${VIEWS.map(
            (v) => html`<button type="button" aria-pressed=${this._view === v ? "true" : "false"} @click=${() => this._select(v)}>
              ${t(`view.${v}`)}
            </button>`,
          )}
        </div>
        ${this._view === "now" ? renderNow(ctx) : this._view === "flow" ? renderFlow(ctx) : renderForecast(ctx)}
      </ha-card>
    `;
  }
}

if (!customElements.get(CARD_TYPE)) {
  customElements.define(CARD_TYPE, PowerFlowCardNowFlowForecast);
  const w = window as unknown as { customCards?: unknown[] };
  w.customCards = w.customCards ?? [];
  w.customCards.push({
    type: CARD_TYPE,
    name: "Power Flow Card - Now / Flow / Forecast",
    description: "Home energy in three views: live flow, where the power goes, and whether the batteries will last.",
  });
  console.info(`%c⚡ ${CARD_TYPE} v${VERSION}`, "color: #4FC1B0; font-weight: 600");
}
