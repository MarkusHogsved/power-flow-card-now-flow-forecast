import { LitElement, html, nothing, type PropertyValues } from "lit";
import { formatNumber, formatPower, formatUntil } from "./hass";
import { buildReviewInput, fetchHistory, reviewEntities } from "./history";
import { computeModel, type Model } from "./model";
import { computeReview } from "./review";
import { t } from "./strings";
import { styles } from "./styles";
import type { CardConfig, HomeAssistant, ViewName } from "./types";
import type { ViewContext } from "./views/context";
import { renderFlow } from "./views/flow";
import { renderForecast } from "./views/forecast";
import { renderNow } from "./views/now";
import { renderReview, type ReviewHours, type ReviewState } from "./views/review";

const CARD_TYPE = "power-flow-card-now-flow-forecast";
export const VERSION = "0.3.3";
const VIEWS: ViewName[] = ["now", "flow", "forecast", "review"];
/** Review history is fetched again when older than this. */
const REVIEW_MAX_AGE_MS = 5 * 60_000;

const storageKey = (config: CardConfig, what = "view"): string => `${CARD_TYPE}:${what}:${config.view_key ?? "default"}`;

const loadHours = (config: CardConfig): ReviewHours => {
  try {
    return localStorage.getItem(storageKey(config, "review-hours")) === "12" ? 12 : 24;
  } catch {
    return 24;
  }
};

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
    _review: { state: true },
    _reasonOpen: { state: true },
  };

  hass?: HomeAssistant;
  private _config?: CardConfig;
  private _view: ViewName = "now";
  private _review: ReviewState = { hours: 24, loading: false };
  private _reviewFetchedAt = 0;
  private _reviewRequest = 0;
  /** The import reason's longer explanation is unfolded. */
  private _reasonOpen = false;

  setConfig(config: CardConfig): void {
    if (!config?.home?.entity) throw new Error("home.entity is required");
    if (config.default_view && !VIEWS.includes(config.default_view)) {
      throw new Error(`default_view must be one of ${VIEWS.join(", ")}`);
    }
    this._config = config;
    this._view = loadView(config);
    this._review = { hours: loadHours(config), loading: false };
    this._reviewFetchedAt = 0;
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

  private _setHours = (hours: ReviewHours): void => {
    if (hours === this._review.hours) return;
    this._review = { hours, loading: false };
    this._reviewFetchedAt = 0;
    try {
      if (this._config) localStorage.setItem(storageKey(this._config, "review-hours"), String(hours));
    } catch {
      // not persisted - fine
    }
  };

  // Starting the fetch here (not in updated) sets the loading state in the
  // same render instead of scheduling another one.
  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed);
    if (this._view !== "review" || !this.hass?.callWS || !this._config || this._review.loading) return;
    if (Date.now() - this._reviewFetchedAt < REVIEW_MAX_AGE_MS) return;
    void this._loadReview();
  }

  private async _loadReview(): Promise<void> {
    const hass = this.hass as HomeAssistant;
    const config = this._config as CardConfig;
    const hours = this._review.hours;
    const request = ++this._reviewRequest;
    const end = Date.now();
    const start = end - hours * 3_600_000;
    this._reviewFetchedAt = end;
    this._review = { ...this._review, loading: true, error: undefined };
    try {
      const history = await fetchHistory(hass, reviewEntities(config), start, end);
      if (request !== this._reviewRequest) return;
      const data = computeReview(buildReviewInput(hass, config, history, start, end));
      this._review = { hours, data, loading: false };
    } catch (err) {
      if (request !== this._reviewRequest) return;
      // keep the last result, if any, and show the error with it
      this._review = { ...this._review, loading: false, error: err instanceof Error ? err.message : String(err) };
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
          ${model.status === "importing" ? this._importReason() : nothing}
        </div>
        ${model.price !== null
          ? html`<div class="price" @click=${() => this._moreInfo(this._config?.grid?.price)}>
              ${t("price")}
              <b>${formatNumber(hass, model.price, 2)}</b>
              <span>${model.priceUnit}</span>
            </div>`
          : nothing}
      </div>
    `;
  }

  /** "Why we buy, and until when" from grid.import_reason, with the detail behind an info button. */
  private _importReason() {
    const hass = this.hass as HomeAssistant;
    const entityId = this._config?.grid?.import_reason;
    const entity = entityId ? hass.states[entityId] : undefined;
    if (!entity || !entity.state || ["unknown", "unavailable"].includes(entity.state)) return nothing;
    const detail = typeof entity.attributes.detail === "string" ? entity.attributes.detail : "";
    const untilRaw = entity.attributes.until;
    const until = typeof untilRaw === "string" && untilRaw ? new Date(untilRaw) : null;
    let untilText = "";
    if (until && !Number.isNaN(until.getTime())) {
      const u = formatUntil(hass, until, new Date());
      untilText = t(u.tomorrow ? "reason.until_tomorrow" : "reason.until", { time: u.time });
    }
    return html`
      <div class="reason">
        <span @click=${() => this._moreInfo(entityId)}>${entity.state}${untilText ? ` · ${untilText}` : ""}</span>
        ${detail
          ? html`<button
              type="button"
              class="reason-info"
              aria-label=${t("reason.more")}
              aria-expanded=${this._reasonOpen ? "true" : "false"}
              @click=${() => (this._reasonOpen = !this._reasonOpen)}
            >
              <ha-icon icon="mdi:information-outline"></ha-icon>
            </button>`
          : nothing}
      </div>
      ${detail && this._reasonOpen ? html`<div class="reason-detail">${detail}</div>` : nothing}
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
        ${this._view === "now"
          ? renderNow(ctx)
          : this._view === "flow"
            ? renderFlow(ctx)
            : this._view === "forecast"
              ? renderForecast(ctx)
              : renderReview(ctx, this._review, this._setHours)}
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
    description: "Home energy in four views: live flow, where the power goes, whether the batteries will last, and how the last day went.",
  });
  console.info(`%c⚡ ${CARD_TYPE} v${VERSION}`, "color: #4FC1B0; font-weight: 600");
}
