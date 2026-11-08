import { expect, test } from "@playwright/test";
import {
  closeButton,
  closeDetails,
  detailsEntity,
  detailsSliding,
  detailsTile,
  dialogOpen,
  dialogPushes,
  entityState,
  expectDialog,
  finger,
  ghostCount,
  holdDetailsTile,
  memberActions,
  openDialogs,
  openDashboard,
  openDetails,
  tile,
  tilePressed,
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

  test("the X button closes the details for good", async ({ page }) => {
    const url = page.url();
    const f = await finger(page);
    await f.down(await tile(page));
    await page.waitForTimeout(800);
    await f.up();
    await page.waitForTimeout(600);
    await f.tap(await closeButton(page));
    await page.waitForTimeout(1000); // the bug reopened the details a moment after closing
    expect(await dialogOpen(page)).toBe(false);
    expect(page.url()).toBe(url);
  });

  test("the card doesn't stay pressed after a hold", async ({ page }) => {
    const f = await finger(page);
    await f.down(await tile(page));
    await page.waitForTimeout(800);
    expect(await tilePressed(page)).toBe(true); // the press shows while the finger is down
    await f.up();
    await expect.poll(() => tilePressed(page)).toBe(false);
    await page.waitForTimeout(600); // let the details finish opening
    await f.tap(await closeButton(page));
    await expectDialog(page, false);
    expect(await tilePressed(page)).toBe(false);
  });

  test("a navigate hold action goes to its page when the finger lifts", async ({ page }) => {
    const f = await finger(page);
    await f.down(await tile(page, 2));
    await page.waitForTimeout(800);
    await f.up();
    await expect(page.getByText("Other view")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/test-default/other");
  });

  for (const [action, n, entity] of [
    ["toggle", 3, "input_boolean.fan"],
    ["perform-action", 5, "input_boolean.lamp"],
  ]) {
    test(`a ${action} hold action runs once, before the finger lifts`, async ({ page }) => {
      const before = await entityState(page, entity);
      const f = await finger(page);
      await f.down(await tile(page, n));
      await expect.poll(() => entityState(page, entity)).not.toBe(before);
      const during = await entityState(page, entity);
      await f.up();
      await page.waitForTimeout(600);
      expect(await entityState(page, entity)).toBe(during);
    });
  }

  test("a url hold action opens its link when the finger lifts", async ({ page }) => {
    // Popups need a user interaction, which a finger that's still down isn't yet
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (url) => window.__opened.push({ url, fingerDown: window.__fingerDown });
    });
    const f = await finger(page);
    await f.down(await tile(page, 4));
    await page.waitForTimeout(800);
    await f.up();
    await expect
      .poll(() => page.evaluate(() => window.__opened))
      .toEqual([{ url: "https://example.com/", fingerDown: false }]);
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

test.describe("details opened over a dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await openDashboard(page, "/test-default/test");
    await openDetails(page, "light.lamps");
    await memberActions(page);
  });

  test("holding a card opens its details before the finger lifts", async ({ page }) => {
    const before = await entityState(page, "input_boolean.lamp");
    const f = await finger(page);
    await f.down(await detailsTile(page));
    await expect.poll(() => ghostCount(page), { intervals: [50] }).toBe(1);
    await expect.poll(() => detailsEntity(page), { intervals: [50] }).toBe("light.lamp_light");
    expect(await ghostCount(page)).toBe(1); // outlives the card it copies
    await f.up();
    await page.waitForTimeout(600);
    expect(await detailsEntity(page)).toBe("light.lamp_light");
    expect(await entityState(page, "input_boolean.lamp")).toBe(before);
  });

  test("a tap still runs the tap action", async ({ page }) => {
    const before = await entityState(page, "input_boolean.lamp");
    const f = await finger(page);
    await f.tap(await detailsTile(page));
    await expect.poll(() => entityState(page, "input_boolean.lamp")).not.toBe(before);
    expect(await detailsEntity(page)).toBe("light.lamps");
  });
  test("a member's details open on top of the group's, which stays open", async ({ page }) => {
    const f = await finger(page);
    await f.down(await detailsTile(page));
    await expect.poll(() => detailsSliding(page, 1), { intervals: [20] }).toBe("up");
    expect(await detailsSliding(page, 0)).toBe(null);
    await f.up();
    await page.waitForTimeout(600);
    expect(await openDialogs(page)).toBe(2);
    expect(await detailsEntity(page)).toBe("light.lamp_light");
  });

  test("Back from a member's details returns to the group, then closes", async ({ page }) => {
    const url = page.url().split("?")[0];
    await holdDetailsTile(page);
    await page.evaluate(() => history.back());
    await expect.poll(() => detailsSliding(page, 1), { intervals: [20] }).toBe("down");
    expect(await detailsSliding(page, 0)).toBe(null); // the group's stay put underneath
    await expect.poll(() => openDialogs(page)).toBe(1);
    expect(await detailsEntity(page)).toBe("light.lamps");
    await page.waitForTimeout(600);
    expect(await openDialogs(page)).toBe(1);
    await page.evaluate(() => history.back());
    await expectDialog(page, false);
    await page.waitForTimeout(1000); // a leftover entry would reopen the details
    expect(await dialogOpen(page)).toBe(false);
    expect(page.url()).toBe(url);
  });

  test("the X or a swipe down returns to the group, and Back then closes", async ({ page }) => {
    const url = page.url().split("?")[0];
    await holdDetailsTile(page);
    const f = await finger(page);
    await f.tap(await closeButton(page));
    await expect.poll(() => openDialogs(page)).toBe(1);
    await page.waitForTimeout(600);
    await holdDetailsTile(page);
    await closeDetails(page); // a swipe down
    await expect.poll(() => openDialogs(page)).toBe(1);
    expect(await detailsEntity(page)).toBe("light.lamps");
    await page.waitForTimeout(600);
    expect(await openDialogs(page)).toBe(1);
    await page.evaluate(() => history.back());
    await expectDialog(page, false);
    await page.waitForTimeout(1000);
    expect(await dialogOpen(page)).toBe(false);
    expect(page.url()).toBe(url);
  });

  test("closing the group's details closes its member's too", async ({ page }) => {
    const url = page.url().split("?")[0];
    await holdDetailsTile(page);
    await page.evaluate(() => window.__dialogs()[0].closeDialog());
    await expectDialog(page, false);
    await page.waitForTimeout(1000);
    expect(await dialogOpen(page)).toBe(false);
    expect(page.url()).toBe(url);
  });

  test("details stack more than one deep", async ({ page }) => {
    await holdDetailsTile(page);
    // As a link inside the member's details would
    await page.evaluate(() => {
      const ev = new Event("hass-more-info", { bubbles: true, composed: true });
      ev.detail = { entityId: "input_boolean.fan" };
      window.__topDialog().shadowRoot.firstElementChild.dispatchEvent(ev);
    });
    await page.waitForTimeout(600);
    expect(await openDialogs(page)).toBe(3);
    await page.evaluate(() => history.back());
    await expect.poll(() => detailsEntity(page)).toBe("light.lamp_light");
    await page.evaluate(() => history.back());
    await expect.poll(() => detailsEntity(page)).toBe("light.lamps");
    expect(await openDialogs(page)).toBe(1);
  });

  test("Forward after Back reopens a member's details", async ({ page }) => {
    const url = page.url().split("?")[0];
    await holdDetailsTile(page);
    await page.evaluate(() => history.back());
    await expect.poll(() => openDialogs(page)).toBe(1);
    await page.waitForTimeout(600);
    await page.evaluate(() => history.forward());
    await expect.poll(() => openDialogs(page)).toBe(2);
    expect(await detailsEntity(page)).toBe("light.lamp_light");
    await page.waitForTimeout(1000); // HA going back off the entry would close them again
    expect(await openDialogs(page)).toBe(2);
    await page.evaluate(() => history.back());
    await expect.poll(() => openDialogs(page)).toBe(1);
    await page.evaluate(() => history.back());
    await expectDialog(page, false);
    await page.waitForTimeout(1000);
    expect(await dialogOpen(page)).toBe(false);
    expect(page.url()).toBe(url);
  });

  test("history jumps of more than one entry match the stack to the entry", async ({ page }) => {
    const url = page.url().split("?")[0];
    await holdDetailsTile(page);
    await page.evaluate(() => {
      const ev = new Event("hass-more-info", { bubbles: true, composed: true });
      ev.detail = { entityId: "input_boolean.fan" };
      window.__topDialog().shadowRoot.firstElementChild.dispatchEvent(ev);
    });
    await page.waitForTimeout(600);
    expect(await openDialogs(page)).toBe(3);
    await page.evaluate(() => history.go(-2));
    await expect.poll(() => openDialogs(page)).toBe(1);
    expect(await detailsEntity(page)).toBe("light.lamps");
    await page.waitForTimeout(1000);
    expect(await openDialogs(page)).toBe(1);
    await page.evaluate(() => history.go(2));
    await expect.poll(() => openDialogs(page)).toBe(3);
    expect(await detailsEntity(page)).toBe("input_boolean.fan");
    await page.waitForTimeout(600);
    await page.evaluate(() => history.go(-3));
    await expectDialog(page, false);
    await page.waitForTimeout(1000);
    expect(await dialogOpen(page)).toBe(false);
    expect(page.url()).toBe(url);
  });
});

