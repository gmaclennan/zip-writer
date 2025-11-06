/**
 * ZIP64 Format Tests
 *
 * These tests verify ZIP64 support for archives with:
 * - Files larger than 4GB
 * - More than 65535 files
 * - Total archive size larger than 4GB
 *
 * These tests only run in Node.js environment (not in browsers) because:
 * 1. Creating multi-GB test data would be too slow over IPC to browser
 * 2. Browser memory constraints make large file testing impractical
 * 3. Node.js provides better file streaming capabilities
 *
 * The tests stream the ZIP output directly to temporary files instead of
 * buffering in memory, which allows testing very large archives without
 * running out of memory.
 *
 * Note: These tests only validate ZIP metadata (entry count, sizes, compression
 * method) without reading the actual file contents. Content validation is covered
 * by the integration tests. This keeps the tests fast despite the large file sizes.
 */

import { describe, it, assert } from "vitest";
import { ZipWriter } from "../src/index.js";
import { rm } from "fs/promises";
import { createWriteStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as yauzl from "yauzl-promise";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

/**
 * Stream a ReadableStream to a file path using Node.js streams
 */
async function streamToFile(
  stream: ReadableStream<ArrayBufferView>,
  filePath: string
): Promise<void> {
  const nodeStream = Readable.fromWeb(stream as any);
  const fileStream = createWriteStream(filePath);
  await pipeline(nodeStream, fileStream);
}

/**
 * Validate a zip file and return entry information (without reading content)
 */
async function validateZipFile(filePath: string) {
  const zipFile = await yauzl.open(filePath);
  const entries: Array<{
    filename: string;
    uncompressedSize: number;
    compressedSize: number;
    compressionMethod: number;
  }> = [];

  for await (const entry of zipFile) {
    entries.push({
      filename: entry.filename,
      uncompressedSize: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      compressionMethod: entry.compressionMethod,
    });
  }

  return entries;
}

/**
 * Create a readable stream that generates a pattern.
 * Uses pull strategy to respect backpressure.
 */
function createPatternStream(pattern: number, size: number): ReadableStream {
  const chunkSize = 1024 * 1024; // 1 MB chunks
  const chunk = new Uint8Array(chunkSize);
  chunk.fill(pattern);
  let remaining = size;

  return new ReadableStream({
    pull(controller) {
      if (remaining <= 0) {
        controller.close();
        return;
      }

      const toWrite = Math.min(chunkSize, remaining);
      controller.enqueue(chunk.subarray(0, toWrite));
      remaining -= toWrite;
    },
  });
}

describe("ZIP64 Format Tests (Node only)", () => {
  it("should stream a small ZIP to file and validate (smoke test)", async ({ onTestFinished }) => {
    const tempDir = tmpdir();
    const zipPath = join(tempDir, `test-zip64-smoke-${Date.now()}.zip`);
    onTestFinished(() => rm(zipPath, { force: true }));

    const zipWriter = new ZipWriter();

    // Create a small file first to test the streaming mechanism
    const entryWriter = zipWriter.entry({
      name: "test.txt",
      store: true,
    });

    const writer = entryWriter.writable.getWriter();
    await writer.write(new TextEncoder().encode("Hello ZIP64 tests!"));
    await writer.close();

    // Stream to file
    const streamPromise = streamToFile(zipWriter.readable, zipPath);
    await zipWriter.finalize();
    await streamPromise;

    // Validate
    const entries = await validateZipFile(zipPath);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].filename, "test.txt");
  });

  it("should create a ZIP64 archive with a file larger than 4GB", async ({ onTestFinished }) => {
    const tempDir = tmpdir();
    const zipPath = join(tempDir, `test-zip64-${Date.now()}.zip`);
    onTestFinished(() => rm(zipPath, { force: true }));

    const zipWriter = new ZipWriter();

    // Create a file larger than 4GB (4GB + 1MB to ensure ZIP64)
    const fileSize = 4 * 1024 * 1024 * 1024 + 1024 * 1024; // 4GB + 1MB
    const pattern = 0x42; // 'B' character

    // Write a large file using store (no compression) to save time
    const entryWriter = zipWriter.entry({
      name: "large-file.bin",
      store: true,
    });

    // Start streaming the ZIP to a file - MUST start before writing data
    // to avoid blocking on the 16KB buffer in the readable stream
    const streamPromise = streamToFile(zipWriter.readable, zipPath);

    // Pipe pattern stream to entry (don't await - let it run in parallel)
    const pipePromise = createPatternStream(pattern, fileSize).pipeTo(
      entryWriter.writable
    );

    // Wait for entry to complete
    await pipePromise;

    // Finalize and wait for stream to finish
    await zipWriter.finalize();
    await streamPromise;

    // Verify the ZIP file metadata
    const entries = await validateZipFile(zipPath);

    assert.strictEqual(entries.length, 1, "Should have one entry");
    const entry = entries[0];
    assert.strictEqual(entry.filename, "large-file.bin");
    assert.strictEqual(entry.uncompressedSize, fileSize);
    assert.strictEqual(entry.compressedSize, fileSize); // STORE = no compression
    assert.strictEqual(entry.compressionMethod, 0); // STORE
  }, 120000); // 2 minute timeout for large file

  it("should create a ZIP64 archive with many files (>65535 entries)", async ({ onTestFinished }) => {
    const tempDir = tmpdir();
    const zipPath = join(tempDir, `test-zip64-many-${Date.now()}.zip`);
    onTestFinished(() => rm(zipPath, { force: true }));

    const zipWriter = new ZipWriter();

    // Create more than 65535 files (the 16-bit limit)
    const fileCount = 65536 + 100;
    const fileContent = "test";
    const fileBytes = new TextEncoder().encode(fileContent);

    // Start streaming to file
    const streamPromise = streamToFile(zipWriter.readable, zipPath);

    // Create entries
    const entryPromises: Promise<void>[] = [];
    for (let i = 0; i < fileCount; i++) {
      const entryWriter = zipWriter.entry({
        name: `file-${i.toString().padStart(6, "0")}.txt`,
        store: true,
      });

      const promise = (async () => {
        const writer = entryWriter.writable.getWriter();
        await writer.write(fileBytes);
        await writer.close();
      })();

      entryPromises.push(promise);

      // Process in batches to avoid overwhelming memory
      if (i % 1000 === 0 && i > 0) {
        await Promise.all(entryPromises.splice(0));
      }
    }

    // Wait for remaining entries
    await Promise.all(entryPromises);

    // Finalize and wait for stream
    await zipWriter.finalize();
    await streamPromise;

    // Verify the ZIP file has correct entry count and metadata
    const entries = await validateZipFile(zipPath);
    assert.strictEqual(entries.length, fileCount, "Should have all entries");

    // Verify a few random entries
    for (const idx of [0, 1000, 30000, 65535, fileCount - 1]) {
      const entry = entries[idx];
      assert.strictEqual(
        entry.filename,
        `file-${idx.toString().padStart(6, "0")}.txt`
      );
      assert.strictEqual(entry.uncompressedSize, fileBytes.length);
      assert.strictEqual(entry.compressedSize, fileBytes.length); // STORE
      assert.strictEqual(entry.compressionMethod, 0);
    }
  }, 120000); // 2 minute timeout

  it("should create a ZIP64 archive with total size larger than 4GB", async ({ onTestFinished }) => {
    const tempDir = tmpdir();
    const zipPath = join(tempDir, `test-zip64-total-${Date.now()}.zip`);
    onTestFinished(() => rm(zipPath, { force: true }));

    const zipWriter = new ZipWriter();

    // Create multiple files that together exceed 4GB
    const fileSize = 1024 * 1024 * 1024; // 1GB each
    const fileCount = 5; // 5GB total
    const pattern = 0x43; // 'C' character

    // Start streaming to file
    const streamPromise = streamToFile(zipWriter.readable, zipPath);

    // Create entries
    for (let i = 0; i < fileCount; i++) {
      const entryWriter = zipWriter.entry({
        name: `large-file-${i}.bin`,
        store: true,
      });

      await createPatternStream(pattern, fileSize).pipeTo(entryWriter.writable);
    }

    // Finalize and wait for stream
    await zipWriter.finalize();
    await streamPromise;

    // Verify the ZIP file metadata
    const entries = await validateZipFile(zipPath);

    assert.strictEqual(entries.length, fileCount, "Should have all entries");

    for (let i = 0; i < fileCount; i++) {
      const entry = entries[i];
      assert.strictEqual(entry.filename, `large-file-${i}.bin`);
      assert.strictEqual(entry.uncompressedSize, fileSize);
      assert.strictEqual(entry.compressedSize, fileSize); // STORE
      assert.strictEqual(entry.compressionMethod, 0);
    }
  }, 300000); // 5 minute timeout for very large files

  it("should handle compressed ZIP64 files correctly", async ({ onTestFinished }) => {
    const tempDir = tmpdir();
    const zipPath = join(tempDir, `test-zip64-compressed-${Date.now()}.zip`);
    onTestFinished(() => rm(zipPath, { force: true }));

    const zipWriter = new ZipWriter();

    // Create a large compressible file (repeating pattern compresses well)
    const fileSize = 5 * 1024 * 1024 * 1024; // 5GB uncompressed
    const pattern = 0x41; // 'A' character (compresses very well)

    const entryWriter = zipWriter.entry({
      name: "compressed-large.bin",
      store: false, // Use deflate compression
    });

    // Start streaming to file BEFORE writing data
    const streamPromise = streamToFile(zipWriter.readable, zipPath);

    // Pipe pattern stream to entry
    const pipePromise = createPatternStream(pattern, fileSize).pipeTo(
      entryWriter.writable
    );

    await pipePromise;
    await zipWriter.finalize();
    await streamPromise;

    // Verify metadata
    const entries = await validateZipFile(zipPath);

    assert.strictEqual(entries.length, 1);
    const entry = entries[0];
    assert.strictEqual(entry.filename, "compressed-large.bin");
    assert.strictEqual(entry.uncompressedSize, fileSize);
    assert.strictEqual(entry.compressionMethod, 8); // DEFLATE

    // Compressed size should be much smaller due to repeating pattern
    assert.isBelow(
      entry.compressedSize,
      fileSize / 100,
      "Compressed size should be < 1% of original"
    );
  }, 300000); // 5 minute timeout
});
