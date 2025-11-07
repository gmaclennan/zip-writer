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
    reporters: process.env.CI ? ["verbose"] : ["default"],
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
        },
      },
      {
        optimizeDeps: {
          exclude: ["yauzl-promise", "execa", "node:zlib", "zlib"],
        },
        test: {
          name: "browser",
          benchmark: {
            exclude: ["bench/zip-writing.bench.ts"],
          },
          include: ["test/**/*.test.ts"],
          exclude: [
            "test/zip64.test.ts",
            "test/crc.test.ts",
            "**/node_modules/**",
            "**/.git/**",
          ],
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
