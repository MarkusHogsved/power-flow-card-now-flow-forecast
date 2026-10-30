#pragma once

#include <atomic>
#include <map>
#include <mutex>
#include <string>
#include <vector>

#include "canvas.h"

#include "esphome/components/font/font.h"
#include "esphome/components/json/json_util.h"
#include "esphome/components/time/real_time_clock.h"
#include "esphome/core/component.h"
#include "lvgl.h"

namespace esphome {
namespace energy_ui {

/// A polyline the flow lines and their moving dots follow (screen pixels).
struct Path {
  std::vector<lv_point_precise_t> points;
  std::vector<float> lengths;  // cumulative, same size as points
};

/// One flow between two nodes: a dashed idle line, a coloured line and a dot.
struct FlowLine {
  const char *key;
  uint32_t color;
  bool idle_track;
  Path path;
  lv_obj_t *idle{};
  lv_obj_t *line{};
  lv_obj_t *dot{};
  uint32_t duration_ms{};
};

/// MDI glyph for an icon name ("mdi:car-electric"), from the icon font
const char *icon_glyph(const char *icon);

struct BatteryCell {
  lv_obj_t *box{}, *bar{}, *soc{}, *name{};
};

class EnergyUi : public Component {
 public:
  void set_url(const std::string &url) { this->url_ = url; }
  void set_interval_ms(uint32_t ms) { this->interval_ms_ = ms; }
  void set_font_small(font::Font *f) { this->small_ = f->get_lv_font(); }
  void set_font_medium(font::Font *f) { this->medium_ = f->get_lv_font(); }
  void set_font_bold(font::Font *f) { this->bold_ = f->get_lv_font(); }
  void set_font_large(font::Font *f) { this->large_ = f->get_lv_font(); }
  void set_font_icons(font::Font *f) { this->icons_ = f->get_lv_font(); }
  void set_time(time::RealTimeClock *t) { this->time_ = t; }

  // After LVGL itself (setup_priority::PROCESSOR)
  float get_setup_priority() const override { return setup_priority::PROCESSOR - 10; }
  void setup() override;
  void loop() override;
  void dump_config() override;

 protected:
  static void fetch_task(void *arg);
  int fetch_(std::string &body);
  void build_();
  void apply_(JsonObject root);
  void set_flow_(FlowLine &f, float watts);
  void rebuild_cells_(size_t n);
  void rebuild_running_(JsonArray running);
  void rebuild_others_(size_t n);

  // The other views, tabs and the vehicle chart (views.cpp)
  static const int VIEWS = 5;
  static const int PRICE_VIEW = 4;
  static void tab_cb(lv_event_t *e);
  static void tile_cb(lv_event_t *e);
  static void overlay_cb(lv_event_t *e);
  static void to_price_cb(lv_event_t *e);
  void build_tabs_();
  void select_(int view);
  void build_flow_();
  void build_forecast_();
  void build_review_();
  void build_overlay_();
  void build_price_();
  void apply_price_view_(JsonObject p);
  void apply_flow_(JsonObject f);
  void apply_forecast_(JsonObject f);
  void apply_review_(JsonObject r);
  void apply_vehicles_(JsonArray list);
  void open_overlay_(const std::string &entity);
  void close_overlay_();
  void draw_overlay_();
  lv_obj_t *text_(lv_obj_t *parent, const lv_font_t *font, uint32_t color, const char *text);

  lv_obj_t *label_(lv_obj_t *parent, const lv_font_t *font, uint32_t color, int x, int y);
  lv_obj_t *box_(lv_obj_t *parent, int x, int y, int w, int h, uint32_t border, int border_w);

  std::string url_;
  uint32_t interval_ms_{3000};
  const lv_font_t *small_{}, *medium_{}, *bold_{}, *large_{}, *icons_{};
  time::RealTimeClock *time_{};

  // Fetch task -> loop
  std::mutex mutex_;
  std::string pending_;
  bool has_pending_{false};
  std::string etag_;
  std::atomic<uint32_t> last_ok_ms_{0};
  bool offline_shown_{false};

  // Widgets
  lv_obj_t *screen_{};
  lv_obj_t *title_{}, *subtitle_{}, *reason_{}, *clock_{}, *offline_{};
  lv_obj_t *price_box_{}, *price_name_{}, *price_value_{}, *price_unit_{};
  lv_obj_t *solar_node_{}, *solar_text_{}, *solar_label_{};
  lv_obj_t *grid_node_{}, *grid_text_{}, *grid_label_{};
  lv_obj_t *home_text_{};
  lv_obj_t *bank_{}, *bank_title_{}, *bank_text_{}, *bank_cells_{};
  std::vector<BatteryCell> cells_;
  lv_obj_t *running_title_{}, *running_{};
  std::string running_key_;
  lv_obj_t *others_title_{}, *others_{};
  std::vector<std::pair<lv_obj_t *, lv_obj_t *>> other_rows_;
  lv_obj_t *phases_title_{};
  lv_obj_t *pr_title_{}, *pr_range_{}, *pr_ticks_{};
  Canvas pr_canvas_;
  std::string pr_key_;
  void apply_prices_(JsonObject p);
  std::vector<std::pair<lv_obj_t *, lv_obj_t *>> phases_;  // bar, text
  std::vector<lv_obj_t *> phase_names_;
  std::vector<FlowLine> flows_;
  bool built_{false};

  // Everything but the tab rail and the vehicle chart lives in main_
  lv_obj_t *main_{};
  lv_obj_t *views_[VIEWS]{};
  lv_obj_t *tabs_[VIEWS]{};
  lv_obj_t *tab_labels_[VIEWS]{};
  lv_obj_t *tab_icons_[VIEWS]{};
  int view_{0};
  std::vector<std::string> running_entities_;

  lv_obj_t *fl_src_title_{}, *fl_use_title_{}, *fl_labels_{}, *fl_nothing_{}, *fl_bats_{}, *fl_stats_{};
  Canvas fl_canvas_;
  std::string fl_key_;

  lv_obj_t *fc_title_{}, *fc_total_{}, *fc_plus_{}, *fc_labels_{}, *fc_band_{}, *fc_unavailable_{};
  lv_obj_t *fc_last_title_{}, *fc_rows_{}, *fc_tomorrow_{}, *fc_tomorrow_label_{}, *fc_tomorrow_value_{};
  Canvas fc_canvas_;
  std::string fc_key_;

  lv_obj_t *rv_period_{}, *rv_message_{}, *rv_headline_{}, *rv_sub_{}, *rv_tiles_{}, *rv_ticks_{}, *rv_legend_{};
  lv_obj_t *rv_events_title_{}, *rv_events_{}, *rv_footer_{}, *rv_footer_text_{}, *rv_footer_verdict_{};
  Canvas rv_canvas_;
  std::string rv_key_;

  lv_obj_t *pv_title_{}, *pv_legend_{}, *pv_labels_{}, *pv_tiles_{}, *pv_unavailable_{};
  Canvas pv_canvas_;
  std::string pv_key_;

  lv_obj_t *ov_{}, *ov_title_{}, *ov_power_{}, *ov_soc_{}, *ov_ticks_{};
  Canvas ov_canvas_;
  std::string ov_entity_, ov_key_;
  std::map<std::string, std::string> vehicles_;  // entity -> its history as JSON
};

}  // namespace energy_ui
}  // namespace esphome
