#include "energy_ui.h"

#include <cmath>
#include <cstring>

#include "esp_http_client.h"
#include "esphome/components/network/util.h"
#include "esphome/core/hal.h"
#include "esphome/core/log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

namespace esphome {
namespace energy_ui {

static const char *const TAG = "energy_ui";

// Palette, as the card on a black background
static const uint32_t TEXT = 0xF2F2F2;
static const uint32_t MUTED = 0xA8A8A8;
static const uint32_t TRACK = 0x2C3137;
static const uint32_t NODE_BORDER = 0x3A3F46;
static const uint32_t TILE_BG = 0x111418;
static const uint32_t WARN = 0xE57F84;
static const uint32_t SOLAR = 0xF5B942, GRID = 0x6CA8E8, BATTERY = 0x4FC1B0, BATTERY_LOW = 0xE0A93B;

// Landscape 1024 x 600: the tab rail on the left edge; in the rest (main_,
// MAIN_W wide) the header on top, the flow diagram left, loads and phases right
static const int RAIL_W = 80, MAIN_W = 1024 - RAIL_W;
static const int HEADER_H = 96;
// The price chart sits under the loads, above the phases
static const int PRICES_Y = 402, PRICES_H = 54;
static const int RIGHT_X = 620, RIGHT_W = MAIN_W - RIGHT_X - 16;

// MDI glyphs in the icon font (display yaml: font_icons)
const char *icon_glyph(const char *icon) {
  if (icon == nullptr) return "\U000F0241";
  if (strstr(icon, "battery")) return "\U000F0084";
  if (strstr(icon, "export")) return "\U000F192C";
  if (strstr(icon, "sunny") || strstr(icon, "solar")) return "\U000F05A8";
  if (strstr(icon, "car")) return "\U000F0B6C";
  if (strstr(icon, "heat-pump")) return "\U000F1A43";
  if (strstr(icon, "water-boiler")) return "\U000F0F92";
  if (strstr(icon, "pool")) return "\U000F0606";
  return "\U000F0241";  // flash
}
static const char *const ICON_SOLAR = "\U000F1A73";
static const char *const ICON_GRID = "\U000F0D3E";
static const char *const ICON_HOME = "\U000F02DC";

// ---------------------------------------------------------------- Paths

static Path line_path(int x0, int y0, int x1, int y1) {
  Path p;
  p.points = {{(lv_value_precise_t) x0, (lv_value_precise_t) y0}, {(lv_value_precise_t) x1, (lv_value_precise_t) y1}};
  return p;
}

static Path bezier_path(int x0, int y0, int cx0, int cy0, int cx1, int cy1, int x1, int y1) {
  Path p;
  const int n = 16;
  for (int i = 0; i <= n; i++) {
    float t = (float) i / n, u = 1 - t;
    float x = u * u * u * x0 + 3 * u * u * t * cx0 + 3 * u * t * t * cx1 + t * t * t * x1;
    float y = u * u * u * y0 + 3 * u * u * t * cy0 + 3 * u * t * t * cy1 + t * t * t * y1;
    p.points.push_back({(lv_value_precise_t) lroundf(x), (lv_value_precise_t) lroundf(y)});
  }
  return p;
}

static Path reversed(Path p) {
  std::reverse(p.points.begin(), p.points.end());
  return p;
}

static void measure(Path &p) {
  p.lengths.assign(p.points.size(), 0);
  for (size_t i = 1; i < p.points.size(); i++) {
    float dx = p.points[i].x - p.points[i - 1].x, dy = p.points[i].y - p.points[i - 1].y;
    p.lengths[i] = p.lengths[i - 1] + sqrtf(dx * dx + dy * dy);
  }
}

static const int DOT = 9;

// Moves a flow's dot along its path; v runs 0..1000 over the animation
static void dot_anim_cb(void *var, int32_t v) {
  auto *dot = static_cast<lv_obj_t *>(var);
  auto *path = static_cast<Path *>(lv_obj_get_user_data(dot));
  if (path == nullptr || path->points.size() < 2) return;
  float target = path->lengths.back() * v / 1000.0f;
  size_t i = 1;
  while (i < path->points.size() - 1 && path->lengths[i] < target) i++;
  float seg = path->lengths[i] - path->lengths[i - 1];
  float f = seg > 0 ? (target - path->lengths[i - 1]) / seg : 0;
  float x = path->points[i - 1].x + f * (path->points[i].x - path->points[i - 1].x);
  float y = path->points[i - 1].y + f * (path->points[i].y - path->points[i - 1].y);
  lv_obj_set_pos(dot, (int32_t) lroundf(x) - DOT / 2, (int32_t) lroundf(y) - DOT / 2);
}

// ---------------------------------------------------------------- Helpers

static void set_text(lv_obj_t *label, const char *text) {
  if (text == nullptr) text = "";
  if (strcmp(lv_label_get_text(label), text) != 0) lv_label_set_text(label, text);
}

static void show(lv_obj_t *obj, bool visible) {
  if (visible)
    lv_obj_remove_flag(obj, LV_OBJ_FLAG_HIDDEN);
  else
    lv_obj_add_flag(obj, LV_OBJ_FLAG_HIDDEN);
}

static lv_obj_t *plain(lv_obj_t *parent) {
  lv_obj_t *o = lv_obj_create(parent);
  lv_obj_remove_style_all(o);
  lv_obj_remove_flag(o, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_remove_flag(o, LV_OBJ_FLAG_CLICKABLE);
  return o;
}

lv_obj_t *EnergyUi::label_(lv_obj_t *parent, const lv_font_t *font, uint32_t color, int x, int y) {
  lv_obj_t *l = lv_label_create(parent);
  lv_label_set_text(l, "");
  lv_obj_set_style_text_font(l, font, 0);
  lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
  lv_obj_set_pos(l, x, y);
  return l;
}

lv_obj_t *EnergyUi::box_(lv_obj_t *parent, int x, int y, int w, int h, uint32_t border, int border_w) {
  lv_obj_t *b = plain(parent);
  lv_obj_set_pos(b, x, y);
  lv_obj_set_size(b, w, h);
  lv_obj_set_style_radius(b, 14, 0);
  lv_obj_set_style_bg_color(b, lv_color_hex(0x000000), 0);
  lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
  lv_obj_set_style_border_color(b, lv_color_hex(border), 0);
  lv_obj_set_style_border_width(b, border_w, 0);
  return b;
}

// ---------------------------------------------------------------- Fetching

struct Fetch {
  std::string *body;
  std::string etag;
};

static esp_err_t http_event(esp_http_client_event_t *evt) {
  auto *f = static_cast<Fetch *>(evt->user_data);
  if (evt->event_id == HTTP_EVENT_ON_DATA && evt->data_len > 0) {
    f->body->append(static_cast<const char *>(evt->data), evt->data_len);
  } else if (evt->event_id == HTTP_EVENT_ON_HEADER && strcasecmp(evt->header_key, "etag") == 0) {
    f->etag = evt->header_value;
  }
  return ESP_OK;
}

int EnergyUi::fetch_(std::string &body) {
  Fetch f{&body, ""};
  esp_http_client_config_t cfg{};
  cfg.url = this->url_.c_str();
  cfg.timeout_ms = 5000;
  cfg.event_handler = http_event;
  cfg.user_data = &f;
  cfg.buffer_size = 4096;
  esp_http_client_handle_t client = esp_http_client_init(&cfg);
  if (client == nullptr) return -1;
  if (!this->etag_.empty()) esp_http_client_set_header(client, "If-None-Match", this->etag_.c_str());
  int status = -1;
  if (esp_http_client_perform(client) == ESP_OK) status = esp_http_client_get_status_code(client);
  esp_http_client_cleanup(client);
  if (status == 200 && !f.etag.empty()) this->etag_ = f.etag;
  return status;
}

// Runs beside the main loop, so a slow answer never stalls the screen
void EnergyUi::fetch_task(void *arg) {
  auto *self = static_cast<EnergyUi *>(arg);
  for (;;) {
    // Wi-Fi starts after this component; a socket before the network stack
    // exists asserts in lwIP (crash at boot, seen 2026-10-29)
    if (!network::is_connected()) {
      vTaskDelay(pdMS_TO_TICKS(1000));
      continue;
    }
    std::string body;
    int status = self->fetch_(body);
    if (status == 200) {
      std::lock_guard<std::mutex> lock(self->mutex_);
      self->pending_ = std::move(body);
      self->has_pending_ = true;
      self->last_ok_ms_ = millis();
    } else if (status == 304) {
      self->last_ok_ms_ = millis();
    } else {
      ESP_LOGD(TAG, "model.json: %d", status);
    }
    vTaskDelay(pdMS_TO_TICKS(self->interval_ms_));
  }
}

// ---------------------------------------------------------------- Setup

void EnergyUi::setup() {
  this->build_();
  xTaskCreate(EnergyUi::fetch_task, "energy_ui", 8192, this, 2, nullptr);
}

void EnergyUi::dump_config() {
  ESP_LOGCONFIG(TAG, "Energy UI:\n  URL: %s\n  Interval: %u ms", this->url_.c_str(), (unsigned) this->interval_ms_);
}

void EnergyUi::build_() {
  this->screen_ = lv_screen_active();
  lv_obj_set_style_bg_color(this->screen_, lv_color_hex(0x000000), 0);
  lv_obj_set_style_bg_opa(this->screen_, LV_OPA_COVER, 0);
  lv_obj_remove_flag(this->screen_, LV_OBJ_FLAG_SCROLLABLE);
  this->main_ = plain(this->screen_);
  lv_obj_set_pos(this->main_, RAIL_W, 0);
  lv_obj_set_size(this->main_, MAIN_W, 600);
  lv_obj_t *now = plain(this->main_);
  lv_obj_set_size(now, MAIN_W, 600);
  this->views_[0] = now;

  // Flow lines first, so the nodes are drawn on top of them
  this->flows_ = {
      {"solarToHome", SOLAR, true, bezier_path(300, 174, 300, 290, 360, 332, 440, 332)},
      {"solarToBattery", SOLAR, true, line_path(300, 174, 300, 470)},
      {"solarToGrid", SOLAR, false, bezier_path(300, 174, 300, 290, 240, 332, 150, 332)},
      {"gridToHome", GRID, true, line_path(150, 332, 440, 332)},
      {"gridToBattery", GRID, false, bezier_path(85, 364, 85, 500, 110, 530, 150, 530)},
      {"batteryToHome", BATTERY, false, bezier_path(450, 530, 490, 530, 510, 500, 510, 368)},
      {"batteryToGrid", BATTERY, false, reversed(bezier_path(85, 364, 85, 500, 110, 530, 150, 530))},
  };
  for (auto &f : this->flows_) {
    measure(f.path);
    if (f.idle_track) {
      f.idle = lv_line_create(now);
      lv_line_set_points(f.idle, f.path.points.data(), f.path.points.size());
      lv_obj_set_style_line_color(f.idle, lv_color_hex(TRACK), 0);
      lv_obj_set_style_line_width(f.idle, 2, 0);
      lv_obj_set_style_line_dash_width(f.idle, 5, 0);
      lv_obj_set_style_line_dash_gap(f.idle, 6, 0);
    }
    f.line = lv_line_create(now);
    lv_line_set_points(f.line, f.path.points.data(), f.path.points.size());
    lv_obj_set_style_line_color(f.line, lv_color_hex(f.color), 0);
    lv_obj_set_style_line_rounded(f.line, true, 0);
    show(f.line, false);
    f.dot = plain(now);
    lv_obj_set_size(f.dot, DOT, DOT);
    lv_obj_set_style_radius(f.dot, LV_RADIUS_CIRCLE, 0);
    lv_obj_set_style_bg_color(f.dot, lv_color_hex(TEXT), 0);
    lv_obj_set_style_bg_opa(f.dot, LV_OPA_COVER, 0);
    lv_obj_set_user_data(f.dot, &f.path);
    show(f.dot, false);
  }

  // Nodes
  this->solar_node_ = this->box_(now, 235, 110, 130, 64, NODE_BORDER, 2);
  lv_obj_t *i = this->label_(this->solar_node_, this->icons_, SOLAR, 0, 0);
  lv_label_set_text(i, ICON_SOLAR);
  lv_obj_align(i, LV_ALIGN_LEFT_MID, 10, 0);
  this->solar_text_ = this->label_(this->solar_node_, this->bold_, TEXT, 0, 0);
  lv_obj_align(this->solar_text_, LV_ALIGN_LEFT_MID, 50, 0);
  this->solar_label_ = this->label_(now, this->small_, MUTED, 378, 112);

  this->grid_node_ = this->box_(now, 20, 300, 130, 64, NODE_BORDER, 2);
  i = this->label_(this->grid_node_, this->icons_, GRID, 0, 0);
  lv_label_set_text(i, ICON_GRID);
  lv_obj_align(i, LV_ALIGN_LEFT_MID, 10, 0);
  this->grid_text_ = this->label_(this->grid_node_, this->bold_, TEXT, 0, 0);
  lv_obj_align(this->grid_text_, LV_ALIGN_LEFT_MID, 50, 0);
  this->grid_label_ = this->label_(now, this->small_, MUTED, 20, 372);

  lv_obj_t *home = this->box_(now, 440, 296, 140, 72, TEXT, 3);
  i = this->label_(home, this->icons_, TEXT, 0, 0);
  lv_label_set_text(i, ICON_HOME);
  lv_obj_align(i, LV_ALIGN_LEFT_MID, 10, 0);
  this->home_text_ = this->label_(home, this->bold_, TEXT, 0, 0);
  lv_obj_align(this->home_text_, LV_ALIGN_LEFT_MID, 50, 0);

  // Battery bank
  this->bank_ = this->box_(now, 150, 470, 300, 122, NODE_BORDER, 2);
  this->bank_title_ = this->label_(this->bank_, this->small_, MUTED, 14, 8);
  this->bank_text_ = this->label_(this->bank_, this->bold_, BATTERY, 0, 6);
  lv_obj_align(this->bank_text_, LV_ALIGN_TOP_RIGHT, -14, 6);
  this->bank_cells_ = plain(this->bank_);
  lv_obj_set_pos(this->bank_cells_, 10, 38);
  lv_obj_set_size(this->bank_cells_, 280, 78);
  lv_obj_set_flex_flow(this->bank_cells_, LV_FLEX_FLOW_ROW);
  lv_obj_set_flex_align(this->bank_cells_, LV_FLEX_ALIGN_SPACE_EVENLY, LV_FLEX_ALIGN_CENTER, LV_FLEX_ALIGN_CENTER);

  // Right column: running loads and the rest, phases at the bottom
  lv_obj_t *right = plain(now);
  lv_obj_set_pos(right, RIGHT_X, HEADER_H + 8);
  lv_obj_set_size(right, RIGHT_W, PRICES_Y - HEADER_H - 16);
  lv_obj_set_flex_flow(right, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(right, 8, 0);
  // Several running loads (a vehicle has up to three extra lines) and the
  // other loads can be taller than the column: it scrolls with a swipe
  lv_obj_add_flag(right, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(right, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_scroll_dir(right, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(right, LV_SCROLLBAR_MODE_ACTIVE);
  lv_obj_set_style_bg_color(right, lv_color_hex(MUTED), LV_PART_SCROLLBAR);
  lv_obj_set_style_bg_opa(right, LV_OPA_50, LV_PART_SCROLLBAR);
  this->running_title_ = lv_label_create(right);
  lv_obj_set_style_text_font(this->running_title_, this->small_, 0);
  lv_obj_set_style_text_color(this->running_title_, lv_color_hex(MUTED), 0);
  this->running_ = plain(right);
  lv_obj_set_size(this->running_, RIGHT_W, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(this->running_, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(this->running_, 8, 0);
  this->others_title_ = lv_label_create(right);
  lv_obj_set_style_text_font(this->others_title_, this->small_, 0);
  lv_obj_set_style_text_color(this->others_title_, lv_color_hex(MUTED), 0);
  this->others_ = plain(right);
  lv_obj_set_size(this->others_, RIGHT_W, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(this->others_, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(this->others_, 4, 0);

  this->pr_title_ = this->label_(now, this->small_, MUTED, RIGHT_X, PRICES_Y);
  this->pr_range_ = this->label_(now, this->small_, MUTED, 0, PRICES_Y);
  this->pr_canvas_.create(now, RIGHT_X, PRICES_Y + 24, RIGHT_W, PRICES_H);
  lv_obj_add_flag(this->pr_canvas_.obj, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(this->pr_canvas_.obj, EnergyUi::to_price_cb, LV_EVENT_CLICKED, this);
  this->pr_ticks_ = plain(now);
  lv_obj_set_pos(this->pr_ticks_, RIGHT_X, PRICES_Y + 24 + PRICES_H + 2);
  lv_obj_set_size(this->pr_ticks_, RIGHT_W, 20);
  this->phases_title_ = this->label_(now, this->small_, MUTED, RIGHT_X, 520);
  // Header
  this->title_ = this->label_(this->main_, this->large_, TEXT, 24, 12);
  lv_label_set_text(this->title_, "…");
  this->subtitle_ = this->label_(this->main_, this->medium_, MUTED, 24, 50);
  this->reason_ = this->label_(this->main_, this->small_, SOLAR, 24, 76);
  lv_obj_set_width(this->reason_, 560);
  lv_label_set_long_mode(this->reason_, LV_LABEL_LONG_MODE_DOTS);
  this->offline_ = this->label_(this->main_, this->small_, WARN, 560, 14);
  this->clock_ = this->label_(this->main_, this->medium_, MUTED, 560, 40);

  this->price_box_ = this->box_(this->main_, MAIN_W - 186, 12, 170, 72, NODE_BORDER, 1);
  this->price_name_ = this->label_(this->price_box_, this->small_, MUTED, 14, 8);
  this->price_value_ = this->label_(this->price_box_, this->large_, TEXT, 14, 30);
  this->price_unit_ = this->label_(this->price_box_, this->small_, MUTED, 0, 44);
  lv_obj_align(this->price_unit_, LV_ALIGN_TOP_RIGHT, -12, 44);
  show(this->price_box_, false);
  // The price box (all views) and the small chart open the Price view
  lv_obj_add_flag(this->price_box_, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_add_event_cb(this->price_box_, EnergyUi::to_price_cb, LV_EVENT_CLICKED, this);

  this->build_flow_();
  this->build_forecast_();
  this->build_review_();
  this->build_price_();
  this->build_tabs_();
  this->build_overlay_();
  this->built_ = true;
}

// ---------------------------------------------------------------- Updates

void EnergyUi::set_flow_(FlowLine &f, float watts) {
  if (watts <= 0) {
    show(f.line, false);
    show(f.dot, false);
    if (f.duration_ms) lv_anim_delete(f.dot, dot_anim_cb);
    f.duration_ms = 0;
    return;
  }
  // Thicker and faster with more power, capped at 5 kW (as the card)
  float k = fminf(watts, 5000) / 5000;
  lv_obj_set_style_line_width(f.line, (int32_t) lroundf(3 + 7 * k), 0);
  show(f.line, true);
  show(f.dot, true);
  uint32_t ms = (uint32_t) lroundf((1.5f + 4.5f * (1 - k)) * 1000 * f.path.lengths.back() / 300);
  // Restart the animation only on a clear change, or the dot would jump each update
  if (f.duration_ms == 0 || abs((int) ms - (int) f.duration_ms) > (int) f.duration_ms / 5) {
    lv_anim_delete(f.dot, dot_anim_cb);
    lv_anim_t a;
    lv_anim_init(&a);
    lv_anim_set_var(&a, f.dot);
    lv_anim_set_exec_cb(&a, dot_anim_cb);
    lv_anim_set_values(&a, 0, 1000);
    lv_anim_set_duration(&a, ms);
    lv_anim_set_repeat_count(&a, LV_ANIM_REPEAT_INFINITE);
    lv_anim_start(&a);
    f.duration_ms = ms;
  }
}

void EnergyUi::rebuild_cells_(size_t n) {
  if (this->cells_.size() == n) return;
  lv_obj_clean(this->bank_cells_);
  this->cells_.clear();
  int w = n ? 280 / (int) n : 280;
  for (size_t k = 0; k < n; k++) {
    // Level and arrow, the name under it, then a level bar across the cell
    BatteryCell c;
    c.box = plain(this->bank_cells_);
    lv_obj_set_size(c.box, w, 78);
    c.soc = this->label_(c.box, this->bold_, TEXT, 0, 2);
    lv_obj_set_width(c.soc, w);
    lv_obj_set_style_text_align(c.soc, LV_TEXT_ALIGN_CENTER, 0);
    c.name = this->label_(c.box, this->small_, MUTED, 0, 28);
    lv_obj_set_width(c.name, w - 4);
    lv_obj_set_style_text_align(c.name, LV_TEXT_ALIGN_CENTER, 0);
    lv_label_set_long_mode(c.name, LV_LABEL_LONG_MODE_DOTS);
    c.bar = lv_bar_create(c.box);
    lv_obj_set_size(c.bar, w - 16, 8);
    lv_obj_set_pos(c.bar, 8, 58);
    lv_bar_set_range(c.bar, 0, 100);
    lv_obj_set_style_radius(c.bar, 4, 0);
    lv_obj_set_style_radius(c.bar, 4, LV_PART_INDICATOR);
    lv_obj_set_style_bg_color(c.bar, lv_color_hex(TRACK), 0);
    lv_obj_set_style_bg_opa(c.bar, LV_OPA_COVER, 0);
    this->cells_.push_back(c);
  }
}

void EnergyUi::rebuild_running_(JsonArray running) {
  // Rebuilt when the set of tiles or their line counts change; texts update in place otherwise
  std::string key;
  for (JsonObject l : running) key += std::string(l["name"] | "") + "/" + std::to_string(l["lines"].size()) + ";";
  if (key == this->running_key_) return;
  this->running_key_ = key;
  lv_obj_clean(this->running_);
  this->running_entities_.clear();
  for (JsonObject l : running) {
    uint32_t color = l["color"] | 0xB39DF0;
    lv_obj_t *tile = plain(this->running_);
    // A vehicle's tile opens its power and battery level over the last hours
    lv_obj_add_flag(tile, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_add_flag(tile, LV_OBJ_FLAG_EVENT_BUBBLE);  // swipes still scroll the column
    lv_obj_set_user_data(tile, (void *) (intptr_t) this->running_entities_.size());
    lv_obj_add_event_cb(tile, EnergyUi::tile_cb, LV_EVENT_CLICKED, this);
    this->running_entities_.push_back(l["entity"] | "");
    lv_obj_set_size(tile, RIGHT_W, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_color(tile, lv_color_hex(TILE_BG), 0);
    lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(tile, 12, 0);
    lv_obj_set_style_border_side(tile, LV_BORDER_SIDE_TOP, 0);
    lv_obj_set_style_border_width(tile, 3, 0);
    lv_obj_set_style_border_color(tile, lv_color_hex(color), 0);
    lv_obj_set_style_pad_all(tile, 12, 0);
    lv_obj_set_flex_flow(tile, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(tile, 2, 0);
    lv_obj_t *row = plain(tile);
    lv_obj_set_size(row, LV_PCT(100), LV_SIZE_CONTENT);
    lv_obj_t *icon = this->label_(row, this->icons_, color, 0, 0);
    lv_label_set_text(icon, icon_glyph(l["icon"] | (const char *) nullptr));
    lv_obj_t *name = this->label_(row, this->medium_, MUTED, 44, 4);
    lv_label_set_text(name, l["name"] | "");
    lv_obj_t *power = this->label_(row, this->bold_, TEXT, 0, 2);
    lv_obj_align(power, LV_ALIGN_TOP_RIGHT, 0, 2);
    for (size_t k = 0; k < l["lines"].size(); k++) {
      lv_obj_t *line = lv_label_create(tile);
      lv_obj_set_style_text_font(line, k == 0 ? this->medium_ : this->small_, 0);
      lv_obj_set_style_text_color(line, lv_color_hex(k == 0 ? TEXT : MUTED), 0);
      lv_label_set_text(line, "");
    }
  }
}

void EnergyUi::rebuild_others_(size_t n) {
  if (this->other_rows_.size() == n) return;
  lv_obj_clean(this->others_);
  this->other_rows_.clear();
  for (size_t k = 0; k < n; k++) {
    lv_obj_t *row = plain(this->others_);
    lv_obj_set_size(row, RIGHT_W, 26);
    lv_obj_t *name = this->label_(row, this->medium_, MUTED, 0, 0);
    lv_obj_t *value = this->label_(row, this->bold_, TEXT, 0, 0);
    lv_obj_align(value, LV_ALIGN_TOP_RIGHT, 0, 0);
    this->other_rows_.push_back({name, value});
  }
}

void EnergyUi::apply_(JsonObject root) {
  JsonObject h = root["header"];
  set_text(this->title_, h["title"] | "");
  set_text(this->subtitle_, h["subtitle"] | "");
  set_text(this->reason_, h["reason"].isNull() ? "" : (h["reason"]["text"] | ""));
  if (h["price"].isNull()) {
    show(this->price_box_, false);
  } else {
    show(this->price_box_, true);
    set_text(this->price_name_, h["price"]["name"] | "");
    set_text(this->price_value_, h["price"]["value"] | "");
    set_text(this->price_unit_, h["price"]["unit"] | "");
  }

  JsonObject labels = root["labels"];
  JsonObject solar = root["solar"];
  show(this->solar_node_, !solar.isNull());
  show(this->solar_label_, !solar.isNull());
  if (!solar.isNull()) {
    set_text(this->solar_text_, solar["text"] | "");
    lv_obj_set_style_border_color(this->solar_node_, lv_color_hex((solar["w"] | 0.0f) > 0 ? SOLAR : NODE_BORDER), 0);
    std::string s = labels["solar"] | "";
    if (!solar["today"].isNull()) s += std::string("\n") + (solar["today"] | "");
    if (!solar["forecast"].isNull()) s += std::string("\n") + (solar["forecast"] | "");
    set_text(this->solar_label_, s.c_str());
  }
  JsonObject grid = root["grid"];
  show(this->grid_node_, !grid.isNull());
  show(this->grid_label_, !grid.isNull());
  if (!grid.isNull()) {
    set_text(this->grid_text_, grid["text"] | "");
    float gw = (grid["importW"] | 0.0f) + (grid["exportW"] | 0.0f);
    lv_obj_set_style_border_color(this->grid_node_, lv_color_hex(gw > 0 ? GRID : NODE_BORDER), 0);
    std::string s = labels["grid"] | "";
    std::string today = grid["today"].isNull() ? "" : (grid["today"] | "");
    std::string cost = grid["cost"].isNull() ? "" : (grid["cost"] | "");
    if (!today.empty() || !cost.empty()) s += "\n" + today + (!today.empty() && !cost.empty() ? " · " : "") + cost;
    if (!grid["expected"].isNull()) s += std::string("\n") + (grid["expected"] | "");
    set_text(this->grid_label_, s.c_str());
  }
  set_text(this->home_text_, root["home"]["text"] | "");

  JsonObject flows = root["flows"];
  for (auto &f : this->flows_) this->set_flow_(f, flows[f.key] | 0.0f);

  JsonObject bank = root["bank"];
  JsonArray cells = bank["cells"];
  show(this->bank_, cells.size() > 0);
  set_text(this->bank_title_, labels["batteries"] | "");
  set_text(this->bank_text_, bank["text"] | "");
  this->rebuild_cells_(cells.size());
  for (size_t k = 0; k < cells.size() && k < this->cells_.size(); k++) {
    JsonObject c = cells[k];
    auto &w = this->cells_[k];
    lv_bar_set_value(w.bar, (int32_t) (c["soc"] | 0.0f), LV_ANIM_OFF);
    lv_obj_set_style_bg_color(w.bar, lv_color_hex(c["low"] | false ? BATTERY_LOW : BATTERY), LV_PART_INDICATOR);
    std::string soc = std::string(c["socText"] | "") + (strlen(c["arrow"] | "") ? std::string(" ") + (c["arrow"] | "") : "");
    set_text(w.soc, soc.c_str());
    set_text(w.name, c["name"] | "");
  }

  JsonArray running = root["running"];
  show(this->running_title_, running.size() > 0);
  set_text(this->running_title_, labels["running"] | "");
  this->rebuild_running_(running);
  uint32_t t = 0;
  for (JsonObject l : running) {
    lv_obj_t *tile = lv_obj_get_child(this->running_, t++);
    if (tile == nullptr) break;
    lv_obj_t *row = lv_obj_get_child(tile, 0);
    set_text(lv_obj_get_child(row, 2), l["text"] | "");
    JsonArray lines = l["lines"];
    for (size_t k = 0; k < lines.size(); k++) {
      lv_obj_t *line = lv_obj_get_child(tile, k + 1);
      if (line != nullptr) set_text(line, lines[k] | "");
    }
  }

  JsonArray others = root["others"];
  show(this->others_title_, others.size() > 0);
  set_text(this->others_title_, labels["other"] | "");
  this->rebuild_others_(others.size());
  for (size_t k = 0; k < others.size() && k < this->other_rows_.size(); k++) {
    set_text(this->other_rows_[k].first, others[k]["name"] | "");
    set_text(this->other_rows_[k].second, others[k]["text"] | "");
  }

  this->apply_prices_(root["prices"]);

  JsonArray phases = root["phases"];
  set_text(this->phases_title_, phases.size() ? (labels["fuse"] | "") : "");
  if (this->phases_.size() != phases.size()) {
    for (auto &p : this->phases_) {
      lv_obj_delete(p.first);
      lv_obj_delete(p.second);
    }
    for (auto *n : this->phase_names_) lv_obj_delete(n);
    this->phases_.clear();
    this->phase_names_.clear();
    int w = phases.size() ? RIGHT_W / (int) phases.size() : RIGHT_W;
    for (size_t k = 0; k < phases.size(); k++) {
      int x = RIGHT_X + (int) k * w;
      lv_obj_t *name = this->label_(this->views_[0], this->medium_, TEXT, x, 546);
      lv_obj_t *bar = lv_bar_create(this->views_[0]);
      lv_obj_set_pos(bar, x + 34, 554);
      lv_obj_set_size(bar, w - 48, 10);
      lv_bar_set_range(bar, 0, 1000);
      lv_obj_set_style_bg_color(bar, lv_color_hex(TRACK), 0);
      lv_obj_set_style_bg_opa(bar, LV_OPA_COVER, 0);
      lv_obj_t *text = this->label_(this->views_[0], this->small_, MUTED, x + 34, 568);
      this->phase_names_.push_back(name);
      this->phases_.push_back({bar, text});
    }
  }
  for (size_t k = 0; k < phases.size() && k < this->phases_.size(); k++) {
    JsonObject p = phases[k];
    set_text(this->phase_names_[k], p["name"] | "");
    lv_bar_set_value(this->phases_[k].first, (int32_t) ((p["frac"] | 0.0f) * 1000), LV_ANIM_OFF);
    lv_obj_set_style_bg_color(this->phases_[k].first, lv_color_hex(p["warn"] | false ? WARN : GRID), LV_PART_INDICATOR);
    set_text(this->phases_[k].second, p["text"] | "");
  }
}

// Price for the coming hours: bars by price class, the current period brighter
void EnergyUi::apply_prices_(JsonObject p) {
  bool has = !p.isNull();
  show(this->pr_title_, has);
  show(this->pr_range_, has);
  show(this->pr_canvas_.obj, has);
  show(this->pr_ticks_, has);
  if (!has) return;
  std::string key;
  serializeJson(p, key);
  if (key == this->pr_key_) return;
  this->pr_key_ = key;
  set_text(this->pr_title_, p["title"] | "");
  set_text(this->pr_range_, p["range"] | "");
  // Right-aligned with the chart: the label's width is known after a layout pass
  lv_obj_update_layout(this->pr_range_);
  lv_obj_set_x(this->pr_range_, RIGHT_X + RIGHT_W - lv_obj_get_width(this->pr_range_));
  Canvas &c = this->pr_canvas_;
  c.clear();
  JsonArray bars = p["bars"];
  size_t n = bars.size();
  float bw = n ? (float) RIGHT_W / n : RIGHT_W;
  for (size_t i = 0; i < n; i++) {
    int h = std::max(2, (int) lroundf((bars[i]["f"] | 0.0f) * (PRICES_H - 2)));
    int x0 = (int) (bw * i), x1 = std::max(x0 + 1, (int) (bw * (i + 1)) - 1);
    c.fill_rect(x0, PRICES_H - h, x1, PRICES_H, bars[i]["c"] | 0, i == 0 ? 255 : 130);
  }
  c.done();
  lv_obj_clean(this->pr_ticks_);
  for (JsonObject t : p["ticks"].as<JsonArray>()) {
    lv_obj_t *l = lv_label_create(this->pr_ticks_);
    lv_obj_set_style_text_font(l, this->small_, 0);
    lv_obj_set_style_text_color(l, lv_color_hex(MUTED), 0);
    lv_label_set_text(l, t["label"] | "");
    lv_obj_set_pos(l, (int) ((t["x"] | 0.0f) * RIGHT_W) - 9, 0);
  }
}

void EnergyUi::loop() {
  if (!this->built_) return;
  std::string body;
  {
    std::lock_guard<std::mutex> lock(this->mutex_);
    if (this->has_pending_) {
      body = std::move(this->pending_);
      this->has_pending_ = false;
    }
  }
  if (!body.empty()) {
    JsonDocument doc = json::parse_json(body);
    int v = doc["v"] | 0;
    if (doc.is<JsonObject>() && (v == 1 || v == 2)) {
      JsonObject root = doc.as<JsonObject>();
      this->apply_(root);
      if (v == 2) {
        JsonArray tabs = root["tabs"];
        for (int k = 0; k < VIEWS && k < (int) tabs.size(); k++) set_text(this->tab_labels_[k], tabs[k] | "");
        this->apply_flow_(root["flow"]);
        this->apply_forecast_(root["forecast"]);
        this->apply_review_(root["review"]);
        this->apply_price_view_(root["price"]);
        this->apply_vehicles_(root["vehicles"]);
      }
    } else {
      ESP_LOGW(TAG, "model.json: unexpected content (%u bytes)", (unsigned) body.size());
    }
  }
  // Back to Now (and the chart closed) after two minutes untouched, as the card on a wall
  if ((this->view_ != 0 || !this->ov_entity_.empty()) && lv_display_get_inactive_time(nullptr) > 120000) {
    this->close_overlay_();
    this->select_(0);
  }
  // The clock runs here, from Home Assistant's time, so it ticks between updates
  if (this->time_ != nullptr) {
    auto now = this->time_->now();
    if (now.is_valid()) {
      char buf[8];
      snprintf(buf, sizeof(buf), "%02d:%02d", now.hour, now.minute);
      set_text(this->clock_, buf);
    }
  }
  // No fresh model for a minute: say so, the figures on screen are getting old
  uint32_t ok = this->last_ok_ms_;
  bool offline = ok == 0 ? millis() > 60000 : millis() - ok > 60000;
  if (offline != this->offline_shown_) {
    this->offline_shown_ = offline;
    set_text(this->offline_, offline ? "No data from the renderer" : "");
  }
}

}  // namespace energy_ui
}  // namespace esphome
