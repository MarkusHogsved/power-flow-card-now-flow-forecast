# The card on a wall display

Shows the card on a small touch display without a browser, e.g. a Waveshare
ESP32-S3-Touch-LCD-7 (800×480) running ESPHome.

```
Home Assistant ──websocket──▶ renderer (headless Chromium) ──JPEG──▶ ESP32 display
                                     ▲                                     │
                                     └────────── taps and swipes ──────────┘
```

- **renderer/** runs the real card in headless Chromium with a live `hass`
  object from Home Assistant's websocket. It serves the picture as a JPEG,
  already rotated for a portrait card on a landscape panel. It replays taps
  as real clicks, so the tabs, the 12 h / 24 h switch and the rest all
  work, and it replays swipes as scrolling, for the long Review view.
- **esphome/** is the display side. It fetches the picture every few
  seconds and sends taps and swipes back. At night it turns the backlight
  off when nobody has touched the screen for a while, and the next touch
  only wakes it up.

The renderer reads the card's configuration from your dashboard
(`DASHBOARD`, `CARD_INDEX`), so the display always matches it. It also
loads the card from the HACS install on Home Assistant, so it runs the
version you have installed. It goes back to the default view after
`IDLE_RESET_S` seconds without a touch.

## Native interface (ESP32-P4)

A picture takes the display about two seconds to decode, so taps feel slow.
On a Waveshare ESP32-P4-WIFI6-Touch-LCD-7B the card can instead be drawn
natively: the renderer serves the card's `snapshot()` (the Now view as data,
with the card's own texts) at `GET /model.json`, and the ESPHome component
`esphome/components/energy_ui` lays it out with LVGL. The figures are the
card's, the screen reacts at once and the flow dots move smoothly. Use
`esphome/waveshare-esp32-p4-wifi6-touch-lcd-7b-native.yaml`; it loads the
component from this repository. It needs card 0.5.0 or later installed in
Home Assistant (the renderer runs the installed card).

## Setup

1. **Token.** In Home Assistant, open your profile → *Security* → *Long-lived
   access tokens*, create one and put it in `HA_TOKEN` in
   `renderer/compose.yaml`.
2. **Renderer.** Start `renderer/compose.yaml` on a machine on the same
   network as Home Assistant (Docker, about 200 MB of RAM). Check
   `http://<host>:8099/frame.jpg` in a browser. The picture lies on its
   side; that is how the panel shows it.
3. **Display.** Set `renderer_url` in
   `esphome/waveshare-esp32-s3-touch-lcd-7.yaml` and install it with
   ESPHome. Use `ROTATE: "270"` if the card comes out upside down for the
   way the panel hangs.

| Renderer setting | Default | |
|---|---|---|
| `HA_URL` | `http://homeassistant.local:8123` | Home Assistant as seen from the renderer |
| `HA_TOKEN` | – | **Required.** Long-lived access token |
| `DASHBOARD` | `lovelace` | `url_path` of the dashboard that holds the card |
| `CARD_INDEX` | `0` | Which card of this type on that dashboard |
| `CARD_CONFIG` | – | JSON card config, instead of reading it from a dashboard |
| `CARD_URL` | HACS on HA, then the latest GitHub release | Where to load the card from |
| `WIDTH` / `HEIGHT` | `800` / `480` | The panel as mounted |
| `ROTATE` | `90` | `90` or `270`: portrait card on a landscape panel; `0`: landscape |
| `BACKGROUND` | `#000000` | Page and card background; black gives an LCD the most contrast |
| `FIXED_HEADER` | `true` | Header and tabs stay put; only the view below them scrolls |
| `IDLE_RESET_S` | `120` | Back to the default view after this long untouched; `0` = never |
| `JPEG_QUALITY` / `MAX_BYTES` | `75` / `64000` | Quality is lowered until the picture fits ESPHome's 64 KiB download buffer |
| `TIME_FORMAT` | `24` | Clock times in the card's texts: `24`, `12` or `language` |
| `PORT` | `8099` | |

The idea of serving finished pictures to thin display clients, and the
ETag / 304 for unchanged pictures, are the same as in
[Tesserae](https://github.com/dmellok/tesserae), which does this for e-ink panels.

Endpoints: `GET /frame.jpg` (with an ETag; 304 when unchanged), `GET /tap?x=&y=`, `GET /swipe?x1=&y1=&x2=&y2=`
(display coordinates), `GET /healthz`.
