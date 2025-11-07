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
import { createWriteStream, createReadStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import archiver from "archiver";
import { zip as fflateZip } from "fflate";
import { ZipWriter as ZipJsWriter } from "@zip.js/zip.js";
import { crc32 as nodeRsCrc32 } from "@node-rs/crc32";
import { crc32 as jsCrc32 } from "../src/crc-browser.js";

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
async function createFixtures(
  fixtureDir: string,
  fileCount: number,
  fileSize: number
): Promise<string[]> {
  await mkdir(fixtureDir, { recursive: true });
  const filePaths: string[] = [];

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
    filePaths.push(filePath);
  }

  return filePaths;
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

    const entryWriter = zipWriter.entry({
      name: fileName,
      store: false, // Use DEFLATE compression
    });

    Readable.toWeb(fileContent).pipeTo(entryWriter.writable);
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
  for (const fileName of fileNames) {
    const filePath = join(fixtureDir, fileName);
    const content = await readFile(filePath);
    files[fileName] = content;
  }

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

  for (const fileName of fileNames) {
    const filePath = join(fixtureDir, fileName);
    const content = Readable.toWeb(createReadStream(filePath));
    await zipWriter.add(fileName, content as ReadableStream);
  }

  await zipWriter.close();
}

function benchmarks({
  fixtureDir,
  outputDir,
  benchOptions,
}: {
  fixtureDir: string;
  outputDir: string;
  benchOptions: import("vitest").BenchOptions;
}) {
  bench(
    "zip-writable",
    async () => {
      const outputPath = join(outputDir, `zip-writable-${Date.now()}.zip`);
      await benchmarkZipWritable(fixtureDir, outputPath);
    },
    benchOptions
  );

  bench(
    "zip-writable (@node-rs/crc32)",
    async () => {
      const outputPath = join(outputDir, `zip-writable-${Date.now()}.zip`);
      await benchmarkZipWritable(fixtureDir, outputPath, nodeRsCrc32);
    },
    benchOptions
  );

  bench(
    "zip-writable (js crc32)",
    async () => {
      const outputPath = join(outputDir, `zip-writable-${Date.now()}.zip`);
      await benchmarkZipWritable(fixtureDir, outputPath, jsCrc32);
    },
    benchOptions
  );

  bench(
    "archiver",
    async () => {
      const outputPath = join(outputDir, `archiver-${Date.now()}.zip`);
      await benchmarkArchiver(fixtureDir, outputPath);
    },
    benchOptions
  );

  bench(
    "fflate",
    async () => {
      const outputPath = join(outputDir, `fflate-${Date.now()}.zip`);
      await benchmarkFflate(fixtureDir, outputPath);
    },
    benchOptions
  );

  bench(
    "@zip.js/zip.js",
    async () => {
      const outputPath = join(outputDir, `zipjs-${Date.now()}.zip`);
      await benchmarkZipJs(fixtureDir, outputPath);
    },
    benchOptions
  );
}

// ============================================================================
// Small Files Benchmark: 10 files × 10KB each
// ============================================================================

describe("Small files (10 × 10KB)", () => {
  const baseDir = tmpdir();
  const fixtureDir = join(baseDir, `bench-small-fixtures-${Date.now()}`);
  const outputDir = join(baseDir, `bench-small-output-${Date.now()}`);

  let setupPromise: Promise<void> | null = null;
  let isSetupComplete = false;
  const benchOptions = {
    iterations: 10,
    time: 1000,
    setup,
  };

  // Lazy initialization function - runs once across all benchmarks
  async function setup() {
    if (!setupPromise) {
      setupPromise = (async () => {
        await mkdir(outputDir, { recursive: true });
        await createFixtures(fixtureDir, 10, 10 * 1024);
        isSetupComplete = true;
      })();
    }
    return setupPromise;
  }

  // Process cleanup - run manually after benchmarks complete
  process.on("beforeExit", async () => {
    if (isSetupComplete) {
      if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
      if (outputDir) await rm(outputDir, { recursive: true, force: true });
      console.log("Cleaned up benchmark fixture and output directories.");
    }
  });

  benchmarks({ fixtureDir, outputDir, benchOptions });
});

// ============================================================================
// Medium Files Benchmark: 100 files × 100KB each
// ============================================================================

describe("Medium files (100 × 100KB)", () => {
  const baseDir = tmpdir();
  const fixtureDir = join(baseDir, `bench-medium-fixtures-${Date.now()}`);
  const outputDir = join(baseDir, `bench-medium-output-${Date.now()}`);
  let setupPromise: Promise<void> | null = null;
  let isSetupComplete = false;
  const benchOptions = {
    iterations: 5,
    time: 1000,
    setup,
  };

  async function setup() {
    if (!setupPromise) {
      setupPromise = (async () => {
        await mkdir(outputDir, { recursive: true });
        await createFixtures(fixtureDir, 100, 100 * 1024);
        isSetupComplete = true;
      })();
    }
    return setupPromise;
  }

  process.on("beforeExit", async () => {
    if (isSetupComplete) {
      if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
      if (outputDir) await rm(outputDir, { recursive: true, force: true });
    }
  });

  benchmarks({ fixtureDir, outputDir, benchOptions });
});

// ============================================================================
// Large Files Benchmark: 5 files × 10MB each
// ============================================================================

describe("Large files (5 × 10MB)", () => {
  const baseDir = tmpdir();
  const fixtureDir = join(baseDir, `bench-large-fixtures-${Date.now()}`);
  const outputDir = join(baseDir, `bench-large-output-${Date.now()}`);
  let setupPromise: Promise<void> | null = null;
  let isSetupComplete = false;
  const benchOptions = {
    time: 1000,
    setup,
  };

  async function setup() {
    if (!setupPromise) {
      setupPromise = (async () => {
        await mkdir(outputDir, { recursive: true });
        await createFixtures(fixtureDir, 5, 10 * 1024 * 1024);
        isSetupComplete = true;
      })();
    }
    return setupPromise;
  }

  process.on("beforeExit", async () => {
    if (isSetupComplete) {
      if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
      if (outputDir) await rm(outputDir, { recursive: true, force: true });
    }
  });

  benchmarks({ fixtureDir, outputDir, benchOptions });
});

// ============================================================================
// Many Files Benchmark: 1000 files × 1KB each
// ============================================================================

describe("Many files (1000 × 1KB)", () => {
  const baseDir = tmpdir();
  const fixtureDir = join(baseDir, `bench-many-fixtures-${Date.now()}`);
  const outputDir = join(baseDir, `bench-many-output-${Date.now()}`);
  let setupPromise: Promise<void> | null = null;
  let isSetupComplete = false;
  const benchOptions = {
    iterations: 5,
    time: 1000,
    setup,
  };

  async function setup() {
    if (!setupPromise) {
      setupPromise = (async () => {
        await mkdir(outputDir, { recursive: true });
        await createFixtures(fixtureDir, 1000, 1024);
        isSetupComplete = true;
      })();
    }
    return setupPromise;
  }

  process.on("beforeExit", async () => {
    if (isSetupComplete) {
      if (fixtureDir) await rm(fixtureDir, { recursive: true, force: true });
      if (outputDir) await rm(outputDir, { recursive: true, force: true });
    }
  });

  benchmarks({ fixtureDir, outputDir, benchOptions });
});
