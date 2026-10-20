# Changelog

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
