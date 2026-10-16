// Records the README demo as PNG frames, deterministically: timers, animation frames and
// Web Animations are all stepped one frame at a time, so slow machines still record smoothly.
//
//   npm run hass:up
//   node scripts/record-demo.mjs [outDir]   # needs test-results/.auth.json (run `npm test` once)
//   ffmpeg -framerate 30 -i out/%03d.png -vf "fps=30,scale=320:-1:flags=lanczos" docs/demo.gif
import { chromium, devices } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const base = process.env.HASS_URL || "http://localhost:8123";
const out = process.argv[2] || "demo-frames";
const FRAME_MS = 1000 / 30;

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices["Pixel 7"],
  deviceScaleFactor: 1,
  colorScheme: "dark",
  // Home Assistant reloads the page when its service worker first takes control
  serviceWorkers: "block",
  storageState: JSON.parse(await readFile("test-results/.auth.json", "utf8")),
});
const page = await context.newPage();
await page.goto(`${base}/demo-home/home`);
await page.waitForFunction(() => window.__holdToOpen);
await page.locator("hui-tile-card").first().waitFor();
await page.waitForTimeout(2000);

await page.clock.install();
await page.clock.pauseAt(Date.now() + 1000); // installed clocks keep running unless paused
await page.evaluate(() => {
  const starts = new WeakMap();
  window.__stepAnimations = () => {
    const now = performance.now();
    for (const a of document.getAnimations()) {
      if (!starts.has(a)) starts.set(a, now);
      a.pause();
      a.currentTime = now - starts.get(a);
    }
  };
  // A popover, so it stays above the dialog (both live in the top layer)
  const dot = document.createElement("div");
  dot.popover = "manual";
  dot.style.cssText = `position:fixed;inset:auto;padding:0;width:44px;height:44px;margin:-22px;
    border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.6);
    pointer-events:none`;
  document.body.append(dot);
  window.__finger = (x, y) => {
    if (dot.matches(":popover-open")) dot.hidePopover();
    if (x == null) return;
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.showPopover(); // re-shown each frame to stay on top of newer dialogs
  };
});

const cdp = await context.newCDPSession(page);
let n = 0;
let finger = [null, null];
const frame = async (touch) => {
  if (touch) {
    await cdp.send("Input.dispatchTouchEvent", touch);
    finger = touch.touchPoints[0] ? [touch.touchPoints[0].x, touch.touchPoints[0].y] : [null, null];
  }
  await page.evaluate(([x, y]) => window.__finger(x, y), finger);
  await page.clock.runFor(FRAME_MS);
  await page.evaluate(() => window.__stepAnimations());
  await page.waitForTimeout(40); // let the browser draw
  await page.screenshot({ path: `${out}/${String(n++).padStart(3, "0")}.png` });
};

const box = await page.locator("hui-tile-card").nth(2).boundingBox();
const x = box.x + box.width * 0.6;
const y = box.y + box.height / 2;
for (let i = 0; i < 15; i++) await frame();
await frame({ type: "touchStart", touchPoints: [{ x, y }] });
for (let i = 0; i < 40; i++) await frame(); // hold: the details open while the finger is down
await frame({ type: "touchEnd", touchPoints: [] });
for (let i = 0; i < 30; i++) await frame();

await browser.close();
console.log(`${n} frames in ${out}/`);
