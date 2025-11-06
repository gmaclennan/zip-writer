import type { BrowserCommand } from "vitest/node";
import yauzl from "yauzl-promise";
import { createHash } from "crypto";
import { writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir, platform } from "os";
import { join, dirname } from "path";
import { execa } from "execa";
import { fileURLToPath } from "url";

type YauzlEntryInfo = {
  [K in keyof yauzl.Entry]: yauzl.Entry[K] extends Function
    ? never
    : yauzl.Entry[K];
};

export type ZipEntryInfo = YauzlEntryInfo & {
  sha256: string;
  isDirectory: boolean;
};

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Validate ZIP file using unzip command
 */
async function validateWithUnzip(zipFile: string): Promise<void> {
  const isWindows = platform() === "win32";

  if (isWindows) {
    // Windows: use tar command (available in Windows 10+)
    await execa("tar", ["-tf", zipFile]);
  } else {
    // macOS/Linux: use unzip -t
    await execa("unzip", ["-t", zipFile]);
  }
}

/**
 * Validate ZIP file using Python's zipfile.testzip()
 */
async function validateWithPython(zipFile: string): Promise<void> {
  const scriptPath = join(__dirname, "validate-zip.py");

  // Run Python validation
  await execa("python3", [scriptPath, zipFile]);
}

/**
 * Validate a ZIP file buffer using yauzl-promise in Node context.
 * Returns entry information including SHA256 hashes of content.
 */
export const validateZip: BrowserCommand<[zipBuffer: any]> = async (
  _ctx,
  dataAsHex: string
): Promise<ZipEntryInfo[] | { error: Error }> => {
  let tempDir: string | undefined;
  try {
    const buffer = Buffer.from(dataAsHex, "hex");

    // Create temp directory and file
    tempDir = await mkdtemp(join(tmpdir(), "zip-test-"));
    const tempFile = join(tempDir, "test.zip");
    await writeFile(tempFile, buffer);

    await validateWithPython(tempFile);
    await validateWithUnzip(tempFile);

    const zipFile = await yauzl.fromBuffer(buffer);
    const entries: ZipEntryInfo[] = [];

    for await (const entry of zipFile) {
      // Read entry content and calculate SHA256
      const readStream = await entry.openReadStream();
      const chunks: Buffer[] = [];
      const hash = createHash("sha256");

      await new Promise<void>((resolve, reject) => {
        readStream.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          hash.update(chunk);
        });
        readStream.on("end", () => resolve());
        readStream.on("error", reject);
      });

      const isDirectory = entry.filename.endsWith("/");

      const { zip, _ref, ...yauzlEntryInfo } = entry as any;

      entries.push({
        ...yauzlEntryInfo,
        sha256: hash.digest("hex"),
        isDirectory,
      });
    }

    return entries;
  } catch (err) {
    return { error: err as Error };
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
};
