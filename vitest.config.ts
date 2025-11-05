import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserInstanceOption } from "vitest/node";

const browserInstances: BrowserInstanceOption[] = [
  { browser: "chromium" },
  { browser: "firefox" },
];

if (process.platform === "darwin") {
  browserInstances.push({ browser: "webkit" });
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
        },
      },
      {
        test: {
          name: "browser",
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: browserInstances,
          },
        },
      },
    ],
  },
});
