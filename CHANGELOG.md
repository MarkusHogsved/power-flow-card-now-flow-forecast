# Changelog

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