test("details opened by a hold keep their history entry's state", async ({ page }) => {
  await openDashboard(page, "/test-default/test");
  const f = await finger(page);
  await f.down(await tile(page));
  await page.waitForTimeout(800);
  await f.up();
  await page.waitForTimeout(600);
  // HA replaces the URL right after pushing, keeping the state it reads back
  expect(await page.evaluate(() => history.state?.dialog)).toBe("ha-more-info-dialog");
});

test("Back returns to a group whose details were opened by a hold", async ({ page }) => {
  await openDashboard(page, "/test-default/test");
  const f = await finger(page);
  await f.down(await tile(page, 6)); // the light group
  await page.waitForTimeout(800);
  await f.up();
  await page.waitForTimeout(600);
  await memberActions(page);
  await holdDetailsTile(page);
  expect(await detailsEntity(page)).toBe("light.lamp_light");
  await page.evaluate(() => history.back());
  await expect.poll(() => openDialogs(page)).toBe(1);
  expect(await detailsEntity(page)).toBe("light.lamps");
  await page.evaluate(() => history.back());
  await expectDialog(page, false);
});

test("a member opened by Home Assistant's own tap stacks too", async ({ page }) => {
  await openDashboard(page, "/test-default/test");
  await openDetails(page, "light.lamps");
  const f = await finger(page);
  await f.tap(await detailsTile(page)); // a member's tile opens its details on tap
  await expect.poll(() => openDialogs(page)).toBe(2);
  expect(await detailsEntity(page)).toBe("light.lamp_light");
  await page.waitForTimeout(400);
  await page.evaluate(() => history.back());
  await expect.poll(() => openDialogs(page)).toBe(1);
  expect(await detailsEntity(page)).toBe("light.lamps");
});

