import { test, type BenchCompareOptions } from "vitest";
import { ZipWriter } from "../src/index.js";
import { readableFromBytes } from "../src/readable-from-bytes.js";
import { createSink } from "../test/utils.js";
import { ZipWriter as ZipJsWriter } from "@zip.js/zip.js";
import { zip as fflateZip } from "fflate";

type Entry = {
  fileName: string;
  content: Uint8Array<ArrayBuffer>;
};

/**
 * Create test fixtures with random compressible data
 */
async function createFixtures(
  fileCount: number,
  fileSize: number,
): Promise<Entry[]> {
  const entries: Entry[] = [];

  for (let i = 0; i < fileCount; i++) {
    const fileName = `file-${i.toString().padStart(6, "0")}.txt`;

    // Create compressible content (mix of repeated patterns and random data)
    const chunkSize = 1024;
    const chunks = Math.ceil(fileSize / chunkSize);
    const buffer = new Uint8Array(fileSize);
    let offset = 0;

    for (let j = 0; j < chunks; j++) {
      const pattern = `Line ${j}: Lorem ipsum dolor sit amet, consectetur adipiscing elit.\n`;
      const patternBuffer = new TextEncoder().encode(pattern);
      const writeSize = Math.min(chunkSize, fileSize - offset);

      for (let k = 0; k < writeSize; k++) {
        buffer[offset + k] = patternBuffer[k % patternBuffer.length];
      }
      offset += writeSize;
    }
    entries.push({ fileName, content: buffer });
  }

  return entries;
}
/**
 * Benchmark: zip-writer
 */
async function benchmarkZipWriter(entries: Entry[]): Promise<void> {
  const zipWriter = new ZipWriter();
  const consumePromise = zipWriter.readable.pipeTo(createSink());

  for (const entry of entries) {
    await zipWriter.addEntry({
      name: entry.fileName,
      readable: readableFromBytes(entry.content),
    });
  }

  zipWriter.finalize();
  await consumePromise;
}

/**
 * Benchmark: @zip.js/zip.js
 */
async function benchmarkZipJs(entries: Entry[]): Promise<void> {
  const writableStream = createSink();

  const zipWriter = new ZipJsWriter(writableStream);

  for (const entry of entries) {
    await zipWriter.add(entry.fileName, readableFromBytes(entry.content));
  }

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
    const entries = await createFixtures(fileCount, fileSize);

    await bench.compare(
      bench("zip-writer", () => benchmarkZipWriter(entries)),
      bench("@zip.js/zip.js", () => benchmarkZipJs(entries)),
      bench("fflate", () => {
        const files: Record<string, Uint8Array> = {};
        for (const entry of entries) {
          files[entry.fileName] = entry.content;
        }
        // fflate zip is async and uses callbacks
        return new Promise<void>((resolve, reject) => {
          fflateZip(files, { level: 6 }, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      }),
      runOptions,
    );
  });
}

benchmarks("Small files (10 × 10KB)", {
  fileCount: 10,
  fileSize: 10 * 1024,
  iterations: 3,
  time: 500,
});

benchmarks("Medium files (100 × 100KB)", {
  fileCount: 100,
  fileSize: 100 * 1024,
  iterations: 2,
  time: 500,
});

benchmarks("Large files (5 × 10MB)", {
  fileCount: 5,
  fileSize: 10 * 1024 * 1024,
  iterations: 1,
  time: 500,
});

benchmarks("Many files (1000 × 1KB)", {
  fileCount: 1000,
  fileSize: 1024,
  iterations: 2,
  time: 500,
});
