// The Home Assistant internals the plugin relies on, checked one by one, so a frontend change
// that breaks it fails here with a message naming what changed instead of as a timeout elsewhere.
import { expect, test } from "@playwright/test";
import { finger, openDashboard, openDetails, tile } from "./helpers/ha.mjs";

const changed = (what) => `Home Assistant changed: ${what}`;

test.beforeEach(async ({ page }) => {
  await openDashboard(page, "/test-default/test");
});

test("the shared hold handler", async ({ page }) => {
  const f = await finger(page);
  await f.down(await tile(page));
  await page.waitForTimeout(700);
  const ah = await page.evaluate(() => {
    const ah = document.body.querySelector("action-handler");
    return ah && { holdTime: ah.holdTime, held: ah.held, cancelled: ah.cancelled };
  });
  await f.up();
  expect(ah, changed("no <action-handler> in document.body")).toBeTruthy();
  expect(typeof ah.holdTime, changed("action-handler has no numeric holdTime")).toBe("number");
  expect(ah.held, changed("action-handler doesn't set held during a hold")).toBe(true);
  expect(ah.cancelled, changed("action-handler has no cancelled flag")).toBe(false);
});

test("cards with a hold action", async ({ page }) => {
  const card = await page
    .locator("hui-tile-card")
    .first()
    .evaluate((card) => {
      const nodes = [];
      (function walk(root) {
        for (const el of root.querySelectorAll("*")) {
          nodes.push(el);
          if (el.shadowRoot) walk(el.shadowRoot);
        }
      })(card.shadowRoot ?? card);
      return {
        hasHold: nodes.some((n) => n.actionHandler?.options?.hasHold),
        ripples: nodes
          .filter((n) => /^(ha|md)-ripple$/.test(n.localName))
          .map((r) => !!r.control?.dispatchEvent),
        config: !!card._config && typeof card.setConfig === "function",
      };
    });
  expect(card.hasHold, changed("no element with actionHandler.options.hasHold")).toBe(true);
  expect(card.ripples.length, changed("cards have no ha-ripple or md-ripple")).toBeGreaterThan(0);
  expect(card.ripples, changed("ripples have no control element")).not.toContain(false);
  expect(card.config, changed("cards have no _config and setConfig")).toBe(true);
});

test("a card's hold action runs on HA's action event", async ({ page }) => {
  await page
    .locator("hui-tile-card")
    .first()
    .evaluate((card) => {
      const ev = new Event("action", { bubbles: true, composed: true });
      ev.detail = { action: "hold" };
      (function find(root) {
        for (const n of root.querySelectorAll("*")) {
          if (n.actionHandler?.options?.hasHold) return n.dispatchEvent(ev);
          if (n.shadowRoot && find(n.shadowRoot)) return true;
        }
      })(card.shadowRoot ?? card);
    });
  const open = () =>
    page.evaluate(
      () =>
        !!document.querySelector("home-assistant").shadowRoot.querySelector("ha-more-info-dialog")
          ?._open,
    );
  await expect.poll(open, { message: changed("an action event no longer runs hold") }).toBe(true);
});

test("the dashboard and its config", async ({ page }) => {
  const config = await page.evaluate(
    () =>
      document
        .querySelector("home-assistant")
        ?.shadowRoot?.querySelector("home-assistant-main")
        ?.shadowRoot?.querySelector("ha-panel-lovelace")?.lovelace?.config,
  );
  expect(
    config,
    changed("no ha-panel-lovelace with lovelace.config under home-assistant-main"),
  ).toBeTruthy();
});

test("the details dialog", async ({ page }) => {
  await openDetails(page, "light.lamps");
  const d = await page.evaluate(() => {
    const d = document
      .querySelector("home-assistant")
      .shadowRoot.querySelector("ha-more-info-dialog");
    return (
      d && {
        open: d._open,
        entityId: d._entityId,
        methods: ["showDialog", "closeDialog"].filter((m) => typeof d[m] !== "function"),
        hass: !!d.hass,
        state: history.state?.dialog,
      }
    );
  });
  expect(d, changed("no ha-more-info-dialog in home-assistant's shadow root")).toBeTruthy();
  expect(d.open, changed("ha-more-info-dialog has no _open")).toBe(true);
  expect(d.entityId, changed("ha-more-info-dialog has no _entityId")).toBe("light.lamps");
  expect(d.methods, changed("ha-more-info-dialog lacks these methods")).toEqual([]);
  expect(d.hass, changed("ha-more-info-dialog has no hass")).toBe(true);
  expect(d.state, changed("a dialog's history entry has no { dialog } state")).toBe(
    "ha-more-info-dialog",
  );
});

test("closing details fires dialog-closed", async ({ page }) => {
  await openDetails(page, "light.lamps");
  const detail = await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.addEventListener("dialog-closed", (e) => resolve(e.detail), { once: true });
        document
          .querySelector("home-assistant")
          .shadowRoot.querySelector("ha-more-info-dialog")
          .closeDialog();
        setTimeout(() => resolve(null), 3000);
      }),
  );
  expect(detail?.dialog, changed("closing details no longer fires dialog-closed")).toBe(
    "ha-more-info-dialog",
  );
});

test("HA opens details named in the URL with fromUrl", async ({ page }) => {
  await page.addInitScript(() => {
    window.__fromUrl = [];
    window.addEventListener(
      "hass-more-info",
      (e) => e.detail?.fromUrl && window.__fromUrl.push(e.detail.entityId),
      { capture: true },
    );
  });
  await page.goto("/test-default/test?more-info-entity-id=light.lamps");
  await expect
    .poll(() => page.evaluate(() => window.__fromUrl), {
      message: changed("a details URL no longer fires hass-more-info with fromUrl"),
    })
    .toContain("light.lamps");
});
