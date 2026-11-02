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
    stack_details: true,
  };
  const OPEN_DELAY_MS = 40; // let the ghost start before the dialog covers the card

  let pending = null; // { timer }
  let fired = false; // swallow the release that follows a hold we fired
  let deferred = []; // [fn, this, args, navigates] calls made while the finger was down
  let restore = null;
  let pointerId = null; // of the touch that's down, for unpress()

  // Home Assistant's shared hold timer. Its `held`, `cancelled` and `holdTime` fields are
  // internal, so everything below degrades to HA's normal behavior if they change.
  const handler = () => document.body.querySelector("action-handler");

  // Details opened over a dashboard count as part of it. Other dialogs, and details opened
  // anywhere else, keep HA's behavior.
  const dashboard = (path) => {
    const panel = path.find((n) => n.tagName === "HA-PANEL-LOVELACE");
    if (panel || !path.some((n) => n.tagName === "HA-MORE-INFO-DIALOG")) return panel;
    return document
      .querySelector("home-assistant")
      ?.shadowRoot?.querySelector("home-assistant-main")
      ?.shadowRoot?.querySelector("ha-panel-lovelace");
  };

  const options = (path) => {
    const panel = dashboard(path);
    if (!panel) return null;
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
    // In details, the card can be gone a moment later (a member's details replace the group's),
    // so the ghost goes in the dialog's root instead, as a popover to show above the dialog
    let dialog = null;
    for (let n = card; n && !dialog; n = n.parentNode || n.host) {
      if (n.localName === "ha-more-info-dialog") dialog = n;
    }
    if (dialog?.shadowRoot && wrap.showPopover) {
      wrap.popover = "manual";
      wrap.style.cssText = `inset:auto;margin:0;border:0;padding:0;background:none;
        overflow:visible;${wrap.style.cssText}`;
      dialog.shadowRoot.append(wrap);
      wrap.showPopover();
    } else {
      card.parentNode.append(wrap);
    }
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

  // A finger that's still down doesn't count as a user interaction until it lifts, and
  // Android skips history entries added without one, so Back would leave the app instead of
  // closing the dialog. Popups are blocked without one too. So the history entries and
  // popups an action makes are held back and replayed when the finger lifts:
  // - pushState, for a dialog's entry or a navigate action.
  // - replaceState after a held push. HA uses it to set the dialog's URL, and it would
  //   otherwise land on the dashboard's entry (so closing with X reopens the dialog).
  // - window.open, for a url action.
  const historyState = Object.getOwnPropertyDescriptor(History.prototype, "state").get;
  const runDeferring = (el) => {
    replay();
    const { pushState, replaceState } = history;
    const open = window.open;
    const pushed = () => deferred.some(([fn]) => fn === pushState);
    // HA reads history.state right after pushing, to keep it when it replaces the URL, so it
    // has to see the state of the push that's held back, not the dashboard's
    let held = null;
    history.pushState = (...args) => {
      held = { state: args[0] ?? null };
      deferred.push([pushState, history, args, !args[0]?.dialog]);
    };
    history.replaceState = (...args) => {
      if (!pushed()) return replaceState.apply(history, args);
      held = { state: args[0] ?? null };
      deferred.push([replaceState, history, args]);
    };
    Object.defineProperty(history, "state", {
      configurable: true,
      get: () => (held ? held.state : historyState.call(history)),
    });
    window.open = (...args) => (deferred.push([open, window, args]), null);
    restore = () => {
      delete history.state;
      Object.assign(history, { pushState, replaceState });
      window.open = open;
      restore = null;
    };
    try {
      const ev = new Event("action", { bubbles: true, composed: true }); // HA's fireEvent shape
      ev.detail = { action: "hold" };
      el.dispatchEvent(ev);
    } finally {
      // HA acts synchronously; give async paths a moment too
      setTimeout(() => deferred.length || restore?.(), 50);
    }
  };

  const replay = () => {
    restore?.();
    let navigated = false;
    for (const [fn, self, args, navigates] of deferred) {
      fn.apply(self, args);
      navigated ||= navigates;
    }
    deferred = [];
    // HA's navigate told the router to read the URL before the URL had changed
    if (navigated) {
      const ev = new Event("location-changed", { bubbles: true, composed: true });
      ev.detail = { replace: false };
      window.dispatchEvent(ev);
    }
  };

  // Swallowing the release also swallows the click that a card's ripple waits for after a
  // touch, so the card would stay pressed. A pointercancel ends the press the ripple's own way.
  const unpress = (path) => {
    for (const n of path) {
      for (const root of [n, n.shadowRoot]) {
        for (const r of root?.querySelectorAll?.("ha-ripple, md-ripple") ?? []) {
          // Not every HA version exposes whether a ripple is pressed; one at rest stays at rest
          const ev = new PointerEvent("pointercancel", {
            pointerId,
            isPrimary: true,
            pointerType: "touch",
          });
          r.control?.dispatchEvent(ev);
        }
      }
    }
  };

  // Home Assistant shows a member's details (a light in a group's) in place of the group's,
  // with no history entry and no transition, so Back closes them all. Instead, they open in a
  // second details dialog stacked on top, with its own history entry: it slides up over the
  // group's, and Back, X or a swipe slide it away with the group's still underneath.
  //
  // HA's popstate listeners were added before the plugin's, so they can't be pre-empted. On
  // landing on a dialog's entry they go back once more (closing the group's details too) and
  // reopen the details named in the URL; both are held off while a stacked dialog is involved.
  const stack = []; // stacked details dialogs, newest last
  let ourBack = 0; // history.back() calls of ours still to arrive as popstates

  const home = () => document.querySelector("home-assistant");
  const moreInfo = () => home()?.shadowRoot?.querySelector("ha-more-info-dialog");

  const { back } = history;
  history.back = function (...args) {
    // window.event is the popstate when HA's listener calls this on landing on a dialog's entry
    if (window.event?.type === "popstate" && (ourBack > 0 || stack.length > 0)) return;
    return back.apply(this, args);
  };

  // Dialogs HA opens itself get each hass update; a stacked one has to be kept up to date
  const keepHass = () => {
    if (!stack.length) return;
    const hass = home()?.hass;
    for (const d of stack) if (hass && d.hass !== hass) d.hass = hass;
    requestAnimationFrame(keepHass);
  };

  // Dialogs closing for us leave the stack at once, so HA's own going back isn't held off
  const dismiss = (dialog) => {
    stack.splice(stack.indexOf(dialog), 1);
    dialog.__holdToOpenByBack = true;
    dialog.closeDialog();
  };
  const closed = (dialog) => {
    if (stack.includes(dialog)) stack.splice(stack.indexOf(dialog), 1);
    dialog.remove();
    if (dialog.__holdToOpenByBack) return;
    // Closed with X or a swipe: drop its history entry too
    ourBack++;
    back.call(history);
  };

  const openStacked = (entityId, view) => {
    const ha = home();
    const dialog = document.createElement("ha-more-info-dialog");
    dialog.hass = ha.hass;
    // Kept from HA's dialog manager, which would take it for the group's details closing
    dialog.addEventListener("dialog-closed", (e) => {
      e.stopImmediatePropagation();
      closed(dialog);
    });
    ha.shadowRoot.append(dialog);
    stack.push(dialog);
    if (stack.length === 1) requestAnimationFrame(keepHass);
    dialog.showDialog({ entityId, view });
    // Held back with the rest until the finger lifts, during a hold
    history.pushState({ ...history.state }, "", location.href);
  };

  window.addEventListener(
    "hass-more-info",
    (e) => {
      if (e.detail?.fromUrl) {
        // HA reopening details from the URL of an entry it landed on: the group's, which are
        // already open underneath, or a stale one
        const current = new URLSearchParams(location.search).get("more-info-entity-id");
        const shown = moreInfo()?._open && moreInfo()._entityId === e.detail.entityId;
        if (stack.length || ourBack || shown || current !== e.detail.entityId)
          e.stopImmediatePropagation();
        return;
      }
      const from = e.composedPath().find((n) => n.localName === "ha-more-info-dialog");
      const id = e.detail?.entityId;
      if (!from?._open || !id || id === from._entityId) return;
      if (!options([from])?.stack_details || !history.state?.dialog) return;
      e.stopImmediatePropagation(); // so the group's dialog doesn't swap its content
      openStacked(id, e.detail.view);
    },
    { capture: true },
  );

  window.addEventListener("popstate", () => {
    if (ourBack > 0) {
      ourBack--;
      return;
    }
    if (stack.length) dismiss(stack.at(-1));
  });

  // The group's details closing some other way (say, navigating elsewhere) takes the rest along
  window.addEventListener("dialog-closed", (e) => {
    if (e.detail?.dialog !== "ha-more-info-dialog") return;
    for (const d of [...stack]) dismiss(d);
  });

  let baseHoldTime = null;

  window.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "touch" && e.isPrimary) pointerId = e.pointerId;
    },
    { capture: true, passive: true },
  );

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
      // A touch's events keep going to the element first touched, and stop reaching window if a
      // hold removes it (a member's details replace the group's)
      for (const type of ["touchend", "touchcancel"])
        path[0].addEventListener(type, release, { capture: true, once: true });
      // Runs before HA's own touchstart listener, which reads holdTime
      ah.holdTime = opt.hold_time;
      // Just after HA's timer, so its `held` flag tells us the hold wasn't cancelled
      const timer = setTimeout(() => {
        if (!ah.held || ah.cancelled) return;
        fired = true;
        ah._stopAnimation?.();
        if (opt.ghost) ghost(el, opt);
        setTimeout(() => runDeferring(el), opt.ghost ? OPEN_DELAY_MS : 0);
      }, opt.hold_time + 20);
      pending = { timer, path: path.slice(0, path.indexOf(el) + 1) };
    },
    { capture: true, passive: true },
  );

  const release = (e) => {
    clearTimeout(pending?.timer);
    if (!fired) return;
    fired = false;
    e.preventDefault(); // stops the release counting as a tap, and the follow-up click
    e.stopPropagation();
    unpress(pending?.path ?? []);
    setTimeout(replay, OPEN_DELAY_MS + 60); // after the dialog has opened
  };
  window.addEventListener("touchend", release, { capture: true });
  window.addEventListener("touchcancel", release, { capture: true });
})();
