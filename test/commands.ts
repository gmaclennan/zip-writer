import type { BrowserCommand } from "vitest/node";
import yauzl from "yauzl-promise";
import { createHash } from "crypto";

export interface ZipEntryInfo {
  filename: string;
  uncompressedSize: number;
  compressedSize: number;
  compressionMethod: number;
  sha256: string;
  isDirectory: boolean;
  externalFileAttributes: number;
}

/**
 * Validate a ZIP file buffer using yauzl-promise in Node context.
 * Returns entry information including SHA256 hashes of content.
 */
export const validateZip: BrowserCommand<[zipBuffer: any]> = async (
  _ctx,
  dataAsHex: string
): Promise<ZipEntryInfo[]> => {
  const buffer = Buffer.from(dataAsHex, "hex");
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

    entries.push({
      filename: entry.filename,
      uncompressedSize: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      compressionMethod: entry.compressionMethod,
      sha256: hash.digest("hex"),
      isDirectory,
      externalFileAttributes: entry.externalFileAttributes,
    });
  }

  return entries;
};
