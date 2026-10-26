<p align="center"><img src="https://raw.githubusercontent.com/MarkusHogsved/power-flow-card-now-flow-forecast/main/assets/icon.png" width="128" alt="Power Flow Card - Now / Flow / Forecast"></p>

# Power Flow Card – Now / Flow / Forecast

**A home energy card for Home Assistant with four views:**

- **Now** – what is happening right now: power flowing between solar, grid,
  home and batteries, every battery's charge level, the large loads that are
  running, and phase currents against the main fuse.
- **Flow** – where every watt comes from and where it goes, as a Sankey
  diagram, plus battery status and today's solar, bought and sold energy.
- **Forecast** – will the batteries last? Home demand for the next 24 hours
  from [LoadCast](https://github.com/MarkusHogsved/LoadCast) (with its
  uncertainty band). What the batteries must supply – demand minus the
  cautious (P10) solar forecast, hour by hour, until solar takes over – is
  compared with the usable energy above each battery's reserve.
- **Review** – how did the last 12 or 24 hours go? Energy bought and sold
  and what it cost, solar, the main battery's lowest level, a chart of the
  hourly price with grid import and battery level, and *What happened*:
  every battery charge and large-load run with the price paid against the
  cheapest window of the same length in the period.

<p align="center">
  <img src="https://raw.githubusercontent.com/MarkusHogsved/power-flow-card-now-flow-forecast/main/docs/images/now.png" width="24%" alt="Now view">
  <img src="https://raw.githubusercontent.com/MarkusHogsved/power-flow-card-now-flow-forecast/main/docs/images/flow.png" width="24%" alt="Flow view">
  <img src="https://raw.githubusercontent.com/MarkusHogsved/power-flow-card-now-flow-forecast/main/docs/images/forecast.png" width="24%" alt="Forecast view">
  <img src="https://raw.githubusercontent.com/MarkusHogsved/power-flow-card-now-flow-forecast/main/docs/images/review.png" width="24%" alt="Review view">
</p>
<p align="center"><sub>Now · Flow · Forecast · Review – a real house on an October morning: 60 kWh home battery, two UPS batteries, water heater running, charged overnight in the cheapest hours.</sub></p>

A status line above the views always answers the first question – *are we
buying from the grid?* – and shows the spot price.

Every entity is configured; nothing is tied to a particular inverter or
brand. Only `home` is required. Everything you leave out (solar, grid,
batteries, loads, phases, LoadCast) simply does not appear.

## Installation (HACS)

1. HACS → ⋮ → *Custom repositories* → add
   `https://github.com/MarkusHogsved/power-flow-card-now-flow-forecast`,
   type *Dashboard*.
2. Install **Power Flow Card - Now / Flow / Forecast** and reload the browser.

## Configuration

```yaml
type: custom:power-flow-card-now-flow-forecast
default_view: now            # now | flow | forecast | review
home:
  entity: sensor.home_power
solar:
  entity: sensor.solar_power
  today_energy: sensor.solar_energy_today
  forecast_today: sensor.solcast_pv_forecast_forecast_today
  forecast_tomorrow: sensor.solcast_pv_forecast_forecast_tomorrow
  forecast_entities:          # Solcast sensors with detailedForecast
    - sensor.solcast_pv_forecast_forecast_today
    - sensor.solcast_pv_forecast_forecast_tomorrow
grid:
  entity: sensor.grid_power   # positive = import
  price: sensor.nordpool_kwh_se3_sek_3_10_025
  today_import: sensor.grid_import_today
  today_export: sensor.grid_export_today
  today_cost: sensor.tibber_accumulated_cost
batteries:
  - name: Solar battery
    state_of_charge: sensor.growatt_battery_soc
    charge_entity: [sensor.bms_1_charge_power, sensor.bms_2_charge_power]
    discharge_entity: [sensor.bms_1_discharge_power, sensor.bms_2_discharge_power]
    capacity_kwh: 60
    reserve_soc: 10
  - name: UPS basement
    state_of_charge: sensor.victron_soc
    entity: sensor.victron_battery_power   # positive = charging
    inside_home: true
  - name: UPS garage
    state_of_charge: sensor.anker_soc
    entity: sensor.anker_charger_plug_power
    inside_home: true
large_loads:                  # only shown while running
  - name: EV
    entity: sensor.ev_charger_power
    icon: mdi:car-electric
    threshold: 100
  - name: Water heater
    entity: sensor.water_heater_power
    icon: mdi:water-boiler
  - name: Washing machine
    entity: sensor.washing_machine_power
    icon: mdi:washing-machine
loads:                        # always listed under "Other"
  - name: Garage
    entity: sensor.garage_power
  - name: Workshop
    entity: sensor.workshop_power
phases:
  - sensor.current_l1
  - sensor.current_l2
  - sensor.current_l3
fuse_current: 25
loadcast:
  forecast: sensor.loadcast_forecast_next_24_h
  error: sensor.loadcast_forecast_error_yesterday
```

### Options