test("stack_details: false keeps Home Assistant's behavior", async ({ page }) => {
  await openDashboard(page, "/test-custom/test");
  await openDetails(page, "light.lamps");
  await memberActions(page);
  const f = await finger(page);
  await f.down(await detailsTile(page));
  await expect.poll(() => detailsEntity(page)).toBe("light.lamp_light");
  expect(await openDialogs(page)).toBe(1);
  await f.up();
  await page.waitForTimeout(600);
  await page.evaluate(() => history.back());
  await expectDialog(page, false);
});

test("details opened outside a dashboard keep Home Assistant's open-on-release behavior", async ({
  page,
}) => {
  // Resources load with a dashboard, so start on one and move on, as a person would
  await openDashboard(page, "/test-default/test");
  await page.evaluate(() => {
    history.pushState(null, "", "/history");
    window.dispatchEvent(new Event("location-changed"));
  });
  await page.waitForURL("**/history");
  await page.waitForTimeout(500);
  await openDetails(page, "light.lamps");
  await memberActions(page);
  const f = await finger(page);
  await f.down(await detailsTile(page));
  await page.waitForTimeout(800);
  expect(await detailsEntity(page)).toBe("light.lamps");
  expect(await ghostCount(page)).toBe(0);
  await f.up();
  await expect.poll(() => detailsEntity(page)).toBe("light.lamp_light");
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
