import type { Model } from "../model";
import type { CardConfig, HomeAssistant } from "../types";

export interface ViewContext {
  hass: HomeAssistant;
  config: CardConfig;
  model: Model;
  now: Date;
  /** Opens Home Assistant's more-info dialog for the entity. */
  moreInfo: (entityId: string | undefined) => void;
}
