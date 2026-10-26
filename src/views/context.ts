import type { Model } from "../model";
import type { CardConfig, HomeAssistant } from "../types";
import type { VehicleChartState } from "./vehicle";

export interface ViewContext {
  hass: HomeAssistant;
  config: CardConfig;
  model: Model;
  now: Date;
  /** Opens Home Assistant's more-info dialog for the entity. */
  moreInfo: (entityId: string | undefined) => void;
  /** The unfolded vehicle tile's history, if any. */
  vehicle?: VehicleChartState;
  /** Unfolds or folds the history under a vehicle tile (by its power entity). */
  toggleVehicle: (entityId: string) => void;
}
