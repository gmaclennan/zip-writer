/**
 * ZIP Writing Benchmarks
 *
 * Compares zip-writer performance against popular Node.js ZIP libraries:
 * - archiver: Popular streaming ZIP library
 * - fflate: Fast compression library
 * - @zip.js/zip.js: Modern ZIP library with Web Streams support
 *
 * All benchmarks use DEFLATE compression and write to temporary files.
 * Fixture files are created before each comparison so setup time is excluded from benchmarks.
 */

import { test, type BenchCompareOptions } from "vitest";
import { ZipWriter } from "../src/index.js";
import { mkdir, writeFile, rm, readFile, readdir, mkdtemp } from "fs/promises";
import { createWriteStream, createReadStream, read } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Readable, Writable } from "stream";
import { pipeline } from "stream/promises";
import { ZipArchive } from "archiver";
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
  filePath: string,
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
 * Benchmark: zip-writer
 */
async function benchmarkZipWriter(
  fixtureDir: string,
  outputPath: string,
  crc32?: typeof jsCrc32,
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
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(outputPath);
    const archive = new ZipArchive({
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
  outputPath: string,
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
      }),
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
  outputPath: string,
): Promise<void> {
  const { readdir } = await import("fs/promises");
  const fileNames = await readdir(fixtureDir);

  const zipWriter = new ZipJsWriter(
    Writable.toWeb(createWriteStream(outputPath)) as WritableStream<Uint8Array>,
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

function benchmarks(
  name: string,
  {
    fileCount,
    fileSize,
    ...runOptions
  }: { fileCount: number; fileSize: number } & BenchCompareOptions,
) {
  test(name, async ({ bench }) => {
    const fixtureDir = await createFixtures({ fileCount, fileSize });
    let i = 0;
    const outputPath = () => join(tempDir, `zip-bench-output-${i++}.zip`);

    await bench.compare(
      bench("zip-writer", () => benchmarkZipWriter(fixtureDir, outputPath())),
      bench("zip-writer (@node-rs/crc32)", () =>
        benchmarkZipWriter(fixtureDir, outputPath(), nodeRsCrc32),
      ),
      bench("zip-writer (js crc32)", () =>
        benchmarkZipWriter(fixtureDir, outputPath(), jsCrc32),
      ),
      bench("archiver", () => benchmarkArchiver(fixtureDir, outputPath())),
      bench("fflate", () => benchmarkFflate(fixtureDir, outputPath())),
      bench("@zip.js/zip.js", () => benchmarkZipJs(fixtureDir, outputPath())),
      runOptions,
    );
  });
}

benchmarks("Small files (10 × 10KB)", {
  fileCount: 10,
  fileSize: 10 * 1024,
  iterations: 10,
  time: 1000,
});

benchmarks("Medium files (100 × 100KB)", {
  fileCount: 100,
  fileSize: 100 * 1024,
  iterations: 5,
  time: 1000,
});

benchmarks("Large files (5 × 10MB)", {
  fileCount: 5,
  fileSize: 10 * 1024 * 1024,
  time: 1000,
});

benchmarks("Many files (1000 × 1KB)", {
  fileCount: 1000,
  fileSize: 1024,
  iterations: 5,
  time: 1000,
});
