import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import type { BrowserInstanceOption } from "vitest/node";
import { validateZip } from "./test/commands.js";

const browserInstances: BrowserInstanceOption[] = [
  { browser: "chromium" },
  { browser: "firefox" },
];

if (process.platform === "darwin") {
  browserInstances.push({ browser: "webkit" });
}

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
        },
      },
      {
        optimizeDeps: {
          exclude: ["yauzl-promise", "execa"],
        },
        test: {
          name: "browser",
          exclude: ["test/zip64.test.ts", "**/node_modules/**", "**/.git/**"],
          browser: {
            ui: false,
            screenshotFailures: false,
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: browserInstances,
            commands: {
              validateZip,
            },
          },
        },
      },
    ],
  },
});
