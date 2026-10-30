// Renders the card in headless Chromium and serves it as a JPEG, for small
// displays that cannot run a browser themselves (e.g. an ESP32 with a
// 800x480 RGB panel). The card keeps a live hass object fed from Home
// Assistant's websocket, so it looks exactly as on a dashboard. Taps and
// swipes from the display are replayed as real clicks and scrolls.
//
// Endpoints:
//   GET /frame.jpg               current picture (WIDTH x HEIGHT, already rotated; ETag, 304 when unchanged)
//   GET /reload                  restart now with the latest card and renderer (Docker restarts it)
//   GET /model.json              every view as data (the card's snapshotFull(); ETag, 304 when unchanged)
//       ?tap=x,y&n=7             ... after a tap at display coordinates
//       ?swipe=x1,y1,x2,y2&n=8   ... after a swipe
//                                n is a sequence number: the display keeps the
//                                URL, so a repeated n is not replayed
//   GET /tap?x=&y=               click at display coordinates
//   GET /swipe?x1=&y1=&x2=&y2=   scroll the card by the swipe distance
//   GET /status                  states known / in the page, for checking
//   GET /healthz                 "ok" once connected and rendered
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

// Node 22 has WebSocket built in; older versions use the ws package that ships with puppeteer
const WS = globalThis.WebSocket ?? (await import("ws")).default;

const env = (name, fallback) => process.env[name] ?? fallback;
const HA_URL = env("HA_URL", "http://homeassistant.local:8123").replace(/\/$/, "");
const HA_TOKEN = env("HA_TOKEN", "");
const DASHBOARD = env("DASHBOARD", "lovelace"); // url_path of the dashboard holding the card
const CARD_TYPE = "custom:power-flow-card-now-flow-forecast";
const CARD_INDEX = Number(env("CARD_INDEX", "0")); // which of the matching cards, in dashboard order
const CARD_CONFIG = env("CARD_CONFIG", ""); // JSON; overrides reading the card from the dashboard
const CARD_URL = env("CARD_URL", ""); // card .js; default HACS path on HA, then the GitHub release
const WIDTH = Number(env("WIDTH", "800")); // display size in pixels, as mounted
const HEIGHT = Number(env("HEIGHT", "480"));
const ROTATE = Number(env("ROTATE", "90")); // 0, 90 or 270: card portrait on a landscape panel
const PORT = Number(env("PORT", "8099"));
const QUALITY = Number(env("JPEG_QUALITY", "75"));
const MAX_BYTES = Number(env("MAX_BYTES", "64000")); // ESPHome's online_image buffer is at most 64 KiB
const LANGUAGE = env("LANGUAGE", "en");
const TIME_FORMAT = env("TIME_FORMAT", "24"); // "24", "12" or "language" (HA's profile setting)
const BACKGROUND = env("BACKGROUND", "#000000"); // card and page background; black gives an LCD the most contrast
const FIXED_HEADER = env("FIXED_HEADER", "true") !== "false"; // header and tabs stay put, only the view scrolls
const IDLE_RESET_S = Number(env("IDLE_RESET_S", "120")); // back to the default view after this long untouched; 0 = never

if (!HA_TOKEN) {
  console.error("HA_TOKEN is required (a long-lived access token from your Home Assistant profile)");
  process.exit(1);
}

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------------------------------------------------------------- Home Assistant

let ws;
let nextId = 1;
const pending = new Map();
const states = {};
let connected = false;

const send = (msg) =>
  new Promise((resolve, reject) => {
    if (!connected) return reject(new Error("not connected to Home Assistant"));
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ ...msg, id }));
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`timeout: ${msg.type}`));
    }, 30_000);
  });

// Resolves on the first successful login, even if Home Assistant was not up
// yet and it took several attempts (e.g. both started by the same compose)
let firstLogin;
const ready = new Promise((resolve) => (firstLogin = resolve));

