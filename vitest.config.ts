import { defineConfig } from "vitest/config";
import type { BrowserInstanceOption } from "vitest/node";
import { validateZip } from "./test/commands.js";

const browserInstances: BrowserInstanceOption[] = [{ browser: "chromium" }];

if (process.platform === "darwin") {
  browserInstances.push({ browser: "webkit" });
}

if (process.platform !== "win32") {
  // Firefox tests keep timing out on Windows CI runners due to
  // https://github.com/microsoft/playwright/issues/34586
  browserInstances.push({ browser: "firefox" });
}

export default defineConfig({
  server: {
    // Node 18 on Windows doesn't support listening on IPv6 ::1
    host: "127.0.0.1",
  },
  test: {
    reporters: process.env.CI ? ["verbose"] : ["default"],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.ts"],
      reporter: ["lcov", "text"],
    },
    benchmark: {
      include: ["bench/**/*.bench.ts"],
    },
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          alias: {
            // vitest follows package.json imports to the compiled file, but we
            // want it to use the src TS file in testing
            "#crc32": "/src/crc-node.ts",
            "#deflate-raw": "/src/deflate-raw-node.ts",
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
            exclude: ["bench/zip-writing-files.bench.ts"],
          },
          alias: {
            // vitest follows package.json imports to the compiled file, but we
            // want it to use the src TS file in testing
            "#crc32": "/src/crc-browser.ts",
            "#deflate-raw": "/src/deflate-raw-browser.ts",
          },
          include: ["test/**/*.test.ts", "bench/zip-writing-browser.bench.ts"],
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
            provider: "playwright",
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
