import { LitElement, html, nothing, type PropertyValues } from "lit";
import { buildReviewInput, fetchHistory, reviewEntities } from "./history";
import { computeModel, type Model } from "./model";
import { computeReview } from "./review";
import {
  fullSnapshot,
  headerTexts,
  nowSnapshot,
  type FullSnapshot,
  type NowSnapshot,
  type VehicleHistory,
} from "./snapshot";
import { t } from "./strings";
import { styles } from "./styles";
import type { CardConfig, HomeAssistant, ViewName } from "./types";
import type { ViewContext } from "./views/context";
import { renderFlow } from "./views/flow";
import { renderForecast } from "./views/forecast";
import { renderNow } from "./views/now";
import { renderReview, type ReviewHours, type ReviewState } from "./views/review";
import { VEHICLE_HOURS, type VehicleChartState } from "./views/vehicle";

const CARD_TYPE = "power-flow-card-now-flow-forecast";
export const VERSION = "0.6.1";
const VIEWS: ViewName[] = ["now", "flow", "forecast", "review"];
/** Review history is fetched again when older than this. */
const REVIEW_MAX_AGE_MS = 5 * 60_000;
/** An unfolded vehicle tile refreshes its history at most this often. */
const VEHICLE_MAX_AGE_MS = 60_000;

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
    _vehicle: { state: true },
    _reviewOpen: { state: true },
  };

  hass?: HomeAssistant;
  private _config?: CardConfig;
  private _view: ViewName = "now";
  private _review: ReviewState = { hours: 24, loading: false };
  private _reviewFetchedAt = 0;
  private _reviewRequest = 0;
  /** The import reason's longer explanation is unfolded. */
  private _reasonOpen = false;
  /** History under an unfolded vehicle tile. */
  private _vehicle?: VehicleChartState;
  private _vehicleFetchedAt = 0;
  private _vehicleRequest = 0;
  /** Start of the Review event whose chart is unfolded. */
  private _reviewOpen?: number;

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
    if (
      this._vehicle &&
      !this._vehicle.loading &&
      this.hass?.callWS &&
      Date.now() - this._vehicleFetchedAt >= VEHICLE_MAX_AGE_MS
    ) {
      void this._loadVehicle();
    }
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

  private _toggleVehicle = (entityId: string): void => {
    if (this._vehicle?.entity === entityId) {
      this._vehicle = undefined;
      return;
    }
    this._vehicle = { entity: entityId, loading: false };
    this._vehicleFetchedAt = 0;
  };

  private async _loadVehicle(): Promise<void> {
    const hass = this.hass as HomeAssistant;
    const entity = (this._vehicle as VehicleChartState).entity;
    const soc = this._config?.large_loads?.find((l) => l.entity === entity)?.soc;
    const request = ++this._vehicleRequest;
    const end = Date.now();
    const start = end - VEHICLE_HOURS * 3_600_000;
    this._vehicleFetchedAt = end;
    this._vehicle = { ...(this._vehicle as VehicleChartState), loading: true };
    try {
      const history = await fetchHistory(hass, soc ? [entity, soc] : [entity], start, end);
      if (request !== this._vehicleRequest || this._vehicle?.entity !== entity) return;
      this._vehicle = { entity, loading: false, start, end, power: history[entity], soc: soc ? history[soc] : undefined };
    } catch (err) {
      if (request !== this._vehicleRequest || this._vehicle?.entity !== entity) return;
      this._vehicle = { ...this._vehicle, loading: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private _moreInfo = (entityId: string | undefined): void => {
    if (!entityId) return;
    this.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true }));
  };

  private _header(model: Model) {
    const h = headerTexts(this.hass as HomeAssistant, this._config as CardConfig, model, new Date());
    return html`
      <div class="header">
        <div>
          <div class="title">${h.title}</div>
          <div class="subtitle">${h.subtitle}</div>
          ${h.reason ? this._importReason(h.reason) : nothing}
        </div>
        ${h.price
          ? html`<div class="price" @click=${() => this._moreInfo(this._config?.grid?.price)}>
              ${h.price.name}
              <b>${h.price.value}</b>
              <span>${h.price.unit}</span>
            </div>`
          : nothing}
      </div>
    `;
  }

  /** "Why we buy, and until when" from grid.import_reason, with the detail behind an info button. */
  private _importReason(reason: { text: string; detail: string }) {
    const entityId = this._config?.grid?.import_reason;
    return html`
      <div class="reason">
        <span @click=${() => this._moreInfo(entityId)}>${reason.text}</span>
        ${reason.detail
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
      ${reason.detail && this._reasonOpen ? html`<div class="reason-detail">${reason.detail}</div>` : nothing}
    `;
  }

  private _context(model: Model): ViewContext {
    return {
      hass: this.hass as HomeAssistant,
      config: this._config as CardConfig,
      model,
      now: new Date(),
      moreInfo: this._moreInfo,
      vehicle: this._vehicle,
      toggleVehicle: this._toggleVehicle,
      reviewOpen: this._reviewOpen,
      toggleReviewEvent: (start: number) => (this._reviewOpen = this._reviewOpen === start ? undefined : start),
    };
  }

  /** The Now view as plain data, for displays that draw their own interface (display/esphome). */
  snapshot(): NowSnapshot | null {
    if (!this._config || !this.hass) return null;
    return nowSnapshot(this._context(computeModel(this.hass, this._config)));
  }

  /** History of running vehicles for snapshotFull(), fetched at most once a minute each. */
  private _snapVehicles = new Map<string, VehicleHistory & { at: number }>();
  /** When each vehicle's history was last asked for (a failed request waits a minute too). */
  private _snapAsked = new Map<string, number>();

  /**
   * All four views as plain data (display/esphome). Review's history and the
   * running vehicles' history are refreshed in the background when stale -
   * never awaited, so a slow recorder cannot hold up the live figures (the
   * display gives up after 5 s); they show from the next snapshot on.
   */
  async snapshotFull(): Promise<FullSnapshot | null> {
    if (!this._config || !this.hass) return null;
    const hass = this.hass;
    if (hass.callWS && !this._review.loading && Date.now() - this._reviewFetchedAt >= REVIEW_MAX_AGE_MS) {
      void this._loadReview();
    }
    const model = computeModel(hass, this._config);
    if (hass.callWS) {
      for (const l of model.running.filter((v) => v.socEntity)) {
        const asked = this._snapAsked.get(l.entity) ?? 0;
        if (Date.now() - asked < VEHICLE_MAX_AGE_MS) continue;
        const end = Date.now();
        this._snapAsked.set(l.entity, end);
        const start = end - VEHICLE_HOURS * 3_600_000;
        const soc = l.socEntity as string;
        fetchHistory(hass, [l.entity, soc], start, end).then(
          (history) => this._snapVehicles.set(l.entity, { at: end, start, end, power: history[l.entity] ?? [], soc: history[soc] }),
          () => undefined, // no chart this time; the tile itself still shows
        );
      }
    }
    return fullSnapshot(this._context(model), this._review, this._snapVehicles);
  }

  protected override render() {
    if (!this._config || !this.hass) return nothing;
    const model = computeModel(this.hass, this._config);
    const ctx = this._context(model);
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
