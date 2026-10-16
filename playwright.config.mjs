import { defineConfig, devices } from "@playwright/test";

// Tests run against the disposable Home Assistant from docker-compose.yml
// (`npm run hass:up`). Point HASS_URL elsewhere to test another instance.
export default defineConfig({
  testDir: "tests",
  globalSetup: "./tests/global-setup.mjs",
  fullyParallel: false, // one HA instance; keep touches from interleaving
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Pixel 7"],
    baseURL: process.env.HASS_URL || "http://localhost:8123",
    storageState: "test-results/.auth.json",
    trace: "retain-on-failure",
    // Home Assistant reloads the page when its service worker first takes control,
    // which would interrupt a hold mid-test
    serviceWorkers: "block",
  },
});
