/**
 * Hold to Open for Home Assistant (MIT)
 * https://github.com/kyler-frazier/hass-hold-to-open
 */

const VERSION = "0.0.0-dev"; // replaced by the release workflow

(() => {
  if (window.__holdToOpen) return; // e.g. added as a resource twice
  window.__holdToOpen = VERSION;

  console.info(
    `%c HOLD-TO-OPEN %c ${VERSION} `,
    "color: #fff; background: #03a9f4; font-weight: 700;",
    "color: #03a9f4; background: #fff; font-weight: 700;",
  );

  const CONFIG_KEY = "hold_to_open";
  const DEFAULTS = {
    enable: true,
    hold_time: 500, // ms; Home Assistant's own default
    ghost: true,
    ghost_opacity: 0.35,
    ghost_scale: 1.18,
    ghost_duration: 450, // ms
  };
  const OPEN_DELAY_MS = 40; // let the ghost start before the dialog covers the card

  let pending = null; // { timer }
  let fired = false; // swallow the release that follows a hold we fired
  let deferred = []; // [method, args] history calls made while the finger was down
  let restoreHistory = null;

  // Home Assistant's shared hold timer. Its `held`, `cancelled` and `holdTime` fields are
  // internal, so everything below degrades to HA's normal behavior if they change.
  const handler = () => document.body.querySelector("action-handler");

  const options = (path) => {
    const panel = path.find((n) => n.tagName === "HA-PANEL-LOVELACE");
    if (!panel) return null; // only dashboards; dialogs and settings pages keep HA's behavior
    const raw = panel.lovelace?.config?.[CONFIG_KEY];
    const opt = { ...DEFAULTS, ...(raw && typeof raw === "object" ? raw : {}) };
    return opt.enable === false ? null : opt;
  };

  // A live copy of the card swells and fades out over the original, so the hold feels
  // acknowledged. It goes next to the card so the dashboard's theme applies to it.
  const ghost = (el, opt) => {
    let card = null;
    for (let n = el; n; n = n.parentNode || n.host) {
      if (n.setConfig && n._config && n.localName.endsWith("-card")) {
        card = n;
        break;
      }
    }
    if (!card?.parentNode) return;
    const r = card.getBoundingClientRect();
    const wrap = document.createElement("div");
    wrap.className = "hold-to-open-ghost";
    wrap.style.cssText = `position:fixed;z-index:8;pointer-events:none;left:${r.left}px;
      top:${r.top}px;width:${r.width}px;height:${r.height}px`;
    try {
      const copy = document.createElement(card.localName);
      copy.hass = card.hass;
      copy.setConfig(card._config);
      wrap.append(copy);
    } catch {
      return; // not every custom card can be copied; skip the effect rather than break the hold
    }
    card.parentNode.append(wrap);
    wrap
      .animate(
        [
          { opacity: opt.ghost_opacity, scale: "1" },
          { opacity: 0, scale: String(opt.ghost_scale) },
        ],
        { duration: opt.ghost_duration, easing: "cubic-bezier(.2,.6,.3,1)" },
      )
      .finished.finally(() => wrap.remove());
  };

  // Android skips history entries that a page adds without a user interaction, and a
  // finger that's still down doesn't count until it lifts. Opening the dialog adds the
  // entry Back uses to close it, so hold that entry back until the finger lifts. HA then
  // sets the dialog's URL with replaceState, which would land on the dashboard's entry
  // instead (so closing with X reopens the dialog), so hold those back too.
  const openDeferringHistory = (el) => {
    flushHistory();
    const { pushState, replaceState } = history;
    history.pushState = (...args) => deferred.push(["pushState", args]);
    history.replaceState = (...args) =>
      deferred.length ? deferred.push(["replaceState", args]) : replaceState.apply(history, args);
    restoreHistory = () => {
      history.pushState = pushState;
      history.replaceState = replaceState;
      restoreHistory = null;
    };
    try {
      const ev = new Event("action", { bubbles: true, composed: true }); // HA's fireEvent shape
      ev.detail = { action: "hold" };
      el.dispatchEvent(ev);
    } finally {
      // HA pushes synchronously when opening a dialog; give async paths a moment too
      setTimeout(() => deferred.length || restoreHistory?.(), 50);
    }
  };

  const flushHistory = () => {
    restoreHistory?.();
    for (const [method, args] of deferred) History.prototype[method].apply(history, args);
    deferred = [];
  };

  let baseHoldTime = null;

  window.addEventListener(
    "touchstart",
    (e) => {
      clearTimeout(pending?.timer);
      pending = null;
      fired = false;
      const ah = handler();
      if (!ah) return;
      baseHoldTime ??= ah.holdTime;
      ah.holdTime = baseHoldTime; // undo another dashboard's hold_time
      if (e.touches.length !== 1) return;
      const path = e.composedPath();
      const opt = options(path);
      const el = path.find((n) => n.actionHandler?.options?.hasHold);
      if (!opt || !el) return;
      // Runs before HA's own touchstart listener, which reads holdTime
      ah.holdTime = opt.hold_time;
      // Just after HA's timer, so its `held` flag tells us the hold wasn't cancelled
      const timer = setTimeout(() => {
        if (!ah.held || ah.cancelled) return;
        fired = true;
        ah._stopAnimation?.();
        if (opt.ghost) ghost(el, opt);
        setTimeout(() => openDeferringHistory(el), opt.ghost ? OPEN_DELAY_MS : 0);
      }, opt.hold_time + 20);
      pending = { timer };
    },
    { capture: true, passive: true },
  );

  const release = (e) => {
    clearTimeout(pending?.timer);
    if (!fired) return;
    fired = false;
    e.preventDefault(); // stops the release counting as a tap, and the follow-up click
    e.stopPropagation();
    setTimeout(flushHistory, OPEN_DELAY_MS + 60); // after the dialog has opened
  };
  window.addEventListener("touchend", release, { capture: true });
  window.addEventListener("touchcancel", release, { capture: true });
})();
