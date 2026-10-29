#pragma once

#include <atomic>
#include <mutex>
#include <string>
#include <vector>

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
  std::vector<std::pair<lv_obj_t *, lv_obj_t *>> phases_;  // bar, text
  std::vector<lv_obj_t *> phase_names_;
  std::vector<FlowLine> flows_;
  bool built_{false};
};

}  // namespace energy_ui
}  // namespace esphome