const connect = () => {
  ws = new WS(`${HA_URL.replace(/^http/, "ws")}/api/websocket`);
  ws.onmessage = async (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === "auth_required") {
      ws.send(JSON.stringify({ type: "auth", access_token: HA_TOKEN }));
    } else if (msg.type === "auth_invalid") {
      console.error("Home Assistant rejected the token:", msg.message);
      process.exit(1);
    } else if (msg.type === "auth_ok") {
      connected = true;
      log("connected to Home Assistant", msg.ha_version);
      for (const s of await send({ type: "get_states" })) states[s.entity_id] = s;
      fullPush = true;
      await send({ type: "subscribe_events", event_type: "state_changed" });
      dirty = true;
      firstLogin();
    } else if (msg.type === "event" && msg.event?.event_type === "state_changed") {
      const { entity_id, new_state } = msg.event.data;
      if (new_state) states[entity_id] = new_state;
      else delete states[entity_id];
      dirty = true;
    } else if (msg.type === "result" && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.success) p.resolve(msg.result);
      else p.reject(new Error(msg.error?.message ?? "request failed"));
    }
  };
  // Node's WebSocket fires only "error" (no "close") when the connection is
  // refused, e.g. while Home Assistant is still starting - reconnect on both,
  // once per socket
  const socket = ws;
  let retrying = false;
  const retry = () => {
    if (retrying || socket !== ws) return;
    retrying = true;
    connected = false;
    for (const p of pending.values()) p.reject(new Error("connection closed"));
    pending.clear();
    log("no connection to Home Assistant, retrying in 10 s");
    setTimeout(connect, 10_000);
  };
  ws.onclose = retry;
  ws.onerror = retry;
};

/** The card's config: CARD_CONFIG, or the CARD_INDEX-th card of our type on DASHBOARD. */
const loadCardConfig = async () => {
  if (CARD_CONFIG) return JSON.parse(CARD_CONFIG);
  const dash = await send({ type: "lovelace/config", url_path: DASHBOARD === "lovelace" ? null : DASHBOARD });
  const found = [];
  const walk = (node) => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node && typeof node === "object") {
      if (node.type === CARD_TYPE) found.push(node);
      Object.values(node).forEach(walk);
    }
  };
  walk(dash);
  if (!found[CARD_INDEX]) throw new Error(`no ${CARD_TYPE} #${CARD_INDEX} on dashboard ${DASHBOARD}`);
  // The display remembers its own view, apart from the dashboards
  return { ...found[CARD_INDEX], view_key: "display" };
};

const loadCardScript = async (quiet = false) => {
  const urls = CARD_URL
    ? [CARD_URL]
    : [
        `${HA_URL}/hacsfiles/power-flow-card-now-flow-forecast/power-flow-card-now-flow-forecast.js`,
        "https://github.com/MarkusHogsved/power-flow-card-now-flow-forecast/releases/latest/download/power-flow-card-now-flow-forecast.js",
      ];
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        if (!quiet) log("card from", url);
        return await res.text();
      }
    } catch {
      // try the next one
    }
  }
  throw new Error("could not download the card");
};

// ---------------------------------------------------------------- Page

const portrait = ROTATE === 90 || ROTATE === 270;
const CARD_W = portrait ? HEIGHT : WIDTH;
const CARD_H = portrait ? WIDTH : HEIGHT;
const transform =
  ROTATE === 90
    ? `translateX(${WIDTH}px) rotate(90deg)`
    : ROTATE === 270
      ? `translateY(${HEIGHT}px) rotate(-90deg)`
      : "none";

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap">
<style>
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: ${BACKGROUND}; }
  :root {
    --primary-text-color: #f2f2f2; --secondary-text-color: #a8a8a8; --card-background-color: ${BACKGROUND};
    --divider-color: rgba(225, 225, 225, 0.12); --primary-color: #03a9f4;
    font-family: Roboto, sans-serif; color: #e1e1e1;
  }
  #screen { position: absolute; top: 0; left: 0; width: ${CARD_W}px; height: ${CARD_H}px;
            transform-origin: 0 0; transform: ${transform}; overflow: hidden; }
  #scroll { width: 100%; height: 100%; overflow-y: auto; scrollbar-width: none; }
