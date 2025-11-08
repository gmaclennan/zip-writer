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
          alias: {
            // vitest follows package.json imports to the compiled file, but we
            // want it to use the src TS file in testing
            "#crc32": "/src/crc-node.ts",
          },
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
          alias: {
            // vitest follows package.json imports to the compiled file, but we
            // want it to use the src TS file in testing
            "#crc32": "/src/crc-browser.ts",
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
