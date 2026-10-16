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
