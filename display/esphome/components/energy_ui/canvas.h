#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>

#include "esp_heap_caps.h"
#include "lvgl.h"

namespace esphome {
namespace energy_ui {

/// An RGB565 canvas in PSRAM for the charts: areas, bands and lines drawn
/// pixel by pixel with alpha blending over a black background.
class Canvas {
 public:
  lv_obj_t *obj{};
  int w{}, h{};

  void create(lv_obj_t *parent, int x, int y, int width, int height) {
    this->w = width;
    this->h = height;
    this->buf_ = static_cast<uint16_t *>(heap_caps_malloc(width * height * 2, MALLOC_CAP_SPIRAM));
    this->obj = lv_canvas_create(parent);
    lv_obj_set_pos(this->obj, x, y);
    if (this->buf_ != nullptr) lv_canvas_set_buffer(this->obj, this->buf_, width, height, LV_COLOR_FORMAT_RGB565);
    this->clear();
  }

  bool ok() const { return this->buf_ != nullptr; }

  void clear(uint32_t rgb = 0x000000) {
    if (!this->ok()) return;
    uint16_t c = to565(rgb);
    std::fill(this->buf_, this->buf_ + this->w * this->h, c);
  }

  /// Blends one pixel; a = 0..255
  void blend(int x, int y, uint32_t rgb, uint8_t a) {
    if (!this->ok() || x < 0 || y < 0 || x >= this->w || y >= this->h || a == 0) return;
    uint16_t &d = this->buf_[y * this->w + x];
    if (a == 255) {
      d = to565(rgb);
      return;
    }
    int dr = (d >> 11) << 3, dg = ((d >> 5) & 0x3F) << 2, db = (d & 0x1F) << 3;
    int sr = (rgb >> 16) & 0xFF, sg = (rgb >> 8) & 0xFF, sb = rgb & 0xFF;
    int r = dr + (sr - dr) * a / 255, g = dg + (sg - dg) * a / 255, b = db + (sb - db) * a / 255;
    d = (uint16_t) (((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3));
  }

  /// A vertical span from y0 to y1 (fractional ends are blended in)
  void vspan(int x, float y0, float y1, uint32_t rgb, uint8_t a) {
    if (y1 < y0) std::swap(y0, y1);
    int i0 = (int) floorf(y0), i1 = (int) floorf(y1);
    if (i0 == i1) {
      this->blend(x, i0, rgb, (uint8_t) (a * (y1 - y0)));
      return;
    }
    this->blend(x, i0, rgb, (uint8_t) (a * (1 - (y0 - i0))));
    for (int y = i0 + 1; y < i1; y++) this->blend(x, y, rgb, a);
    this->blend(x, i1, rgb, (uint8_t) (a * (y1 - i1)));
  }

  void fill_rect(int x0, int y0, int x1, int y1, uint32_t rgb, uint8_t a) {
    for (int x = std::max(x0, 0); x < std::min(x1, this->w); x++)
      for (int y = std::max(y0, 0); y < std::min(y1, this->h); y++) this->blend(x, y, rgb, a);
  }

  /// A line of the given width; dash > 0 draws dash-px pieces with equal gaps
  void line(float x0, float y0, float x1, float y1, uint32_t rgb, float width, uint8_t a = 255, int dash = 0) {
    float dx = x1 - x0, dy = y1 - y0;
    float len = sqrtf(dx * dx + dy * dy);
    int steps = std::max(1, (int) ceilf(len * 2));
    float r = width / 2;
    for (int i = 0; i <= steps; i++) {
      float t = (float) i / steps;
      if (dash > 0 && ((int) (t * len / dash)) % 2 == 1) continue;
      float cx = x0 + dx * t, cy = y0 + dy * t;
      for (int y = (int) floorf(cy - r); y <= (int) ceilf(cy + r); y++)
        for (int x = (int) floorf(cx - r); x <= (int) ceilf(cx + r); x++) {
          float d = sqrtf((x - cx) * (x - cx) + (y - cy) * (y - cy));
          if (d <= r) this->blend(x, y, rgb, a);
        }
    }
  }

  void done() {
    if (this->obj != nullptr) lv_obj_invalidate(this->obj);
  }

  static uint16_t to565(uint32_t rgb) {
    return (uint16_t) ((((rgb >> 16) & 0xF8) << 8) | (((rgb >> 8) & 0xFC) << 3) | ((rgb & 0xFF) >> 3));
  }

 protected:
  uint16_t *buf_{};
};

}  // namespace energy_ui
}  // namespace esphome
