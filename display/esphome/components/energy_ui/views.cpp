// Flow, Forecast and Review, the tabs and the vehicle chart that opens from a
// running vehicle's tile. Now is in energy_ui.cpp.
#include <cmath>
#include <cstring>

#include "energy_ui.h"
#include "esphome/core/log.h"

namespace esphome {
namespace energy_ui {

static const uint32_t TEXT = 0xF2F2F2;
static const uint32_t MUTED = 0xA8A8A8;
static const uint32_t TRACK = 0x2C3137;
static const uint32_t TILE_BG = 0x111418;
static const uint32_t BORDER = 0x3A3F46;
static const uint32_t GOOD = 0x7FC97F, BAD = 0xE57F84;
static const uint32_t BATTERY = 0x4FC1B0, GRID = 0x6CA8E8;

static const int RAIL_W = 80, MAIN_W = 1024 - RAIL_W;
static const int CONTENT_Y = 100, CONTENT_H = 500;

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

/// A view that scrolls vertically with a swipe
static void make_scrollable(lv_obj_t *o) {
  lv_obj_add_flag(o, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_add_flag(o, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_scroll_dir(o, LV_DIR_VER);
  lv_obj_set_scrollbar_mode(o, LV_SCROLLBAR_MODE_ACTIVE);
  lv_obj_set_style_bg_color(o, lv_color_hex(MUTED), LV_PART_SCROLLBAR);
  lv_obj_set_style_bg_opa(o, LV_OPA_50, LV_PART_SCROLLBAR);
}

static lv_obj_t *bar(lv_obj_t *parent, int w, int h) {
  lv_obj_t *b = lv_bar_create(parent);
  lv_obj_set_size(b, w, h);
  lv_bar_set_range(b, 0, 1000);
  lv_obj_set_style_radius(b, h / 2, 0);
  lv_obj_set_style_radius(b, h / 2, LV_PART_INDICATOR);
  lv_obj_set_style_bg_color(b, lv_color_hex(TRACK), 0);
  lv_obj_set_style_bg_opa(b, LV_OPA_COVER, 0);
  return b;
}

static void set_bar(lv_obj_t *b, float frac, uint32_t color) {
  lv_bar_set_value(b, (int32_t) lroundf(fminf(fmaxf(frac, 0), 1) * 1000), LV_ANIM_OFF);
  lv_obj_set_style_bg_color(b, lv_color_hex(color), LV_PART_INDICATOR);
}

/// Text pieces as one label: coloured pieces with LVGL's recolor syntax
static std::string recolor(JsonArray segs) {
  std::string out;
  for (JsonObject s : segs) {
    std::string t = s["t"] | "";
    for (auto &ch : t)
      if (ch == '#') ch = ' ';  // '#' starts a colour command
    if (!s["c"].isNull()) {
      char hex[8];
      snprintf(hex, sizeof(hex), "%06X", (unsigned) (s["c"] | 0));
      out += "#" + std::string(hex) + " " + t + "#";
    } else {
      out += t;
    }
  }
  return out;
}

static std::string key_of(JsonVariant v) {
  std::string k;
  serializeJson(v, k);
  return k;
}

lv_obj_t *EnergyUi::text_(lv_obj_t *parent, const lv_font_t *font, uint32_t color, const char *text) {
  lv_obj_t *l = lv_label_create(parent);
  lv_obj_set_style_text_font(l, font, 0);
  lv_obj_set_style_text_color(l, lv_color_hex(color), 0);
  lv_label_set_text(l, text == nullptr ? "" : text);
  return l;
}

// ---------------------------------------------------------------- Tabs

void EnergyUi::tab_cb(lv_event_t *e) {
  auto *self = static_cast<EnergyUi *>(lv_event_get_user_data(e));
  auto *btn = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
  self->select_((int) (intptr_t) lv_obj_get_user_data(btn));
}

// The tabs: a rail along the left edge, an icon over each name. In landscape
// the height is what is scarce, so the views get all of it under the header.
static const char *const TAB_ICONS[] = {"\U000F1904", "\U000F11DF", "\U000F0127", "\U000F02DA", "\U000F0128"};

void EnergyUi::build_tabs_() {
  lv_obj_t *rail = plain(this->screen_);
  lv_obj_set_size(rail, RAIL_W, 600);
  lv_obj_set_style_bg_color(rail, lv_color_hex(TILE_BG), 0);
  lv_obj_set_style_bg_opa(rail, LV_OPA_COVER, 0);
  for (int k = 0; k < VIEWS; k++) {
    lv_obj_t *btn = plain(rail);
    lv_obj_add_flag(btn, LV_OBJ_FLAG_CLICKABLE);
    lv_obj_set_pos(btn, 6, 12 + k * 116);
    lv_obj_set_size(btn, RAIL_W - 12, 104);
    lv_obj_set_style_radius(btn, 16, 0);
    lv_obj_set_style_bg_color(btn, lv_color_hex(0x24343A), 0);
    lv_obj_set_user_data(btn, (void *) (intptr_t) k);
    lv_obj_add_event_cb(btn, EnergyUi::tab_cb, LV_EVENT_CLICKED, this);
    lv_obj_t *icon = this->text_(btn, this->icons_, MUTED, TAB_ICONS[k]);
    lv_obj_align(icon, LV_ALIGN_CENTER, 0, -12);
    lv_obj_t *l = this->text_(btn, this->small_, MUTED, "");
    lv_obj_align(l, LV_ALIGN_CENTER, 0, 22);
    this->tabs_[k] = btn;
    this->tab_icons_[k] = icon;
    this->tab_labels_[k] = l;
  }
  this->select_(0);
}

void EnergyUi::select_(int view) {
  this->view_ = view;
  for (int k = 0; k < VIEWS; k++) {
    if (this->views_[k] != nullptr) show(this->views_[k], k == view);
    if (this->tabs_[k] == nullptr) continue;
    lv_obj_set_style_bg_opa(this->tabs_[k], k == view ? LV_OPA_COVER : LV_OPA_TRANSP, 0);
    lv_obj_set_style_text_color(this->tab_labels_[k], lv_color_hex(k == view ? TEXT : MUTED), 0);
    lv_obj_set_style_text_color(this->tab_icons_[k], lv_color_hex(k == view ? BATTERY : MUTED), 0);
    lv_obj_align(this->tab_labels_[k], LV_ALIGN_CENTER, 0, 22);
  }
}

// ---------------------------------------------------------------- Flow

static const int FL_X = 24, FL_Y = 28, FL_W = 340, FL_H = 440;
static const int FL_SINK_X = 330, FL_BAR_W = 10;

void EnergyUi::build_flow_() {
  lv_obj_t *v = plain(this->main_);
  lv_obj_set_pos(v, 0, CONTENT_Y);
  lv_obj_set_size(v, MAIN_W, CONTENT_H);
  this->views_[1] = v;
  this->fl_src_title_ = this->text_(v, this->small_, MUTED, "");
  lv_obj_set_pos(this->fl_src_title_, FL_X, 0);
  this->fl_use_title_ = this->text_(v, this->small_, MUTED, "");
  lv_obj_set_pos(this->fl_use_title_, FL_X + FL_SINK_X, 0);
  this->fl_canvas_.create(v, FL_X, FL_Y, FL_W, FL_H);
  this->fl_labels_ = plain(v);
  lv_obj_set_size(this->fl_labels_, 600, CONTENT_H);
  this->fl_nothing_ = this->text_(v, this->medium_, MUTED, "");
  lv_obj_set_pos(this->fl_nothing_, FL_X, 60);

  this->fl_bats_ = plain(v);
  lv_obj_set_pos(this->fl_bats_, 600, 8);
  lv_obj_set_size(this->fl_bats_, 328, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(this->fl_bats_, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(this->fl_bats_, 14, 0);
  // Today's totals as rows under the batteries (tiles were too narrow for "Bought today")
  this->fl_stats_ = plain(v);
  lv_obj_set_pos(this->fl_stats_, 600, 330);
  lv_obj_set_size(this->fl_stats_, 328, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(this->fl_stats_, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(this->fl_stats_, 8, 0);
}

void EnergyUi::apply_flow_(JsonObject f) {
  if (f.isNull()) return;
  std::string key = key_of(f);
  if (key == this->fl_key_) return;
  this->fl_key_ = key;
  set_text(this->fl_src_title_, f["sourcesTitle"] | "");
  set_text(this->fl_use_title_, f["usesTitle"] | "");
  bool nothing = !f["nothing"].isNull();
  set_text(this->fl_nothing_, nothing ? (f["nothing"] | "") : "");

  // Ribbons and bars: the card's layout on a 0..1000 scale
  Canvas &c = this->fl_canvas_;
  c.clear();
  float k = (float) FL_H / 1000;
  if (!nothing) {
    for (JsonObject r : f["ribbons"].as<JsonArray>()) {
      uint32_t color = r["color"] | 0;
      float y0 = (r["y0"] | 0.0f) * k, y1 = (r["y1"] | 0.0f) * k, y2 = (r["y2"] | 0.0f) * k, y3 = (r["y3"] | 0.0f) * k;
      for (int x = FL_BAR_W; x < FL_SINK_X; x++) {
        float t = (float) (x - FL_BAR_W) / (FL_SINK_X - FL_BAR_W);
        float s = t * t * (3 - 2 * t);  // the card's bezier, near enough
        c.vspan(x, y0 + (y2 - y0) * s, y1 + (y3 - y1) * s, color, 90);
      }
    }
  }
  lv_obj_clean(this->fl_labels_);
  auto bars = [&](JsonArray list, int x, int label_x) {
    std::vector<float> centres;
    for (JsonObject b : list) {
      float y = (b["y"] | 0.0f) * k, h = fmaxf((b["h"] | 0.0f) * k, 1);
      c.fill_rect(x, (int) y, x + FL_BAR_W, (int) ceilf(y + h), b["color"] | 0, 255);
      centres.push_back(FL_Y + y + h / 2);
    }
    // Pushed apart so labels never overlap (as the card's spreadLabels)
    for (size_t i = 1; i < centres.size(); i++)
      if (centres[i] - centres[i - 1] < 22) centres[i] = centres[i - 1] + 22;
    size_t i = 0;
    for (JsonObject b : list) {
      lv_obj_t *l = this->text_(this->fl_labels_, this->small_, TEXT, b["label"] | "");
      lv_obj_set_pos(l, label_x, (int) centres[i++] - 10);
    }
  };
  if (!nothing) {
    bars(f["sources"].as<JsonArray>(), 0, FL_X + FL_BAR_W + 6);
    bars(f["sinks"].as<JsonArray>(), FL_SINK_X, FL_X + FL_SINK_X + FL_BAR_W + 6);
  }
  c.done();

  lv_obj_clean(this->fl_bats_);
  for (JsonObject b : f["batteries"].as<JsonArray>()) {
    lv_obj_t *row = plain(this->fl_bats_);
    lv_obj_set_size(row, 328, 46);
    lv_obj_t *name = this->text_(row, this->small_, MUTED, "");
    std::string s = std::string(b["name"] | "") + " · " + (b["state"] | "");
    lv_label_set_text(name, s.c_str());
    lv_obj_set_width(name, 250);
    lv_label_set_long_mode(name, LV_LABEL_LONG_MODE_DOTS);
    lv_obj_t *soc = this->text_(row, this->bold_, TEXT, b["socText"] | "");
    lv_obj_align(soc, LV_ALIGN_TOP_RIGHT, 0, 0);
    lv_obj_t *track = bar(row, 328, 10);
    lv_obj_set_pos(track, 0, 30);
    set_bar(track, (b["soc"] | 0.0f) / 100, b["color"] | BATTERY);
  }
  lv_obj_clean(this->fl_stats_);
  for (JsonObject s : f["stats"].as<JsonArray>()) {
    lv_obj_t *row = plain(this->fl_stats_);
    lv_obj_set_size(row, 328, 28);
    this->text_(row, this->medium_, MUTED, s["label"] | "");
    lv_obj_t *val = this->text_(row, this->bold_, TEXT, s["value"] | "");
    lv_obj_align(val, LV_ALIGN_TOP_RIGHT, 0, 0);
  }
}

// ---------------------------------------------------------------- Forecast

static const int FC_W = MAIN_W - 48, FC_H = 170, FC_Y = 50;

void EnergyUi::build_forecast_() {
  lv_obj_t *v = plain(this->main_);
  lv_obj_set_pos(v, 0, CONTENT_Y);
  lv_obj_set_size(v, MAIN_W, CONTENT_H);
  make_scrollable(v);
  this->views_[2] = v;
  this->fc_title_ = this->text_(v, this->medium_, MUTED, "");
  lv_obj_set_pos(this->fc_title_, 24, 4);
  this->fc_total_ = this->text_(v, this->bold_, TEXT, "");
  lv_obj_align(this->fc_total_, LV_ALIGN_TOP_RIGHT, -24, 0);
  this->fc_plus_ = this->text_(v, this->small_, TEXT, "");
  lv_obj_align(this->fc_plus_, LV_ALIGN_TOP_RIGHT, -24, 26);
  this->fc_canvas_.create(v, 24, FC_Y, FC_W, FC_H);
  this->fc_labels_ = plain(v);
  lv_obj_set_size(this->fc_labels_, MAIN_W, 260);
  this->fc_band_ = this->text_(v, this->small_, MUTED, "");
  lv_obj_set_pos(this->fc_band_, 24, FC_Y + FC_H + 30);
  this->fc_unavailable_ = this->text_(v, this->medium_, MUTED, "");
  lv_obj_set_pos(this->fc_unavailable_, 24, FC_Y);

  this->fc_last_title_ = this->text_(v, this->medium_, MUTED, "");
  lv_obj_set_pos(this->fc_last_title_, 24, 286);
  this->fc_rows_ = plain(v);
  lv_obj_set_pos(this->fc_rows_, 24, 318);
  lv_obj_set_size(this->fc_rows_, 600, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(this->fc_rows_, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(this->fc_rows_, 12, 0);
  lv_obj_set_style_pad_bottom(this->fc_rows_, 16, 0);

  this->fc_tomorrow_ = plain(v);
  lv_obj_set_pos(this->fc_tomorrow_, 650, 286);
  lv_obj_set_size(this->fc_tomorrow_, 270, 76);
  lv_obj_set_style_bg_color(this->fc_tomorrow_, lv_color_hex(TILE_BG), 0);
  lv_obj_set_style_bg_opa(this->fc_tomorrow_, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(this->fc_tomorrow_, 12, 0);
  this->fc_tomorrow_label_ = this->text_(this->fc_tomorrow_, this->small_, MUTED, "");
  lv_obj_set_pos(this->fc_tomorrow_label_, 14, 10);
  this->fc_tomorrow_value_ = this->text_(this->fc_tomorrow_, this->large_, TEXT, "");
  lv_obj_set_pos(this->fc_tomorrow_value_, 14, 32);
}

void EnergyUi::apply_forecast_(JsonObject f) {
  if (f.isNull()) return;
  std::string key = key_of(f);
  if (key == this->fc_key_) return;
  this->fc_key_ = key;
  set_text(this->fc_title_, f["title"] | "");
  JsonObject tomorrow = f["tomorrow"];
  show(this->fc_tomorrow_, !tomorrow.isNull());
  if (!tomorrow.isNull()) {
    set_text(this->fc_tomorrow_label_, tomorrow["label"] | "");
    set_text(this->fc_tomorrow_value_, tomorrow["value"] | "");
  }
  bool unavailable = !f["unavailable"].isNull();
  set_text(this->fc_unavailable_, unavailable ? (f["unavailable"] | "") : "");
  show(this->fc_canvas_.obj, !unavailable);
  show(this->fc_band_, !unavailable);
  show(this->fc_last_title_, !unavailable);
  show(this->fc_rows_, !unavailable);
  lv_obj_clean(this->fc_labels_);
  if (unavailable) {
    set_text(this->fc_total_, "");
    set_text(this->fc_plus_, "");
    return;
  }
  set_text(this->fc_total_, f["total"] | "");
  lv_obj_align(this->fc_total_, LV_ALIGN_TOP_RIGHT, -24, 0);
  set_text(this->fc_plus_, f["plus"].isNull() ? "" : (f["plus"] | ""));
  lv_obj_set_style_text_color(this->fc_plus_, lv_color_hex(f["plusColor"] | TEXT), 0);
  lv_obj_align(this->fc_plus_, LV_ALIGN_TOP_RIGHT, -24, 26);
  set_text(this->fc_band_, f["band"] | "");
  set_text(this->fc_last_title_, f["lastTitle"] | "");

  // The chart: P10-P90 band, planned vehicle charging stacked, the forecast line
  JsonArray hours = f["hours"];
  size_t n = hours.size();
  Canvas &c = this->fc_canvas_;
  c.clear();
  if (n > 0) {
    float max = 0.1f;
    for (JsonObject h : hours) max = fmaxf(max, fmaxf(h["p90"] | 0.0f, (h["kwh"] | 0.0f) + (h["ev"] | 0.0f)));
    max *= 1.08f;
    float step = (float) FC_W / n;
    int plot = FC_H - 2;
    auto y = [&](float v) { return plot - v / max * plot; };
    uint32_t ev_color = f["evColor"] | 0;
    std::vector<float> xs, ys;
    for (size_t i = 0; i < n; i++) {
      JsonObject h = hours[i];
      float kwh = h["kwh"] | 0.0f, ev = h["ev"] | 0.0f;
      for (int x = (int) (step * i); x < (int) (step * (i + 1)); x++) {
        c.vspan(x, y(h["p90"] | 0.0f), y(h["p10"] | 0.0f), 0x9AA3AB, 46);
        if (ev > 0) c.vspan(x, y(kwh + ev), y(kwh), ev_color, 140);
      }
      xs.push_back(step / 2 + step * i);
      ys.push_back(y(kwh));
    }
    c.fill_rect(0, plot, FC_W, plot + 1, BORDER, 255);
    for (size_t i = 1; i < n; i++) c.line(xs[i - 1], ys[i - 1], xs[i], ys[i], TEXT, 2.5f);
    c.line(xs[0], ys[0], xs[0], ys[0], TEXT, 8);
    int peak = f["peak"] | 0;
    lv_obj_t *pl = this->text_(this->fc_labels_, this->small_, MUTED, f["peakLabel"] | "");
    lv_obj_set_pos(pl, 24 + (int) fminf(xs[peak] + 8, FC_W - 90), FC_Y + 2);
    lv_obj_t *now = this->text_(this->fc_labels_, this->small_, MUTED, f["nowLabel"] | "");
    lv_obj_set_pos(now, 24, FC_Y + FC_H + 4);
    for (size_t i = 0; i < n; i++) {
      if (!(hours[i]["tick"] | false)) continue;
      lv_obj_t *t = this->text_(this->fc_labels_, this->small_, MUTED, hours[i]["label"] | "");
      lv_obj_set_pos(t, 24 + (int) xs[i] - 9, FC_Y + FC_H + 4);
    }
  }
  c.done();

  // Will the battery last?
  lv_obj_clean(this->fc_rows_);
  for (JsonObject r : f["rows"].as<JsonArray>()) {
    lv_obj_t *row = plain(this->fc_rows_);
    lv_obj_set_size(row, 600, LV_SIZE_CONTENT);
    lv_obj_set_flex_flow(row, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(row, 4, 0);
    lv_obj_t *top = plain(row);
    lv_obj_set_size(top, 600, LV_SIZE_CONTENT);
    lv_obj_t *label = this->text_(top, this->small_, MUTED, r["label"] | "");
    lv_obj_set_width(label, 460);
    lv_label_set_long_mode(label, LV_LABEL_LONG_MODE_WRAP);
    lv_obj_t *value = this->text_(top, this->bold_, r["color"] | TEXT, r["value"] | "");
    lv_obj_align(value, LV_ALIGN_TOP_RIGHT, 0, 0);
    if (!r["sub"].isNull()) this->text_(row, this->small_, MUTED, r["sub"] | "");
    if (!r["frac"].isNull()) set_bar(bar(row, 600, 10), r["frac"] | 0.0f, r["color"] | TEXT);
  }
  if (!f["verdict"].isNull()) {
    lv_obj_t *v = this->text_(this->fc_rows_, this->bold_, (f["verdictOk"] | false) ? GOOD : BAD, f["verdict"] | "");
    lv_obj_set_width(v, 600);
    lv_label_set_long_mode(v, LV_LABEL_LONG_MODE_WRAP);
  }
  if (!f["note"].isNull()) this->text_(this->fc_rows_, this->small_, MUTED, f["note"] | "");
}

// ---------------------------------------------------------------- Review

static const int RV_W = MAIN_W - 48, RV_H = 130;

void EnergyUi::build_review_() {
  lv_obj_t *v = plain(this->main_);
  lv_obj_set_pos(v, 0, CONTENT_Y);
  lv_obj_set_size(v, MAIN_W, CONTENT_H);
  make_scrollable(v);
  lv_obj_set_flex_flow(v, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_hor(v, 24, 0);
  lv_obj_set_style_pad_bottom(v, 20, 0);
  lv_obj_set_style_pad_row(v, 10, 0);
  this->views_[3] = v;
  this->rv_period_ = this->text_(v, this->medium_, MUTED, "");
  this->rv_message_ = this->text_(v, this->small_, MUTED, "");
  this->rv_headline_ = this->text_(v, this->bold_, TEXT, "");
  this->rv_sub_ = this->text_(v, this->small_, TEXT, "");
  lv_label_set_recolor(this->rv_sub_, true);
  lv_obj_set_width(this->rv_sub_, RV_W);
  lv_label_set_long_mode(this->rv_sub_, LV_LABEL_LONG_MODE_WRAP);
  this->rv_tiles_ = plain(v);
  lv_obj_set_size(this->rv_tiles_, RV_W, 76);
  lv_obj_set_flex_flow(this->rv_tiles_, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(this->rv_tiles_, 10, 0);
  this->rv_canvas_.create(v, 0, 0, RV_W, RV_H + 12);
  this->rv_ticks_ = plain(v);
  lv_obj_set_size(this->rv_ticks_, RV_W, 20);
  this->rv_legend_ = plain(v);
  lv_obj_set_size(this->rv_legend_, RV_W, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(this->rv_legend_, LV_FLEX_FLOW_ROW_WRAP);
  lv_obj_set_style_pad_column(this->rv_legend_, 18, 0);
  lv_obj_set_style_pad_row(this->rv_legend_, 4, 0);
  this->rv_events_title_ = this->text_(v, this->medium_, MUTED, "");
  this->rv_events_ = plain(v);
  lv_obj_set_size(this->rv_events_, RV_W, LV_SIZE_CONTENT);
  lv_obj_set_flex_flow(this->rv_events_, LV_FLEX_FLOW_COLUMN);
  lv_obj_set_style_pad_row(this->rv_events_, 8, 0);
  this->rv_footer_ = plain(v);
  lv_obj_set_size(this->rv_footer_, RV_W, LV_SIZE_CONTENT);
  this->rv_footer_text_ = this->text_(this->rv_footer_, this->small_, MUTED, "");
  this->rv_footer_verdict_ = this->text_(this->rv_footer_, this->bold_, GOOD, "");
  lv_obj_align(this->rv_footer_verdict_, LV_ALIGN_TOP_RIGHT, 0, 0);
}

void EnergyUi::apply_review_(JsonObject r) {
  if (r.isNull()) return;
  std::string key = key_of(r);
  if (key == this->rv_key_) return;
  this->rv_key_ = key;
  set_text(this->rv_period_, r["period"] | "");
  set_text(this->rv_message_, r["message"].isNull() ? "" : (r["message"] | ""));
  show(this->rv_message_, !r["message"].isNull());
  bool has = !r["events"].isNull();
  for (lv_obj_t *o : {this->rv_headline_, this->rv_sub_, this->rv_tiles_, this->rv_canvas_.obj, this->rv_ticks_,
                      this->rv_legend_, this->rv_events_title_, this->rv_events_, this->rv_footer_})
    if (o != nullptr) show(o, has);
  if (!has) return;

  show(this->rv_headline_, !r["headline"].isNull());
  set_text(this->rv_headline_, r["headline"].isNull() ? "" : (r["headline"] | ""));
  set_text(this->rv_sub_, recolor(r["sub"]).c_str());

  lv_obj_clean(this->rv_tiles_);
  for (JsonObject t : r["tiles"].as<JsonArray>()) {
    lv_obj_t *tile = plain(this->rv_tiles_);
    lv_obj_set_size(tile, 216, 76);
    lv_obj_set_style_bg_color(tile, lv_color_hex(TILE_BG), 0);
    lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(tile, 12, 0);
    lv_obj_set_pos(this->text_(tile, this->small_, MUTED, t["label"] | ""), 12, 8);
    lv_obj_set_pos(this->text_(tile, this->bold_, TEXT, t["value"] | ""), 12, 30);
    lv_obj_set_pos(this->text_(tile, this->small_, MUTED, t["sub"] | ""), 12, 54);
  }

  // Chart: hourly price bars by price class, grid import, battery level (dashed), runs below
  JsonObject ch = r["chart"];
  Canvas &c = this->rv_canvas_;
  c.clear();
  for (JsonObject p : ch["prices"].as<JsonArray>()) {
    int x0 = (int) ((p["x0"] | 0.0f) * RV_W) + 1, x1 = (int) ((p["x1"] | 0.0f) * RV_W) - 1;
    int h = (int) ((p["f"] | 0.0f) * RV_H);
    c.fill_rect(x0, RV_H - h, x1, RV_H, p["c"] | 0, 56);
  }
  JsonArray imports = ch["imports"];
  size_t n = imports.size();
  if (n > 0) {
    float bw = (float) RV_W / n;
    float prev = -1;
    for (size_t i = 0; i < n; i++) {
      float top = RV_H - (imports[i] | 0.0f) * (RV_H - 4);
      for (int x = (int) (bw * i); x < (int) (bw * (i + 1)); x++) c.vspan(x, top, RV_H, GRID, 64);
      if (prev >= 0) c.line(bw * i, prev, bw * i, top, GRID, 1.2f);
      c.line(bw * i, top, bw * (i + 1), top, GRID, 1.2f);
      prev = top;
    }
  }
  JsonArray soc = ch["soc"];
  size_t m = soc.size();
  float px = -1, py = 0;
  for (size_t i = 0; i < m; i++) {
    if (soc[i].isNull()) {
      px = -1;
      continue;
    }
    float x = (float) RV_W * (i + 0.5f) / m, y = RV_H - (soc[i] | 0.0f) / 100 * RV_H;
    if (px >= 0) c.line(px, py, x, y, BATTERY, 2, 255, 5);
    px = x;
    py = y;
  }
  c.fill_rect(0, RV_H, RV_W, RV_H + 1, BORDER, 255);
  for (JsonObject mk : ch["marks"].as<JsonArray>()) {
    int x0 = (int) ((mk["x0"] | 0.0f) * RV_W), x1 = (int) ((mk["x1"] | 0.0f) * RV_W);
    c.fill_rect(x0, RV_H + 4, std::max(x1, x0 + 2), RV_H + 9, mk["c"] | 0, 255);
  }
  c.done();
  lv_obj_clean(this->rv_ticks_);
  for (JsonObject t : ch["ticks"].as<JsonArray>()) {
    lv_obj_t *l = this->text_(this->rv_ticks_, this->small_, MUTED, t["label"] | "");
    lv_obj_set_pos(l, (int) ((t["x"] | 0.0f) * RV_W) - 9, 0);
  }

  lv_obj_clean(this->rv_legend_);
  for (JsonObject g : r["legend"].as<JsonArray>()) {
    lv_obj_t *item = plain(this->rv_legend_);
    lv_obj_set_size(item, LV_SIZE_CONTENT, 22);
    lv_obj_t *sw = plain(item);
    std::string kind = g["kind"] | "";
    bool line = kind == "line" || kind == "dashed";
    lv_obj_set_size(sw, 14, line ? 3 : 10);
    lv_obj_set_pos(sw, 0, line ? 9 : 5);
    lv_obj_set_style_radius(sw, 2, 0);
    lv_obj_set_style_bg_color(sw, lv_color_hex(g["c"] | 0), 0);
    lv_obj_set_style_bg_opa(sw, kind == "area" ? LV_OPA_50 : LV_OPA_COVER, 0);
    lv_obj_set_pos(this->text_(item, this->small_, MUTED, g["label"] | ""), 20, 0);
  }

  set_text(this->rv_events_title_, r["eventsTitle"] | "");
  lv_obj_clean(this->rv_events_);
  if (!r["nothing"].isNull()) this->text_(this->rv_events_, this->small_, MUTED, r["nothing"] | "");
  for (JsonObject e : r["events"].as<JsonArray>()) {
    lv_obj_t *card = plain(this->rv_events_);
    lv_obj_set_size(card, RV_W, LV_SIZE_CONTENT);
    lv_obj_set_style_bg_color(card, lv_color_hex(TILE_BG), 0);
    lv_obj_set_style_bg_opa(card, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(card, 10, 0);
    lv_obj_set_style_border_side(card, LV_BORDER_SIDE_LEFT, 0);
    lv_obj_set_style_border_width(card, 4, 0);
    lv_obj_set_style_border_color(card, lv_color_hex(e["border"].isNull() ? BORDER : (e["border"] | 0)), 0);
    lv_obj_set_style_pad_all(card, 10, 0);
    lv_obj_set_style_pad_left(card, 54, 0);
    lv_obj_set_flex_flow(card, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(card, 4, 0);
    lv_obj_t *icon = this->text_(card, this->icons_, e["color"].isNull() ? TEXT : (e["color"] | 0), icon_glyph(e["icon"] | ""));
    lv_obj_add_flag(icon, LV_OBJ_FLAG_IGNORE_LAYOUT);
    lv_obj_set_pos(icon, -44, 0);
    lv_obj_t *head = plain(card);
    lv_obj_set_size(head, LV_PCT(100), LV_SIZE_CONTENT);
    this->text_(head, this->bold_, TEXT, e["title"] | "");
    lv_obj_t *time = this->text_(head, this->small_, MUTED, e["time"] | "");
    lv_obj_align(time, LV_ALIGN_TOP_RIGHT, 0, 2);
    lv_obj_t *text = this->text_(card, this->small_, TEXT, "");
    lv_label_set_recolor(text, true);
    lv_obj_set_width(text, LV_PCT(100));
    lv_label_set_long_mode(text, LV_LABEL_LONG_MODE_WRAP);
    lv_label_set_text(text, recolor(e["text"]).c_str());
  }

  JsonObject foot = r["footer"];
  show(this->rv_footer_, !foot.isNull());
  if (!foot.isNull()) {
    set_text(this->rv_footer_text_, foot["text"] | "");
    set_text(this->rv_footer_verdict_, foot["verdict"] | "");
    lv_obj_set_style_text_color(this->rv_footer_verdict_, lv_color_hex(foot["c"] | GOOD), 0);
    lv_obj_align(this->rv_footer_verdict_, LV_ALIGN_TOP_RIGHT, 0, 0);
  }
}

// ---------------------------------------------------------------- Price

static const int PV_X = 64, PV_Y = 34, PV_W = MAIN_W - PV_X - 24, PV_H = 290;

void EnergyUi::to_price_cb(lv_event_t *e) {
  auto *self = static_cast<EnergyUi *>(lv_event_get_user_data(e));
  self->close_overlay_();
  self->select_(PRICE_VIEW);
}

void EnergyUi::build_price_() {
  lv_obj_t *v = plain(this->main_);
  lv_obj_set_pos(v, 0, CONTENT_Y);
  lv_obj_set_size(v, MAIN_W, CONTENT_H);
  this->views_[PRICE_VIEW] = v;
  this->pv_title_ = this->text_(v, this->medium_, MUTED, "");
  lv_obj_set_pos(this->pv_title_, 24, 2);
  this->pv_legend_ = plain(v);
  lv_obj_set_size(this->pv_legend_, LV_SIZE_CONTENT, 24);
  lv_obj_set_flex_flow(this->pv_legend_, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(this->pv_legend_, 18, 0);
  lv_obj_align(this->pv_legend_, LV_ALIGN_TOP_RIGHT, -24, 4);
  this->pv_canvas_.create(v, PV_X, PV_Y, PV_W, PV_H);
  this->pv_labels_ = plain(v);
  lv_obj_set_size(this->pv_labels_, MAIN_W, PV_Y + PV_H + 24);
  this->pv_unavailable_ = this->text_(v, this->medium_, MUTED, "");
  lv_obj_set_pos(this->pv_unavailable_, 24, PV_Y + 20);
  this->pv_tiles_ = plain(v);
  lv_obj_set_pos(this->pv_tiles_, 24, PV_Y + PV_H + 30);
  lv_obj_set_size(this->pv_tiles_, MAIN_W - 48, 128);
  lv_obj_set_flex_flow(this->pv_tiles_, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(this->pv_tiles_, 10, 0);
}

void EnergyUi::apply_price_view_(JsonObject p) {
  if (p.isNull()) return;
  std::string key = key_of(p);
  if (key == this->pv_key_) return;
  this->pv_key_ = key;
  set_text(this->pv_title_, p["title"] | "");
  bool unavailable = !p["unavailable"].isNull();
  set_text(this->pv_unavailable_, unavailable ? (p["unavailable"] | "") : "");
  show(this->pv_canvas_.obj, !unavailable);
  show(this->pv_labels_, !unavailable);
  show(this->pv_tiles_, !unavailable);
  show(this->pv_legend_, !unavailable);
  if (unavailable) return;

  // Bars per period (past dimmed, now full), the sell price as a line, price
  // lines across, midnight and now marked
  JsonArray bars = p["bars"];
  JsonArray sell = p["sell"];
  size_t n = bars.size();
  int now = p["now"] | -1;
  Canvas &c = this->pv_canvas_;
  c.clear();
  lv_obj_clean(this->pv_labels_);
  for (JsonObject g : p["grid"].as<JsonArray>()) {
    float y = PV_H - (g["f"] | 0.0f) * PV_H;
    c.line(0, y, PV_W, y, BORDER, 1, 255, 3);
    lv_obj_t *l = this->text_(this->pv_labels_, this->small_, MUTED, g["label"] | "");
    lv_obj_set_pos(l, 24, PV_Y + (int) y - 10);
  }
  // Bars from the zero line: negative prices go below it
  float bw = n ? (float) PV_W / n : PV_W;
  int zero = (int) lroundf(PV_H - (p["zero"] | 0.0f) * PV_H);
  for (size_t i = 0; i < n; i++) {
    int y = (int) lroundf(PV_H - (bars[i]["f"] | 0.0f) * PV_H);
    if (y == zero) y = zero - 1;
    int x0 = (int) (bw * i), x1 = std::max(x0 + 1, (int) (bw * (i + 1)) - (bw > 4 ? 1 : 0));
    uint8_t a = (int) i < now ? 60 : (int) i == now ? 255 : 170;
    c.fill_rect(x0, std::min(y, zero), x1, std::max(y, zero), bars[i]["c"] | 0, a);
  }
  float px = -1, py = 0;
  for (size_t i = 0; i < sell.size(); i++) {
    if (sell[i].isNull()) {
      px = -1;
      continue;
    }
    float x = bw * (i + 0.5f), y = PV_H - (sell[i] | 0.0f) * PV_H;
    if (px >= 0) c.line(px, py, x, y, GRID, 2);
    px = x;
    py = y;
  }
  c.fill_rect(0, zero, PV_W, zero + 1, MUTED, 255);
  for (JsonObject t : p["ticks"].as<JsonArray>()) {
    float x = (t["x"] | 0.0f) * PV_W;
    if (t["day"] | false) {
      c.line(x, 0, x, PV_H, MUTED, 1, 255, 4);
      lv_obj_t *d = this->text_(this->pv_labels_, this->small_, MUTED, p["dayLabel"] | "");
      lv_obj_set_pos(d, PV_X + (int) x + 6, PV_Y + 2);
    }
    lv_obj_t *l = this->text_(this->pv_labels_, this->small_, MUTED, t["label"] | "");
    lv_obj_set_pos(l, PV_X + (int) x - 9, PV_Y + PV_H + 4);
  }
  float nx = p["nowX"] | -1.0f;
  if (nx >= 0) c.line(nx * PV_W, 0, nx * PV_W, PV_H, TEXT, 2);
  c.done();

  lv_obj_clean(this->pv_legend_);
  for (JsonObject g : p["legend"].as<JsonArray>()) {
    lv_obj_t *item = plain(this->pv_legend_);
    lv_obj_set_size(item, LV_SIZE_CONTENT, 22);
    lv_obj_t *sw = plain(item);
    bool line = std::string(g["kind"] | "") == "line";
    lv_obj_set_size(sw, 16, line ? 3 : 12);
    lv_obj_set_pos(sw, 0, line ? 9 : 4);
    lv_obj_set_style_radius(sw, 2, 0);
    lv_obj_set_style_bg_color(sw, lv_color_hex(line ? GRID : 0xF0C05A), 0);
    lv_obj_set_style_bg_opa(sw, LV_OPA_COVER, 0);
    lv_obj_set_pos(this->text_(item, this->small_, MUTED, g["label"] | ""), 22, 0);
  }
  lv_obj_align(this->pv_legend_, LV_ALIGN_TOP_RIGHT, -24, 4);

  lv_obj_clean(this->pv_tiles_);
  JsonArray tiles = p["tiles"];
  int tw = tiles.size() ? (MAIN_W - 48 - 10 * ((int) tiles.size() - 1)) / (int) tiles.size() : 160;
  for (JsonObject t : tiles) {
    lv_obj_t *tile = plain(this->pv_tiles_);
    lv_obj_set_size(tile, tw, 128);
    lv_obj_set_style_bg_color(tile, lv_color_hex(TILE_BG), 0);
    lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(tile, 12, 0);
    lv_obj_set_style_pad_all(tile, 12, 0);
    lv_obj_set_flex_flow(tile, LV_FLEX_FLOW_COLUMN);
    lv_obj_set_style_pad_row(tile, 4, 0);
    this->text_(tile, this->small_, MUTED, t["label"] | "");
    lv_obj_t *val = this->text_(tile, this->bold_, TEXT, t["value"] | "");
    lv_obj_set_width(val, tw - 24);
    lv_label_set_long_mode(val, LV_LABEL_LONG_MODE_WRAP);
    lv_obj_t *sub = this->text_(tile, this->small_, MUTED, t["sub"] | "");
    lv_obj_set_width(sub, tw - 24);
    lv_label_set_long_mode(sub, LV_LABEL_LONG_MODE_WRAP);
  }
}

// ---------------------------------------------------------------- Vehicle chart

static const int OV_W = 860, OV_H = 236;

void EnergyUi::overlay_cb(lv_event_t *e) {
  static_cast<EnergyUi *>(lv_event_get_user_data(e))->close_overlay_();
}

void EnergyUi::tile_cb(lv_event_t *e) {
  auto *self = static_cast<EnergyUi *>(lv_event_get_user_data(e));
  auto *tile = static_cast<lv_obj_t *>(lv_event_get_current_target(e));
  size_t i = (size_t) (intptr_t) lv_obj_get_user_data(tile);
  if (i < self->running_entities_.size()) self->open_overlay_(self->running_entities_[i]);
}

void EnergyUi::node_cb(lv_event_t *e) {
  auto *self = static_cast<EnergyUi *>(lv_event_get_user_data(e));
  int code = (int) (intptr_t) lv_obj_get_user_data(static_cast<lv_obj_t *>(lv_event_get_current_target(e)));
  static const char *const NODES[] = {"solar", "grid", "home"};
  self->open_overlay_(code < 10 ? std::string(NODES[code]) : "battery-" + std::to_string(code - 10));
}

void EnergyUi::make_tappable_(lv_obj_t *obj, int code) {
  lv_obj_add_flag(obj, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_user_data(obj, (void *) (intptr_t) code);
  lv_obj_add_event_cb(obj, EnergyUi::node_cb, LV_EVENT_CLICKED, this);
}

void EnergyUi::build_overlay_() {
  // Over everything; a tap anywhere closes it
  this->ov_ = plain(this->screen_);
  lv_obj_set_size(this->ov_, 1024, 600);
  lv_obj_add_flag(this->ov_, LV_OBJ_FLAG_CLICKABLE);
  lv_obj_set_style_bg_color(this->ov_, lv_color_hex(0x000000), 0);
  lv_obj_set_style_bg_opa(this->ov_, LV_OPA_70, 0);
  lv_obj_add_event_cb(this->ov_, EnergyUi::overlay_cb, LV_EVENT_CLICKED, this);
  lv_obj_t *p = plain(this->ov_);
  lv_obj_set_pos(p, 62, 90);
  lv_obj_set_size(p, 900, 420);
  lv_obj_set_style_bg_color(p, lv_color_hex(0x0B0D10), 0);
  lv_obj_set_style_bg_opa(p, LV_OPA_COVER, 0);
  lv_obj_set_style_radius(p, 16, 0);
  lv_obj_set_style_border_color(p, lv_color_hex(BORDER), 0);
  lv_obj_set_style_border_width(p, 1, 0);
  this->ov_title_ = this->text_(p, this->medium_, MUTED, "");
  lv_obj_set_pos(this->ov_title_, 20, 14);
  this->ov_soc_ = this->text_(p, this->bold_, BATTERY, "");
  this->ov_power_ = this->text_(p, this->bold_, TEXT, "");
  this->ov_canvas_.create(p, 20, 52, OV_W, OV_H);
  this->ov_ticks_ = plain(p);
  lv_obj_set_pos(this->ov_ticks_, 20, 52 + OV_H + 4);
  lv_obj_set_size(this->ov_ticks_, OV_W, 22);
  // Figures under the chart (node details; empty for a vehicle)
  this->ov_stats_ = plain(p);
  lv_obj_set_pos(this->ov_stats_, 20, 52 + OV_H + 32);
  lv_obj_set_size(this->ov_stats_, OV_W, 96);
  lv_obj_set_flex_flow(this->ov_stats_, LV_FLEX_FLOW_ROW);
  lv_obj_set_style_pad_column(this->ov_stats_, 10, 0);
  lv_obj_t *hint = this->text_(p, this->small_, MUTED, "×");
  lv_obj_align(hint, LV_ALIGN_TOP_RIGHT, -16, 10);
  show(this->ov_, false);
}

void EnergyUi::open_overlay_(const std::string &entity) {
  auto it = this->vehicles_.find(entity);
  if (it == this->vehicles_.end()) return;  // no history yet
  this->ov_entity_ = entity;
  this->ov_key_.clear();
  this->draw_overlay_();
  show(this->ov_, true);
}

void EnergyUi::close_overlay_() {
  this->ov_entity_.clear();
  show(this->ov_, false);
}

void EnergyUi::draw_overlay_() {
  auto it = this->vehicles_.find(this->ov_entity_);
  if (it == this->vehicles_.end()) return;
  if (it->second == this->ov_key_) return;
  this->ov_key_ = it->second;
  JsonDocument doc = json::parse_json(it->second);
  JsonObject v = doc.as<JsonObject>();
  lv_obj_clean(this->ov_stats_);
  if (!v["series"].isNull()) {
    this->draw_detail_(v);
    return;
  }
  uint32_t color = v["color"] | 0xB39DF0;
  set_text(this->ov_title_, v["title"] | "");
  std::string power = v["powerText"] | "";
  set_text(this->ov_power_, power.c_str());
  lv_obj_set_style_text_color(this->ov_power_, lv_color_hex(color), 0);
  std::string soc = v["socText"].isNull() ? "" : std::string(v["socText"] | "");
  set_text(this->ov_soc_, soc.c_str());
  lv_obj_align(this->ov_soc_, LV_ALIGN_TOP_RIGHT, -60, 14);
  lv_obj_align_to(this->ov_power_, this->ov_soc_, LV_ALIGN_OUT_LEFT_MID, -20, 0);

  Canvas &c = this->ov_canvas_;
  c.clear(0x0B0D10);
  JsonArray pw = v["power"];
  size_t n = pw.size();
  float max = v["max"] | 1000.0f;
  if (n > 0) {
    float bw = (float) OV_W / n;
    for (size_t i = 0; i < n; i++) {
      float top = OV_H - (pw[i] | 0.0f) / max * (OV_H - 4);
      for (int x = (int) (bw * i); x < (int) (bw * (i + 1)); x++) c.vspan(x, top, OV_H, color, 64);
      c.line(bw * i, top, bw * (i + 1), top, color, 1.5f);
    }
  }
  if (!v["limit"].isNull()) {
    float y = OV_H - (v["limit"] | 0.0f) / 100 * OV_H;
    c.line(0, y, OV_W, y, BATTERY, 1, 150, 4);
  }
  JsonArray soc_list = v["soc"];
  size_t m = soc_list.size();
  float px = -1, py = 0;
  for (size_t i = 0; i < m; i++) {
    if (soc_list[i].isNull()) {
      px = -1;
      continue;
    }
    float x = (float) OV_W * (i + 0.5f) / m, y = OV_H - (soc_list[i] | 0.0f) / 100 * OV_H;
    if (px >= 0) c.line(px, py, x, y, BATTERY, 2.5f);
    px = x;
    py = y;
  }
  c.fill_rect(0, OV_H - 1, OV_W, OV_H, BORDER, 255);
  c.done();
  lv_obj_clean(this->ov_ticks_);
  for (JsonObject t : v["ticks"].as<JsonArray>()) {
    lv_obj_t *l = this->text_(this->ov_ticks_, this->small_, MUTED, t["label"] | "");
    lv_obj_set_pos(l, (int) ((t["x"] | 0.0f) * OV_W) - 9, 0);
  }
}

// A node's last 24 h: signed bars from the zero line (bought/sold, charging/
// discharging), the forecast dashed, the battery level as a line, figures below
void EnergyUi::draw_detail_(JsonObject v) {
  uint32_t color = v["color"] | TEXT, neg = v["negColor"] | color;
  set_text(this->ov_title_, v["title"] | "");
  JsonObject lg = v["legend"];
  set_text(this->ov_power_, lg["series"] | "");
  lv_obj_set_style_text_color(this->ov_power_, lv_color_hex(color), 0);
  std::string right = std::string(lg["soc"] | "");
  if (right.empty()) right = std::string(lg["forecast"] | "");
  set_text(this->ov_soc_, right.c_str());
  lv_obj_set_style_text_color(this->ov_soc_, lv_color_hex(std::string(lg["soc"] | "").empty() ? MUTED : BATTERY), 0);
  lv_obj_align(this->ov_soc_, LV_ALIGN_TOP_RIGHT, -60, 14);
  lv_obj_align_to(this->ov_power_, this->ov_soc_, LV_ALIGN_OUT_LEFT_MID, -20, 0);

  float mx = v["max"] | 1000.0f, mn = v["min"] | 0.0f;
  if (mx - mn < 1) mx = mn + 1;
  auto y = [&](float val) { return (mx - val) / (mx - mn) * (OV_H - 2) + 1; };
  float zero = y(0);
  Canvas &c = this->ov_canvas_;
  c.clear(0x0B0D10);
  JsonArray s = v["series"];
  size_t n = s.size();
  float bw = n ? (float) OV_W / n : OV_W;
  for (size_t i = 0; i < n; i++) {
    float val = s[i] | 0.0f, top = y(val);
    uint32_t col = val >= 0 ? color : neg;
    for (int x = (int) (bw * i); x < (int) (bw * (i + 1)); x++) c.vspan(x, top, zero, col, 70);
    if (val != 0) c.line(bw * i, top, bw * (i + 1), top, col, 1.5f);
  }
  float px = -1, py = 0;
  JsonArray fc = v["forecast"];
  for (size_t i = 0; i < fc.size(); i++) {
    if (fc[i].isNull()) {
      px = -1;
      continue;
    }
    float x = bw * (i + 0.5f), yy = y(fc[i] | 0.0f);
    if (px >= 0) c.line(px, py, x, yy, TEXT, 1.5f, 160, 5);
    px = x;
    py = yy;
  }
  px = -1;
  JsonArray soc = v["soc"];
  for (size_t i = 0; i < soc.size(); i++) {
    if (soc[i].isNull()) {
      px = -1;
      continue;
    }
    float x = bw * (i + 0.5f), yy = OV_H - (soc[i] | 0.0f) / 100 * OV_H;
    if (px >= 0) c.line(px, py, x, yy, BATTERY, 2.5f);
    px = x;
    py = yy;
  }
  c.fill_rect(0, (int) zero, OV_W, (int) zero + 1, MUTED, 255);
  c.done();
  lv_obj_clean(this->ov_ticks_);
  for (JsonObject t : v["ticks"].as<JsonArray>()) {
    lv_obj_t *l = this->text_(this->ov_ticks_, this->small_, MUTED, t["label"] | "");
    lv_obj_set_pos(l, (int) ((t["x"] | 0.0f) * OV_W) - 9, 0);
  }
  JsonArray st = v["stats"];
  int tw = st.size() ? (OV_W - 10 * ((int) st.size() - 1)) / (int) st.size() : OV_W;
  for (JsonObject x : st) {
    lv_obj_t *tile = plain(this->ov_stats_);
    lv_obj_set_size(tile, tw, 84);
    lv_obj_set_style_bg_color(tile, lv_color_hex(TILE_BG), 0);
    lv_obj_set_style_bg_opa(tile, LV_OPA_COVER, 0);
    lv_obj_set_style_radius(tile, 12, 0);
    lv_obj_set_pos(this->text_(tile, this->small_, MUTED, x["label"] | ""), 12, 10);
    lv_obj_set_pos(this->text_(tile, this->bold_, TEXT, x["value"] | ""), 12, 40);
  }
}

// Vehicles by their power entity, nodes by id (solar, grid, home, battery-N)
void EnergyUi::apply_vehicles_(JsonArray list, JsonArray details) {
  this->vehicles_.clear();
  for (JsonObject v : list) this->vehicles_[v["entity"] | ""] = key_of(v);
  for (JsonObject d : details) this->vehicles_[d["id"] | ""] = key_of(d);
  if (this->ov_entity_.empty()) return;
  if (this->vehicles_.count(this->ov_entity_))
    this->draw_overlay_();
  else
    this->close_overlay_();  // the vehicle stopped charging
}

}  // namespace energy_ui
}  // namespace esphome
