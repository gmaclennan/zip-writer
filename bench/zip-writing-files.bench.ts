/**
 * ZIP Writing Benchmarks
 *
 * Compares zip-writable performance against popular Node.js ZIP libraries:
 * - archiver: Popular streaming ZIP library
 * - fflate: Fast compression library
 * - @zip.js/zip.js: Modern ZIP library with Web Streams support
 *
 * All benchmarks use DEFLATE compression and write to temporary files.
 * Fixture files are lazily initialized using setup hooks to exclude setup time from benchmarks.
 */

import { describe, bench } from "vitest";
import { ZipWriter } from "../src/index.js";
import { mkdir, writeFile, rm, readFile, readdir, mkdtemp } from "fs/promises";
import { createWriteStream, createReadStream, read } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import archiver from "archiver";
import { zip as fflateZip } from "fflate";
import { ZipWriter as ZipJsWriter } from "@zip.js/zip.js";
import { crc32 as nodeRsCrc32 } from "@node-rs/crc32";
import { crc32 as jsCrc32 } from "../src/crc-browser.js";

const tempDir = await mkdtemp(join(tmpdir(), "zip-bench-"));
process.on("beforeExit", async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/**
 * Helper to stream a ReadableStream to a file
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
 * Create test fixtures with random compressible data
 */
async function createFixtures({
  fileCount,
  fileSize,
}: {
  fileCount: number;
  fileSize: number;
}): Promise<string> {
  const fixtureDir = await mkdtemp(join(tempDir, "zip-bench-fixtures-"));

  for (let i = 0; i < fileCount; i++) {
    const fileName = `file-${i.toString().padStart(6, "0")}.txt`;
    const filePath = join(fixtureDir, fileName);

    // Create compressible content (mix of repeated patterns and random data)
    const chunkSize = 1024;
    const chunks = Math.ceil(fileSize / chunkSize);
    const buffer = Buffer.alloc(fileSize);
    let offset = 0;

    for (let j = 0; j < chunks; j++) {
      const pattern = `Line ${j}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n`;
      const patternBuffer = Buffer.from(pattern);
      const writeSize = Math.min(chunkSize, fileSize - offset);

      for (let k = 0; k < writeSize; k++) {
        buffer[offset + k] = patternBuffer[k % patternBuffer.length];
      }
      offset += writeSize;
    }

    await writeFile(filePath, buffer);
  }

  return fixtureDir;
}

/**
 * Benchmark: zip-writable
 */
async function benchmarkZipWritable(
  fixtureDir: string,
  outputPath: string,
  crc32?: typeof jsCrc32
): Promise<void> {
  const zipWriter = new ZipWriter({ crc32 });
  const streamPromise = streamToFile(zipWriter.readable, outputPath);

  // Get list of fixture files
  const fileNames = await readdir(fixtureDir);

  for (const fileName of fileNames) {
    const filePath = join(fixtureDir, fileName);
    const fileContent = createReadStream(filePath);

    zipWriter.addEntry({
      readable: Readable.toWeb(fileContent) as ReadableStream,
      name: fileName,
      store: false, // Use DEFLATE compression
    });
  }

  zipWriter.finalize();
  await streamPromise;
}

/**
 * Benchmark: archiver
 */
async function benchmarkArchiver(
  fixtureDir: string,
  outputPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = archiver("zip", {
      zlib: { level: 6 }, // Default compression level
    });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(fixtureDir, false);
    archive.finalize();
  });
}

/**
 * Benchmark: fflate
 */
async function benchmarkFflate(
  fixtureDir: string,
  outputPath: string
): Promise<void> {
  const { readdir } = await import("fs/promises");
  const fileNames = await readdir(fixtureDir);

  // Build file map for fflate
  const files: Record<string, Uint8Array> = {};
  const readPromises: Promise<void>[] = [];
  for (const fileName of fileNames) {
    const filePath = join(fixtureDir, fileName);
    readPromises.push(
      readFile(filePath).then((content) => {
        files[fileName] = content;
      })
    );
  }
  await Promise.all(readPromises);

  // fflate zip is async and uses callbacks
  return new Promise((resolve, reject) => {
    fflateZip(files, { level: 6 }, (err, data) => {
      if (err) {
        reject(err);
      } else {
        writeFile(outputPath, data).then(resolve).catch(reject);
      }
    });
  });
}

