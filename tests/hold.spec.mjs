import { expect, test } from "@playwright/test";
import {
  dialogOpen,
  dialogPushes,
  entityState,
  expectDialog,
  finger,
  ghostCount,
  openDashboard,
  tile,
} from "./helpers/ha.mjs";

test.describe("default options", () => {
  test.beforeEach(({ page }) => openDashboard(page, "/test-default/test"));

  test("holding opens the details before the finger lifts", async ({ page }) => {
    const f = await finger(page);
    await f.down(await tile(page));
    await page.waitForTimeout(800);
    expect(await dialogOpen(page)).toBe(true);
    await f.up();
  });

  test("lifting the finger after a hold doesn't also count as a tap", async ({ page }) => {
    const before = await entityState(page, "input_boolean.lamp");
    const f = await finger(page);
    await f.down(await tile(page));
    await page.waitForTimeout(800);
    await f.up();
    await page.waitForTimeout(600);
    expect(await dialogOpen(page)).toBe(true);
    expect(await entityState(page, "input_boolean.lamp")).toBe(before);
  });

  test("a tap still runs the tap action", async ({ page }) => {
    const before = await entityState(page, "input_boolean.lamp");
    const f = await finger(page);
    await f.tap(await tile(page));
    await expect.poll(() => entityState(page, "input_boolean.lamp")).not.toBe(before);
    expect(await dialogOpen(page)).toBe(false);
  });

  test("moving the finger cancels the hold", async ({ page }) => {
    const before = await entityState(page, "input_boolean.lamp");
    const [x, y] = await tile(page);
    const f = await finger(page);
    await f.down([x, y]);
    for (let i = 1; i <= 3; i++) await f.move([x, y + 10 * i]);
    await page.waitForTimeout(800);
    expect(await dialogOpen(page)).toBe(false);
    await f.up();
    await page.waitForTimeout(600);
    expect(await dialogOpen(page)).toBe(false);
    expect(await entityState(page, "input_boolean.lamp")).toBe(before);
  });

  test("Back closes the details, with the history entry added after the finger lifts", async ({
    page,
  }) => {
    const url = page.url();
    const f = await finger(page);
    await f.down(await tile(page));
    await page.waitForTimeout(800);
    await f.up();
    await page.waitForTimeout(600);
    expect(await dialogPushes(page)).toEqual([{ fingerDown: false }]);
    await page.evaluate(() => history.back());
    await expectDialog(page, false);
    expect(page.url()).toBe(url);
  });

  test("a ghost of the card appears, then cleans itself up", async ({ page }) => {
    const f = await finger(page);
    await f.down(await tile(page));
    await expect.poll(() => ghostCount(page), { intervals: [50] }).toBe(1);
    await f.up();
    await expect.poll(() => ghostCount(page)).toBe(0);
  });

  test("cards without a hold action are left alone", async ({ page }) => {
    const f = await finger(page);
    await f.down(await tile(page, 1));
    await page.waitForTimeout(800);
    expect(await dialogOpen(page)).toBe(false);
    expect(await ghostCount(page)).toBe(0);
    await f.up();
  });

  test("uses Home Assistant's hold time by default", async ({ page }) => {
    const f = await finger(page);
    await f.down(await tile(page));
    await page.waitForTimeout(380);
    expect(await dialogOpen(page)).toBe(false);
    await f.up();
  });
});

test("hold_time and ghost options", async ({ page }) => {
  await openDashboard(page, "/test-custom/test");
  const f = await finger(page);
  await f.down(await tile(page));
  await expectDialog(page, true);
  expect(await ghostCount(page)).toBe(0);
  await f.up();
});

test("enable: false keeps Home Assistant's open-on-release behavior", async ({ page }) => {
  await openDashboard(page, "/test-disabled/test");
  const f = await finger(page);
  await f.down(await tile(page));
  await page.waitForTimeout(800);
  expect(await dialogOpen(page)).toBe(false);
  await f.up();
  await expectDialog(page, true);
});
