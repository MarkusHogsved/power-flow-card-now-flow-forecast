# Changelog

## 0.11.0

- Forecast in colour: LoadCast's demand line and P10-P90 band in purple (the
  same colour as the home forecast in the node details), the demand bar too.
- Forecast: a solar chart for the same 24 hours - Solcast P50 filled, P10-P90
  as a band, with the total. Needs `solar.forecast_entities`.
- Forecast: `battery_plan` - planned grid charging of the home batteries
  (attribute `windows`: start, end, kwh, target_soc, name). Stacked on the
  demand chart in the battery colour, one row per window (when, how much, to
  what level), and counted in the verdict: "Covered with the planned grid
  charging" or "Short by X - Y of it planned from the grid".
- The P4 display gets all three: the solar chart under the demand chart,
  "Will the battery last?" below it.

## 0.10.0

- Home detail: the forecast comes from LoadCast's `past` attribute (LoadCast
  0.1.7+), each hour as forecast when it began. 0.9.0 fetched the sensor's
  history, but LoadCast keeps its forecast attributes out of the recorder,
  so only the running hour showed. Without `past` there is no line.
- The forecast line can have its own colour (`forecastColor`); home's is
  purple so it stands out from the white bars. The P4 draws it a little
  thicker, and the legend takes the line's colour.

## 0.9.0

- Node details, home: LoadCast's forecast as a line against the outcome, each
  past hour as forecast when it began (the sensor itself only holds the hours
  from now on, so its attribute history is fetched, at most every 30 min),
  plus "Forecast, 24 h" next to "Used, 24 h" when the whole window is covered.
- The P4 price box toggles back to the view you came from.

## 0.8.0

- Snapshot: `details` - the last 24 h of solar, grid, home and each battery
  as 96 buckets (signed for grid and batteries, the battery level as a line,
  Solcast's forecast for solar) with their figures: today/forecast/peak,
  bought/sold/cost/highest import and export, used and expected rest of day,
  charged/discharged and lowest/highest level. History is fetched in the
  background at most every 5 min.
- Native P4 display: tap solar, grid, home or a battery on Now for that chart
  and its figures (the vehicle tile works as before).

## 0.7.1

- The tabs always share one row, however many views the card has (five no
  longer wrap onto a second row in a narrow column).

## 0.7.0

- New view **Price**: today's prices (and tomorrow's once published) per
  period, coloured cheap / mid / expensive, past periods dimmed, now and
  midnight marked, the sell price (`grid.sell_price`) as a line, and tiles for
  now/next, today, tomorrow and the cheapest hour and 3 h ahead. Hover or tap
  a bar for its time and price. The same data as the native display's Price
  view. Tapping the header price opens it.
- New `views`: which views the card offers and in what order; with one view
  the tabs are hidden (`views: [price]` makes a price card of its own).
- New `show_header` (default `true`).

## 0.6.3

- Price view: the cheapest hour / 3 h only count unbroken runs of prices; a
  missing period no longer gives a window with an unpriced part.

## 0.6.2

- Snapshot: a Price view - all known prices (today, and tomorrow once
  published) with the sell price as a line, now, price lines, and tiles for
  now/next, today and tomorrow (average, cheapest and dearest with times)
  and the cheapest hour and 3 h ahead.
- Native P4 display: the Price view as a fifth tab; tapping the price box
  (in every view) or the small chart on Now opens it.
- Renderer: `GET /reload` restarts it at once with the latest card and
  renderer, e.g. right after a HACS update.

## 0.6.1

- Snapshot: `prices` for Now - the header price for the coming 12 h, from the
  price entity's `today`/`tomorrow` quarter lists or Nord Pool's
  `raw_today`/`raw_tomorrow`, as bars coloured cheap / mid / expensive.
- Native P4 display: that price chart above the phases on Now; Flow shows
  today's totals as rows (the tiles were too narrow).
