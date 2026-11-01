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
    details_back: true,
    details_slide: true,
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
  const runDeferring = (el) => {
    replay();
    const { pushState, replaceState } = history;
    const open = window.open;
    const pushed = () => deferred.some(([fn]) => fn === pushState);
    history.pushState = (...args) => deferred.push([pushState, history, args, !args[0]?.dialog]);
    history.replaceState = (...args) =>
      pushed() ? deferred.push([replaceState, history, args]) : replaceState.apply(history, args);
    window.open = (...args) => (deferred.push([open, window, args]), null);
    restore = () => {
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

  // Home Assistant shows a member's details (a light in a group's) in place of the group's
  // without a history entry, so Back closes them all. Each gets an entry here, and Back returns
  // to the group instead. HA's own popstate listeners run first (they were added first), and
  // react to landing on a dialog's entry in two ways that have to be held off:
  // - they go back once more, closing the details, and
  // - they reopen the details named in the URL.
  let depth = 0; // entries added for the open details
  let ourBack = 0; // history.back() calls of ours still to arrive as popstates
  let unwinding = false; // details closed with entries left; HA goes back through them
  let returning = false; // inside our own _goBack() for a Back

  const moreInfo = () =>
    document.querySelector("home-assistant")?.shadowRoot?.querySelector("ha-more-info-dialog");

  const slide = (dialog, dir) => {
    if (!options([dialog])?.details_slide) return;
    // The content itself is re-created for the new entity; its wrapper stays
    dialog.updateComplete?.then(() =>
      dialog.shadowRoot?.querySelector(".content-wrapper")?.animate(
        [
          { transform: `translateX(${dir * 32}px)`, opacity: 0 },
          { transform: "none", opacity: 1 },
        ],
        { duration: 220, easing: "cubic-bezier(.2,.6,.3,1)" },
      ),
    );
  };

  // A Back that returns from a member's details, or that comes from our own history.back()
  const ours = () => {
    const dialog = moreInfo();
    return ourBack > 0 || (depth > 0 && dialog?._open && dialog._parentEntityIds?.length > 0);
  };

  const { back } = history;
  history.back = function (...args) {
    // window.event is the popstate when HA's listener calls this on landing on a dialog's entry
    if (window.event?.type === "popstate" && ours()) return;
    return back.apply(this, args);
  };

  window.addEventListener(
    "hass-more-info",
    (e) => {
      const dialog = moreInfo();
      if (e.detail?.fromUrl) {
        // HA reopening details from the URL of an entry it landed on
        const current = new URLSearchParams(location.search).get("more-info-entity-id");
        const shown = dialog?._open && dialog._entityId === e.detail.entityId;
        if (unwinding || shown || current !== e.detail.entityId) e.stopImmediatePropagation();
        return;
      }
      const id = e.detail?.entityId;
      if (!e.composedPath().includes(dialog) || !dialog._open) return;
      if (!Array.isArray(dialog._parentEntityIds) || !id || id === dialog._entityId) return;
      if (!history.state?.dialog) return;
      if (options([dialog])?.details_back) {
        // Before HA handles it, so HA's URL update lands on the new entry. Held back with the
        // rest until the finger lifts, during a hold.
        history.pushState({ ...history.state }, "", location.href);
        depth++;
      }
      slide(dialog, 1);
    },
    { capture: true },
  );

  window.addEventListener("popstate", (e) => {
    if (ourBack > 0) {
      ourBack--;
      return;
    }
    if (unwinding) {
      unwinding = !!e.state?.dialog;
      return;
    }
    if (!depth) return;
    const dialog = moreInfo();
    if (dialog?._open && dialog._parentEntityIds?.length) {
      depth--;
      returning = true;
      try {
        dialog._goBack();
      } finally {
        returning = false;
      }
      slide(dialog, -1);
    }
  });

  window.addEventListener("dialog-closed", (e) => {
    if (e.detail?.dialog !== "ha-more-info-dialog" || !depth) return;
    depth = 0;
    unwinding = true;
  });

  // The dialog's back arrow returns to the group without going back in history
  customElements.whenDefined("ha-more-info-dialog").then(() => {
    const proto = customElements.get("ha-more-info-dialog").prototype;
    const goBack = proto._goBack;
    if (typeof goBack !== "function") return;
    proto._goBack = function (...args) {
      const before = this._parentEntityIds?.length ?? 0;
      const result = goBack.apply(this, args);
      if (!returning && depth && (this._parentEntityIds?.length ?? 0) < before) {
        depth--;
        ourBack++;
        back.call(history);
        slide(this, -1);
      }
      return result;
    };
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