</style></head><body><div id="screen"><div id="scroll"></div></div>
<script type="module">
  // Stand-ins for Home Assistant's own elements, which the card uses
  import * as mdi from "https://cdn.jsdelivr.net/npm/@mdi/js@7.4.47/mdi.js";
  const icons = {};
  for (const [k, v] of Object.entries(mdi)) icons[k.slice(3).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()] = v;
  customElements.define("ha-card", class extends HTMLElement {
    connectedCallback() {
      Object.assign(this.style, { display: "flex", minHeight: "${CARD_H}px", boxSizing: "border-box",
        ${FIXED_HEADER ? `height: "${CARD_H}px", overflow: "hidden",` : ""}
        background: "var(--card-background-color)", color: "var(--primary-text-color)" });
    }
  });
  customElements.define("ha-icon", class extends HTMLElement {
    set icon(v) { this._icon = v; this.draw(); }
    get icon() { return this._icon; }
    connectedCallback() { if (!this._icon) this._icon = this.getAttribute("icon"); this.draw(); }
    draw() {
      const d = icons[String(this._icon || "").replace("mdi:", "")] || "";
      this.style.display = "inline-flex";
      this.innerHTML = '<svg viewBox="0 0 24 24" style="width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px)"><path fill="currentColor" d="' + d + '"/></svg>';
    }
  });
  window.__iconsReady = true;