- Renderer: restarts itself when the card in HACS or its own `server.mjs`
  changes, so a release no longer needs a manual restart.
- Renderer: runs the card in Home Assistant's timezone (read with
  `get_config`, or `TZ`). In a UTC container every clock time in the card's
  texts was an hour off (Review's period, events, solar peak).
- Price lists with 92 or 100 quarters (daylight-saving days) are placed in
  real 15-minute steps from midnight.

## 0.6.0

- New `snapshotFull()`: every view as plain data (Now, Flow with its Sankey
  layout, Forecast with the hourly chart and *Will the battery last?*, Review
  with its chart, legend and events) plus the last 12 h of running vehicles.
  Each view and its snapshot share one function, so the texts cannot drift
  apart. The renderer's `/model.json` serves it; new renderer setting
  `TIME_FORMAT` (default `24`).
- Native P4 display: a tab rail on the left edge and all four views, drawn
  with LVGL (charts on a canvas in PSRAM). Tapping a running vehicle's tile
  opens its power and battery level over the last 12 h. Back to Now after
  two minutes untouched. The clock comes from NTP.

## 0.5.0

- New `snapshot()` on the card: the Now view as plain data with the card's
  own texts (header, nodes, flows, battery bank, running loads, others,
  phases). The display renderer serves it as `/model.json`, so a display can
  draw its own interface instead of showing a picture of the card.
- Display: `display/esphome/waveshare-esp32-p4-wifi6-touch-lcd-7b-native.yaml`
  and the `energy_ui` ESPHome component draw the Now view natively with LVGL
  on a Waveshare ESP32-P4-WIFI6-Touch-LCD-7B. The picture variant for the
  same board is `waveshare-esp32-p4-wifi6-touch-lcd-7b.yaml`.

## 0.4.3

- New `large_loads[].presence`: the vehicle's device_tracker and/or an on/off
  switch (one entity or a list). Forecast leaves the vehicle out while it is
  away or the switch is off. Unknown or unavailable count as home.

## 0.4.2

- Forecast: a vehicle below its charge limit is part of the picture. The
  header adds *+ 30 kWh car*, and *Will the battery last?* gets a row with
  its level → limit and energy. New `large_loads[].charge_plan` (start and end
  entities, e.g. a smart charging automation's helpers): planned charging is
  drawn in the chart in the vehicle's colour and counted as bought from the
  grid; without a plan the energy is counted against the batteries.

## 0.4.1

- Now: the phases always share one row under the fuse label. On a phone L3
  wrapped to a line of its own, which made L1 look like the highest phase.

## 0.4.0

- New `grid.sell_price`: what a sold kWh earns, when it differs from
  `grid.price` (fees and VAT on bought energy, none on sold). Review values
  sold energy and export events with it, and judges a sale against the
  period's average selling price.
- New `grid.price_name`: the label above the price in the header (default
  *Spot price*) – e.g. *Price* when `grid.price` includes fees.
- The vehicle cost line reads *at current price* instead of *at spot price*.

## 0.3.9

- Review: a vehicle's battery level from → to allows for the car reporting
  late – the lowest level in the first 30 min of the charge and the highest
  in the 30 min after it (26/10 showed 70 → 75 % for a 63 → 80 % charge).

## 0.3.8

- Review: a vehicle's charge (a large load with `soc`) shows the outcome –
  battery level from → to, energy and, with `session_cost`, what the charge
  cost and the price per kWh. Tapping it unfolds the same power and battery
  level chart as on the Now tile, for that charge.

## 0.3.7

- Vehicle tile: the finish time reads *17 kWh to go → 19:28*.
- New `large_loads[].session_cost`: what the current charging session has
  cost so far. The tile then shows the whole session, *~x SEK this charge* –
  the cost so far plus what is left to the limit.
- Tapping a vehicle tile unfolds its charging power and battery level over
  the last 12 h in one chart, with the charge limit as a dashed line (refreshed
  every minute while open). Buttons below open each entity's own history.

## 0.3.6

- New `large_loads[].cost_price`: an entity with the price per kWh to use for
  the vehicle's cost line instead of the spot price, e.g. a sensor that values
  energy from the house battery. The line then reads *~x SEK estimated*.

## 0.3.5

- A large load can be a vehicle: with `soc` the tile shows the battery level
  and, with `soc_limit`, *61 % → 80 %* (or *at limit*). Adding `capacity_kwh`
  also shows the energy left, when it is done at the current power, and the
  cost at the current spot price (`charge_efficiency`, default 0.9).

## 0.3.4

- The import reason's time follows the profile's time format, so a 24 h
  clock shows "until 13:00" even with an English interface.
- No dark box around the info button after tapping it.

## 0.3.3

- New `grid.import_reason`: while the home buys from the grid, a line under
  the header says why and until when (the entity's state, plus its `until`
  attribute). An info button unfolds the entity's `detail` attribute; tapping
  the text opens the entity.

## 0.3.2

- Now: under the grid node, *~x kWh more* – grid energy still expected
  before midnight, from LoadCast demand, solar P10 and the batteries'
  usable energy, hour by hour. Needs `loadcast.forecast`.
- The grid node's figures are on one line (*41 kWh · 42 SEK*) and the label
  is left-aligned, so it no longer runs into the battery bank.

## 0.3.1

- Now: the solar node also shows today's forecast (new `solar.forecast_today`),
  and the grid node shows energy bought today (`grid.today_import`) and what
  it cost (new `grid.today_cost`). Each figure opens its sensor.
- README screenshots retaken, now with the node icons.

## 0.3.0

- New fourth view **Review**: how the last 12 or 24 hours went, from the
  recorder history of the entities already configured. Bought and sold
  energy with cost and revenue, average buying price against the period's
  average, solar, the main battery's lowest level, a chart of the hourly
  price (cheap / mid / expensive) with grid import, battery level and the
  charge and load runs, and *What happened*: each battery charge and
  large-load run with the price paid against the cheapest window of the
  same length. Peak grid import and the highest phase (5-minute average)
  against the fuse. Fetched when opened and every 5 minutes while open.
- README: screenshots of all four views.

## 0.2.0

- Batteries can sum several entities: `entity` accepts a list, or give
  `charge_entity` and `discharge_entity` (each one entity or a list). For
  inverters whose "combined" battery power only covers one of two BMS packs.
- New `inside_home: true` for batteries that charge from the home's own
  consumption (a UPS on a socket). Their level and power are shown, but
  they are left out of the flows and the Sankey, so an emergency charge
  that already shows up as a load is not counted twice.
- Forecast: *Will the battery last?* now uses demand minus solar P10 hour
  by hour, instead of the whole demand. On a low-solar day the old figure
  said "short" although solar would cover part of it.
- Now: the battery bank shows discharge (↑) and charge (↓) separately
  instead of a net figure that hid one battery charging while another
  discharged, and each battery gets its own arrow.
- Header: the price shows its full unit (e.g. SEK/kWh).

## 0.1.0

- First release: one card, three views.
  - **Now**: power-flow diagram (solar, grid, home, battery bank), every
    battery's charge level, *Running now* tiles for large loads above their
    threshold, *Other* loads with the rest of home, and phase currents
    against the main fuse.
  - **Flow**: two-column Sankey from sources (solar, grid import, discharging
    batteries) to uses (running loads, other loads, rest of home, charging
    batteries, grid export), battery bars and today's solar/bought/sold.
  - **Forecast**: LoadCast 24-hour demand with its P10-P90 band, demand
    until solar P10 takes over (Solcast `detailedForecast`) against usable
    battery energy above each battery's reserve, and solar tomorrow.
- Status line (buying / selling / solar / battery / quiet) and spot price
  above the views; the chosen view is remembered per device.
- Every entity is configurable; only `home` is required.