/**
 * Benchmark: @zip.js/zip.js
 */
async function benchmarkZipJs(
  fixtureDir: string,
  outputPath: string
): Promise<void> {
  const { readdir } = await import("fs/promises");
  const fileNames = await readdir(fixtureDir);

  const zipWriter = new ZipJsWriter(
    Writable.toWeb(createWriteStream(outputPath)) as WritableStream<Uint8Array>
  );

  const readPromises: Promise<any>[] = [];
  for (const fileName of fileNames) {
    const filePath = join(fixtureDir, fileName);
    const content = Readable.toWeb(createReadStream(filePath));
    readPromises.push(zipWriter.add(fileName, content as ReadableStream));
  }

  await Promise.all(readPromises);
  await zipWriter.close();
}

function benchmarks({
  fileCount,
  fileSize,
  ...benchOptions
}: {
  fileCount: number;
  fileSize: number;
} & import("vitest").BenchOptions) {
  let fixtureDir: string;
  let i = 0;

  async function setup() {
    if (fixtureDir) return;
    fixtureDir = await createFixtures({ fileCount, fileSize });
  }

  bench(
    "zip-writable",
    async () => {
      const outputPath = join(tempDir, `zip-bench-output-${i++}.zip`);
      await benchmarkZipWritable(fixtureDir, outputPath);
    },
    { setup, ...benchOptions }
  );

  bench(
    "zip-writable (@node-rs/crc32)",
    async () => {
      const outputPath = join(tempDir, `zip-bench-output-${i++}.zip`);
      await benchmarkZipWritable(fixtureDir, outputPath, nodeRsCrc32);
    },
    { setup, ...benchOptions }
  );

  bench(
    "zip-writable (js crc32)",
    async () => {
      const outputPath = join(tempDir, `zip-bench-output-${i++}.zip`);
      await benchmarkZipWritable(fixtureDir, outputPath, jsCrc32);
    },
    { setup, ...benchOptions }
  );

  bench(
    "archiver",
    async () => {
      const outputPath = join(tempDir, `zip-bench-output-${i++}.zip`);
      await benchmarkArchiver(fixtureDir, outputPath);
    },
    { setup, ...benchOptions }
  );

  bench(
    "fflate",
    async () => {
      const outputPath = join(tempDir, `zip-bench-output-${i++}.zip`);
      await benchmarkFflate(fixtureDir, outputPath);
    },
    { setup, ...benchOptions }
  );

  bench(
    "@zip.js/zip.js",
    async () => {
      const outputPath = join(tempDir, `zip-bench-output-${i++}.zip`);
      await benchmarkZipJs(fixtureDir, outputPath);
    },
    { setup, ...benchOptions }
  );
}

// ============================================================================
// Small Files Benchmark: 10 files × 10KB each
// ============================================================================

describe("Small files (10 × 10KB)", () => {
  benchmarks({
    fileCount: 10,
    fileSize: 10 * 1024,
    iterations: 10,
    time: 1000,
  });
});

// ============================================================================
// Medium Files Benchmark: 100 files × 100KB each
// ============================================================================

describe("Medium files (100 × 100KB)", () => {
  benchmarks({
    fileCount: 100,
    fileSize: 100 * 1024,
    iterations: 5,
    time: 1000,
  });
});

// ============================================================================
// Large Files Benchmark: 5 files × 10MB each
// ============================================================================

describe("Large files (5 × 10MB)", () => {
  benchmarks({
    fileCount: 5,
    fileSize: 10 * 1024 * 1024,
    time: 1000,
  });
});

// ============================================================================
// Many Files Benchmark: 1000 files × 1KB each
// ============================================================================

describe("Many files (1000 × 1KB)", () => {
  benchmarks({
    fileCount: 1000,
    fileSize: 1024,
    iterations: 5,
    time: 1000,
  });
});