</script></body></html>`;

let browser;
let page;
let cardHash = "";
const hash = (text) => createHash("sha1").update(text).digest("hex");
let dirty = true;
let lastPush = 0;
// Entities changed since the last push; the page keeps its own copy of the
// states, so only these travel (a whole HA instance is thousands of entities)
const changed = new Set();
let fullPush = true;
let cardConfig;
let lastTouch = 0;
let lastInput = null; // n of the last tap/swipe carried in /frame.jpg

const FULL_PUSH_MS = 5 * 60_000; // all states again now and then, in case a delta was lost
let lastFullPush = 0;
let pageStates = 0;

const pushHass = async () => {
  const full = fullPush || Date.now() - lastFullPush > FULL_PUSH_MS;
  const ids = full ? null : [...changed];
  const delta = full ? states : Object.fromEntries(ids.map((id) => [id, states[id] ?? null]));
  // The flags are cleared only after the page has the states - a failed
  // push must not leave the card with only later changes
  pageStates = await page.evaluate(
    (delta, full, language, timeFormat) => {
      if (full || !window.__states) window.__states = {};
      for (const [id, s] of Object.entries(delta)) {
        if (s) window.__states[id] = s;
        else delete window.__states[id];
      }
      const card = window.__card;
      if (card) {
        card.hass = { states: { ...window.__states }, locale: { language, time_format: timeFormat }, language, callWS: (msg) => window.__callWS(msg) };
      }
      return Object.keys(window.__states).length;
    },
    delta,
    full,
    LANGUAGE,
    TIME_FORMAT,
  );
  if (full) {
    fullPush = false;
    lastFullPush = Date.now();
    changed.clear();
  } else {
    for (const id of ids) changed.delete(id);
  }
  dirty = changed.size > 0;
  lastPush = Date.now();
};

const start = async () => {
  connect();
  await ready;
  const [config, script] = await Promise.all([loadCardConfig(), loadCardScript()]);
  cardHash = hash(script);
  browser = await puppeteer.launch({
    headless: env("HEADLESS", "true") === "shell" ? "shell" : true,
    args: ["--no-sandbox", "--font-render-hinting=none"],
  });
  page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });
  // The card shows clock times and reads local-midnight price lists in the
  // page's timezone: use Home Assistant's, not the container's (UTC)
  let timeZone = env("TZ", "");
  if (!timeZone) {
    try {
      timeZone = (await send({ type: "get_config" }))?.time_zone ?? "";
    } catch (e) {
      log("could not read Home Assistant's timezone:", e.message);
    }
  }
  if (timeZone) {
    await page.emulateTimezone(timeZone);
    log("timezone", timeZone);
  }
  page.on("pageerror", (e) => log("page error:", e.message));
  await page.exposeFunction("__callWS", (msg) => send(msg));
  await page.setContent(PAGE, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__iconsReady === true, { timeout: 30_000 });
  await page.addScriptTag({ content: script, type: "module" });
  cardConfig = config;
  await page.evaluate(async (cfg) => {
    await customElements.whenDefined("power-flow-card-now-flow-forecast");
    const card = document.createElement("power-flow-card-now-flow-forecast");
    card.setConfig(cfg);
    document.getElementById("scroll").appendChild(card);
    window.__card = card;
  }, config);
  if (FIXED_HEADER) {
    // Only the view below the tabs scrolls: the card's own .view gets the rest of the height
    await page.evaluate(async () => {
      const card = window.__card;
      await card.updateComplete;
      // An adopted sheet: Lit keeps its own sheets there and never replaces the list
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(`.view { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: none; }
                         .view > * { flex-shrink: 0; }
                         .view::-webkit-scrollbar { display: none; }`);
      card.shadowRoot.adoptedStyleSheets = [...card.shadowRoot.adoptedStyleSheets, sheet];
    });
  }
  await pushHass();
  await page.evaluate(() => document.fonts.ready);
  log(`rendering ${WIDTH}x${HEIGHT}, card ${CARD_W}x${CARD_H}, rotate ${ROTATE}`);
};

/** What a swipe scrolls: the card's view (fixed header) or the whole card. */
const scrollBy = (dy) =>
  page.evaluate(
    (dy, fixed) => {
      const el = fixed ? window.__card?.shadowRoot?.querySelector(".view") : document.getElementById("scroll");
      el?.scrollBy(0, dy);
    },
    dy,
    FIXED_HEADER,
  );

/** Display coordinates (as mounted) -> card coordinates. */
const toCard = (x, y) =>
  ROTATE === 90 ? { x: y, y: WIDTH - x } : ROTATE === 270 ? { x: HEIGHT - y, y: x } : { x, y };

/** Default view, scrolled to the top (setConfig picks the default view, as storage is unavailable here). */
const resetView = () =>
  page.evaluate((cfg) => {
    window.__card?.setConfig(cfg);
    document.getElementById("scroll").scrollTop = 0;
    const view = window.__card?.shadowRoot?.querySelector(".view");
    if (view) view.scrollTop = 0;
  }, cardConfig);

const frame = async () => {
  if (IDLE_RESET_S > 0 && lastTouch && Date.now() - lastTouch > IDLE_RESET_S * 1000) {
    lastTouch = 0;
    await resetView();
  }
  // Only what changed since the last picture (and everything every few minutes)
  if (dirty || fullPush || Date.now() - lastFullPush > FULL_PUSH_MS) {
    try {
      await pushHass();
    } catch (e) {
      log("state push failed:", e.message);
    }
  }
  await page.evaluate(() => window.__card?.updateComplete);
  // Lower the quality until the picture fits the display's download buffer
  let quality = QUALITY;
  for (;;) {
    const jpeg = await page.screenshot({ type: "jpeg", quality, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
    if (jpeg.length <= MAX_BYTES || quality <= 30) return jpeg;
    quality -= 10;
  }
};

// One page, so requests run one at a time
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

const server = http.createServer((req, res) => {
  // Hard close a while after the answer: the display's HTTP client has been
  // seen to keep connections for ~2 minutes, and an ESP32 runs out of sockets
  // after about ten. Not sooner than 30 s: "finish" only means the data left
  // here, and the display may still be downloading and decoding (up to ~6 s
  // seen) - a reset then left ESPHome's online_image stuck "already being
  // updated" until the display's watchdog restarted it.
  res.on("finish", () => {
    const socket = res.socket;
    setTimeout(() => {
      if (socket && !socket.destroyed) socket.resetAndDestroy();
    }, 30_000);
  });
  const url = new URL(req.url, "http://x");
  const n = (k) => Number(url.searchParams.get(k));
  // Content-Length and Connection: close on every answer - ESPHome's HTTP
  // client otherwise waits for the connection to close (about a minute)
  const done = (code, body = "", type = "text/plain") => {
    res.writeHead(code, {
      "content-type": type,
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      connection: "close",
    });
    res.end(body);
  };
  if (!page) return done(503, "starting");
  serial(async () => {
    try {
      if (url.pathname === "/frame.jpg") {
        // A tap or swipe carried in the picture URL: one request per touch, and
        // the answer already shows its result
        const n = url.searchParams.get("n");
        const nums = (k) => (url.searchParams.get(k) ?? "").split(",").map(Number);
        if (n !== null && n !== lastInput) {
          lastInput = n;
          lastTouch = Date.now();
          if (url.searchParams.has("tap")) {
            const [x, y] = nums("tap");
            await page.mouse.click(x, y);
            await new Promise((r) => setTimeout(r, 150));
          } else if (url.searchParams.has("swipe")) {
            const [x1, y1, x2, y2] = nums("swipe");
            const a = toCard(x1, y1);
            const b = toCard(x2, y2);
            await scrollBy(a.y - b.y);
          }
        }
        // ETag: an unchanged picture answers 304, so the display skips decoding and redrawing it
        const jpeg = await frame();
        const etag = `"${createHash("sha1").update(jpeg).digest("hex").slice(0, 16)}"`;
        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, { etag, "cache-control": "no-cache", connection: "close" });
          res.end();
        } else {
          res.writeHead(200, {
            etag,
            "content-type": "image/jpeg",
            "content-length": jpeg.length,
            "cache-control": "no-cache",
            connection: "close",
          });
          res.end(jpeg);
        }
      } else if (url.pathname === "/model.json") {
        // The Now view as data, for a display that draws its own interface
        // (display/esphome/waveshare-esp32-p4-wifi6-touch-lcd-7b.yaml). Same
        // ETag / 304 as the picture, so an unchanged model costs nothing.
        if (dirty || fullPush || Date.now() - lastFullPush > FULL_PUSH_MS) {
          try {
            await pushHass();
          } catch (e) {
            log("state push failed:", e.message);
          }
        }
        // All views when the card has snapshotFull() (0.6.0), else Now only
        const snap = await page.evaluate(async () => {
          const card = window.__card;
          if (card?.snapshotFull) return await card.snapshotFull();
          return card?.snapshot ? card.snapshot() : undefined;
        });
        if (snap === undefined) return done(501, "the installed card has no snapshot() - update it (0.5.0 or later)");
        const body = JSON.stringify(snap);
        const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, { etag, "cache-control": "no-cache", connection: "close" });
          res.end();
        } else {
          res.writeHead(200, {
            etag,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "cache-control": "no-cache",
            connection: "close",
          });
          res.end(body);
        }
      } else if (url.pathname === "/tap") {
        lastTouch = Date.now();
        await page.mouse.click(n("x"), n("y"));
        await new Promise((r) => setTimeout(r, 150));
        done(204);
      } else if (url.pathname === "/swipe") {
        lastTouch = Date.now();
        const a = toCard(n("x1"), n("y1"));
        const b = toCard(n("x2"), n("y2"));
        await scrollBy(a.y - b.y);
        done(204);
      } else if (url.pathname === "/reload") {
        // Fresh card and renderer now (e.g. right after a HACS update): exit,
        // Docker's restart policy starts the container again
        done(202, "restarting");
        log("reload requested - restarting");
        setTimeout(() => process.exit(0), 200);
      } else if (url.pathname === "/status") {
        done(200, JSON.stringify({
          connected,
          states: Object.keys(states).length,
          page_states: pageStates,
          pending_changes: changed.size,
          last_full_push_s: lastFullPush ? Math.round((Date.now() - lastFullPush) / 1000) : null,
        }), "application/json");
      } else if (url.pathname === "/healthz") {
        done(connected ? 200 : 503, connected ? "ok" : "not connected");
      } else {
        done(404, "not found");
      }
    } catch (e) {
      log("request failed:", e.message);
      done(500, e.message);
    }
  });
});

start()
  .then(() => server.listen(PORT, () => log(`listening on :${PORT}`)))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

/**
 * A new card in HACS, or a new renderer on GitHub (RENDERER_URL, how the
 * compose file starts it): exit, and Docker's restart policy starts the
 * container again with both. Saves restarting it by hand after each release.
 */
const checkForUpdates = async () => {
  try {
    const script = await loadCardScript(true);
    if (cardHash && hash(script) !== cardHash) {
      log("the card has changed - restarting");
      process.exit(0);
    }
    const url = process.env.RENDERER_URL;
    if (url) {
      const res = await fetch(url);
      const own = readFileSync(fileURLToPath(import.meta.url), "utf8");
      if (res.ok && hash(await res.text()) !== hash(own)) {
        log("the renderer has changed - restarting");
        process.exit(0);
      }
    }
  } catch (e) {
    log("update check failed:", e.message);
  }
};
setInterval(checkForUpdates, 10 * 60_000);

// Reload the card config now and then, so dashboard edits reach the display
setInterval(() => {
  serial(async () => {
    try {
      const config = await loadCardConfig();
      if (JSON.stringify(config) !== JSON.stringify(cardConfig)) {
        cardConfig = config;
        await resetView();
        dirty = true;
      }
    } catch (e) {
      log("config reload failed:", e.message);
    }
  });
}, 10 * 60_000);
