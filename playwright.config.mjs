import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "./build/browser-results",
  reporter: "list",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:8878",
    browserName: "chromium",
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? {
          launchOptions: {
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
          },
        }
      : {}),
  },
  webServer: {
    command: ".venv/bin/python -m tests.browser.serve",
    url: "http://127.0.0.1:8878",
    timeout: 30000,
    reuseExistingServer: false,
  },
});
