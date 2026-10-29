"""The card's Now view drawn natively with LVGL, from the renderer's /model.json.

The renderer runs the real card and serves its snapshot() as JSON, so the
texts and figures are the card's own; this component only lays them out.
"""

import esphome.codegen as cg
from esphome.components.esp32 import request_http_client
from esphome.components.lvgl.defines import TYPE_FLEX, add_lv_use
from esphome.components.lvgl.lv_validation import lv_font
import esphome.config_validation as cv
from esphome.const import CONF_ID, CONF_URL

CONF_POLL_INTERVAL = "poll_interval"

DEPENDENCIES = ["lvgl", "network"]
AUTO_LOAD = ["json"]

energy_ui_ns = cg.esphome_ns.namespace("energy_ui")
EnergyUi = energy_ui_ns.class_("EnergyUi", cg.Component)

FONTS = ["font_small", "font_medium", "font_bold", "font_large", "font_icons"]


def _lv_parts(config):
    # ESPHome compiles only the LVGL widgets the yaml uses; this component
    # creates its own. Added while validating, before LVGL generates its code.
    add_lv_use("label", "line", "bar", TYPE_FLEX)
    return config


CONFIG_SCHEMA = cv.All(
    cv.Schema(
    {
        cv.GenerateID(): cv.declare_id(EnergyUi),
        cv.Required(CONF_URL): cv.url,
        cv.Optional(CONF_POLL_INTERVAL, default="3s"): cv.positive_time_period_milliseconds,
        # lv_font: registers the fonts with LVGL (get_lv_font())
        **{cv.Required(key): lv_font for key in FONTS},
    }
    ).extend(cv.COMPONENT_SCHEMA),
    _lv_parts,
)


async def to_code(config):
    # ESPHome leaves unused IDF components out; the fetch task uses esp_http_client
    request_http_client()
    var = cg.new_Pvariable(config[CONF_ID])
    await cg.register_component(var, config)
    cg.add(var.set_url(config[CONF_URL]))
    cg.add(var.set_interval_ms(config[CONF_POLL_INTERVAL].total_milliseconds))
    for key in FONTS:
        cg.add(getattr(var, f"set_{key}")(await cg.get_variable(config[key])))
