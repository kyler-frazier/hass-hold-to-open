// Touches via the Chrome DevTools Protocol: Playwright's touchscreen API can only tap,
// and these tests need a finger that stays down.
import { expect } from "@playwright/test";

/** Opens a dashboard and waits for the plugin and the cards to be ready. */
export async function openDashboard(page, path) {
  // Records dialog history entries, and whether a finger was down when each was added
  await page.addInitScript(() => {
    window.__dialogPushes = [];
    const push = History.prototype.pushState;
    History.prototype.pushState = function (state, ...rest) {
      if (state?.dialog) window.__dialogPushes.push({ fingerDown: !!window.__fingerDown });
      return push.call(this, state, ...rest);
    };
  });
  await page.goto(path);
  await page.waitForFunction(() => window.__holdToOpen);
  await page.locator("hui-tile-card").first().waitFor();
  await page.waitForTimeout(500);
}

export async function finger(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y]) => ({ x, y })) });
  return {
    async down(point) {
      await page.evaluate(() => (window.__fingerDown = true));
      await send("touchStart", [point]);
    },
    move: (point) => send("touchMove", [point]),
    async up() {
      await send("touchEnd", []);
      await page.evaluate(() => (window.__fingerDown = false));
    },
    async tap(point) {
      await this.down(point);
      await page.waitForTimeout(60);
      await this.up();
    },
  };
}

/** Center of the nth tile card's body (away from its icon, which has its own actions). */
export async function tile(page, n = 0) {
  const box = await page.locator("hui-tile-card").nth(n).boundingBox();
  return [box.x + box.width * 0.65, box.y + box.height / 2];
}

export const dialogOpen = (page) =>
  page.evaluate(() => {
    let open = false;
    (function walk(root) {
      for (const el of root.querySelectorAll("*")) {
        if (el.tagName === "HA-MORE-INFO-DIALOG" && el.shadowRoot?.querySelector("[open]"))
          open = true;
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    })(document);
    return open;
  });

/** Center of the open details dialog's close (X) button. */
export const closeButton = (page) =>
  page.evaluate(() => {
    const find = (root, match) => {
      for (const el of root.querySelectorAll("*")) {
        if (match(el)) return el;
        const found = el.shadowRoot && find(el.shadowRoot, match);
        if (found) return found;
      }
    };
    const dialog = find(document, (el) => el.tagName === "HA-MORE-INFO-DIALOG");
    const r = find(
      dialog.shadowRoot,
      (el) => el.slot === "headerNavigationIcon",
    ).getBoundingClientRect();
    return [r.x + r.width / 2, r.y + r.height / 2];
  });

export const entityState = (page, id) =>
  page.evaluate((id) => document.querySelector("home-assistant").hass.states[id].state, id);

export const ghostCount = (page) =>
  page.evaluate(() => {
    let n = 0;
    (function walk(root) {
      n += root.querySelectorAll(".hold-to-open-ghost").length;
      for (const el of root.querySelectorAll("*")) if (el.shadowRoot) walk(el.shadowRoot);
    })(document);
    return n;
  });

export const dialogPushes = (page) => page.evaluate(() => window.__dialogPushes);

export async function expectDialog(page, open) {
  await expect.poll(() => dialogOpen(page)).toBe(open);
}

/** Whether the nth tile card shows its pressed state (its ripple is still held down). */
export const tilePressed = (page, n = 0) =>
  page
    .locator("hui-tile-card")
    .nth(n)
    .evaluate((card) => {
      let pressed = false;
      (function walk(root) {
        for (const el of root.querySelectorAll("*")) {
          // The class both ripple versions render while pressed
          if (
            /^(ha|md)-ripple$/.test(el.localName) &&
            el.shadowRoot?.querySelector(".surface.pressed")
          )
            pressed = true;
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      })(card.shadowRoot ?? card);
      return pressed;
    });

/** Opens an entity's details, as a card's more-info action does, and waits for them to open. */
export async function openDetails(page, entityId) {
  await page.evaluate((entityId) => {
    const ev = new Event("hass-more-info", { bubbles: true, composed: true });
    ev.detail = { entityId };
    document.querySelector("home-assistant").dispatchEvent(ev);
  }, entityId);
  await page.waitForTimeout(600); // the sheet slides up; cards move until it's done
}

// Tiles inside the open details dialog (a group's details list its members as tiles)
const detailsTiles = (page) =>
  page.evaluate(() => {
    const tiles = [];
    const dialog = [...document.querySelectorAll("*")]
      .map((el) => el.shadowRoot?.querySelector("ha-more-info-dialog"))
      .find(Boolean);
    (function walk(root) {
      for (const el of root?.querySelectorAll("*") ?? []) {
        if (el.localName === "hui-tile-card") tiles.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    })(dialog?.shadowRoot);
    window.__detailsTiles = tiles;
    return tiles.length;
  });

/** The entity whose details are showing. */
export const detailsEntity = (page) =>
  page.evaluate(() => {
    const dialog = [...document.querySelectorAll("*")]
      .map((el) => el.shadowRoot?.querySelector("ha-more-info-dialog"))
      .find(Boolean);
    return dialog?._entityId ?? null;
  });

/**
 * Gives the tiles in the details dialog a tap and a hold action, as a dashboard card would have.
 * Home Assistant's own have neither (a tap opens the member's details).
 */
export async function memberActions(page) {
  await expect.poll(() => detailsTiles(page)).toBeGreaterThan(0);
  await page.evaluate(() => {
    for (const t of window.__detailsTiles)
      t.setConfig({
        ...t._config,
        tap_action: { action: "toggle" },
        hold_action: { action: "more-info" },
      });
  });
  await page.waitForTimeout(300);
}

/** Center of the nth tile's body in the details dialog. */
export async function detailsTile(page, n = 0) {
  await detailsTiles(page);
  return page.evaluate((n) => {
    const r = window.__detailsTiles[n].getBoundingClientRect();
    return [r.x + r.width * 0.65, r.y + r.height / 2];
  }, n);
}

/** Closes the open details the way their X button or a swipe down does. */
export const closeDetails = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .map((el) => el.shadowRoot?.querySelector("ha-more-info-dialog"))
      .find(Boolean)
      .closeDialog(),
  );

/** Whether the details' content is animating (sliding in). */
export const detailsSliding = (page) =>
  page.evaluate(() => {
    const dialog = [...document.querySelectorAll("*")]
      .map((el) => el.shadowRoot?.querySelector("ha-more-info-dialog"))
      .find(Boolean);
    const content = dialog?.shadowRoot?.querySelector(".content-wrapper");
    return (content?.getAnimations() ?? []).some((a) => a.playState === "running");
  });

/** Holds the nth tile in the open details until its hold runs, then lifts the finger. */
export async function holdDetailsTile(page, n = 0) {
  const f = await finger(page);
  await f.down(await detailsTile(page, n));
  await page.waitForTimeout(800);
  await f.up();
  await page.waitForTimeout(600);
}