| Key | Description |
|---|---|
| `home.entity` | **Required.** Total home consumption (W or kW). |
| `default_view` | View shown first: `now` (default), `flow`, `forecast` or `review`. The last view you picked is remembered per device. |
| `view_key` | Give each card its own key if you have several on one dashboard, so they remember their views separately. |
| `solar.entity` | Solar production power. |
| `solar.today_energy` | Energy produced today (kWh). |
| `solar.forecast_today` | Forecast total for today (kWh), shown next to the solar node in Now. |
| `solar.forecast_tomorrow` | Forecast total for tomorrow (kWh). |
| `solar.forecast_entities` | Sensors with a Solcast-style `detailedForecast` attribute. Used to find the hour when solar (P10, the cautious estimate) covers the forecast demand. |
| `grid.entity` | Grid power, positive = import. `invert_state: true` if yours is the other way round. |
| `grid.price` | Current electricity price. |
| `grid.today_import` / `grid.today_export` | Energy bought / sold today (kWh). Bought today is also shown under the grid node in Now. |
| `grid.today_cost` | What today's purchases cost, e.g. Tibber's *accumulated cost*. Shown under the grid node in Now, with the sensor's own unit. |
| `grid.import_reason` | Why the home is buying from the grid. The entity's state is a short reason; optional attributes `until` (ISO time it ends) and `detail` (a longer explanation). Shown under the header while importing, as *reason · until 12:00*, with an info button for the detail. Typically a template sensor that reads what your automations have set up. |
| `batteries[]` | `state_of_charge` (required), `entity` (power, positive = charging; one entity or a list that is summed; `invert_state` flips it) or `charge_entity` + `discharge_entity` (both positive, each one entity or a list), `name`, `icon`, `capacity_kwh` and `reserve_soc` (needed for *Will the battery last?*). |
| `batteries[].inside_home` | `true` for a battery that charges from the home's own consumption, e.g. a UPS on a socket. Its level and power are shown, but it is left out of the flows and the Sankey, so its charging is not counted twice. |
| `large_loads[]` | `entity`, `name`, `icon`, `color`, `threshold` (W, default 30). Shown under *Running now* only at or above the threshold. |
| `loads[]` | `entity`, `name`. Always listed under *Other*, together with *Rest of home* (home minus all configured loads). |
| `phases` | Phase current sensors (A), in order L1, L2, L3. |
| `fuse_current` | Main fuse in A, default 25. |
| `loadcast.forecast` | LoadCast *forecast next 24 h* sensor (attribute `forecast`). Also gives *~x kWh more* under the grid node in Now: grid energy still expected before midnight (see below). |
| `loadcast.error` | LoadCast *forecast error yesterday* sensor (%). |

Clicking a node, battery, load or tile opens Home Assistant's more-info
dialog for that entity.

**Expected purchases (Now, under the grid node).** With LoadCast configured,
the card runs through the hours left until midnight: forecast demand minus
solar P10 each hour, a shortfall taken from the batteries above their
reserve and the rest from the grid, a solar surplus charging the batteries
up to full. Only batteries with `capacity_kwh` count. Grid charging that an
automation has planned is not known to the card, so it is not included.

### Review

<p align="center"><img src="https://raw.githubusercontent.com/MarkusHogsved/power-flow-card-now-flow-forecast/main/docs/images/review.png" width="420" alt="Review: bought 43 kWh for 16 SEK, the night charge at the cheapest price and an EV top-up at 4.3 times the cheapest price"></p>

Review reads the recorder history of the configured entities (grid, price,
solar, batteries, large loads, phases) when you open it, and again every
5 minutes while it is open. There is nothing extra to configure; the
recorder must keep at least 24 hours (the default is 10 days).

- **Bought / sold** integrate grid power; cost uses the price sensor's
  history. The headline compares your average buying price with the
  period's average price.
- **What happened** lists battery charging (above 500 W for at least
  10 minutes) and large-load runs (at or above their `threshold`). Runs of
  1 kWh or more get their own entry; smaller ones of the same battery or
  load are summed in one. The price is that of the energy that came from
  the grid (at most the grid import at each moment), compared with the
  cheapest window of the same length in the period: within 10 % is green,
  50 % or more above is red. Charging mostly from solar or battery gets no
  price verdict.
- **Peak grid** is the highest import; the highest phase is a 5-minute
  average, since a main fuse tolerates brief peaks.

## On a wall display

`display/` shows the card on a small touch screen without a browser – for
example an ESP32 with a 7" panel running ESPHome. A renderer runs the real
card in headless Chromium and serves it as a picture; taps and swipes on
the display are replayed in the card. See [display/README.md](display/README.md).

## Development

```sh
npm ci
npm test          # vitest (jsdom), TZ=Europe/Stockholm
npm run typecheck
npm run build     # dist/power-flow-card-now-flow-forecast.js
```

Logic lives in pure functions (`src/model.ts`, `src/sankey.ts`,
`src/forecast.ts`, `src/review.ts`) with tests in `tests/`; the views in `src/views/` only
render. UI strings are in `src/strings.ts`.

- **Validate** (every push and PR): type check, tests and build; HACS
  validation on `main`.
- **Release**: bumping `version` in `package.json` on `main` builds the card
  and publishes a GitHub release `v<version>` with the `.js` attached, which
  HACS installs. Release notes come from `CHANGELOG.md`. Keep `VERSION` in
  `src/power-flow-card-now-flow-forecast.ts` in step (a test checks it).

## License

MIT. See `LICENSE`.
