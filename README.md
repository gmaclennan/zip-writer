# zip-writable

[![npm version](https://img.shields.io/npm/v/zip-writer.svg)](https://www.npmjs.com/package/zip-writer)
[![GitHub CI](https://github.com/gmaclennan/zip-writer/actions/workflows/test.yml/badge.svg)](https://github.com/gmaclennan/zip-writer/actions/workflows/test.yml)
[![bundle size](https://deno.bundlejs.com/badge?q=zip-writer@1.1.2&treeshake=[*])](https://bundlejs.com/?q=zip-writer%401.1.2&treeshake=%5B*%5D)

A modern streaming ZIP archive writer for JavaScript that uses the
[Web Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
and
[Compression Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API).

## Features

- **Streaming API** - Write ZIP archives without buffering entries our the
  output zip into memory
- **Browser & Node.js** - Works in both environments with the same API
- **Small bundle size** - ~3KB minified and gzipped
- **Minimal dependencies** - Only depends on
  [p-mutex](https://www.npmjs.com/package/p-mutex) for mutex locking (adds ~390
  bytes)
- **ZIP64 support** - Automatic handling of large files and archives
- **Editable Central Directory** - Reorder, rename, or remove entries before
  finalizing
- **100% test coverage** - Output validated against standard ZIP tools

## Installation

```bash
npm install zip-writable
```

## Basic Usage

```ts
import { ZipWriter } from "zip-writable";

const zipWriter = new ZipWriter();

// Pipe the ZIP output somewhere
zipWriter.readable.pipeTo(writableStream);

// Add entries to the ZIP
const data = new TextEncoder().encode("Hello, World!");
const info = await zipWriter.addEntry({
  readable: new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  }),
  name: "hello.txt",
});
console.log(info);

// Finalize the ZIP archive
await zipWriter.finalize();
```

## API Reference

### `ZipWriter`

The main class for creating ZIP archives.

#### Constructor

##### `new ZipWriter(options?)`

**Parameters:**

- `options.crc32?: (data: Uint8Array, value?: number) => number` - Optional
  CRC32 function to use. Defaults to `zlib.crc32` on Node.js and a pure
  JavaScript implementation in browsers.

#### Properties

##### `readable: ReadableStream<Uint8Array>`

The readable stream containing the ZIP archive data. Pipe this to a file, HTTP
response, or any other writable destination.

```ts
// Save to file (Node.js with fs/promises)
import { createWriteStream } from "fs";
import { Writable } from "stream";

zipWriter.readable.pipeTo(Writable.toWeb(createWriteStream("archive.zip")));

// Send as HTTP response (in a web server)
return new Response(zipWriter.readable, {
  headers: {
    "Content-Type": "application/zip",
    "Content-Disposition": 'attachment; filename="archive.zip"',
  },
});
```

##### `entries(): Promise<EntryInfo[]>`

Returns a promise that resolves to an array of all entries that have been
written to the archive. Each entry contains metadata like size, CRC32,
compression info, etc.

#### Methods

##### `addEntry(entry: Entry): Promise<EntryInfo>`

Add an entry to the ZIP archive. Returns a promise that resolves to the entry
info once written.

**Parameters:**

- `entry.readable: ReadableStream<ArrayBufferView>` - Readable stream of entry
  data
- `entry.name: string` - Entry name including internal path (required)
- `entry.comment?: string` - Entry comment
- `entry.date?: Date` - Entry date (defaults to current date)
- `entry.mode?: number` - Entry permissions (Unix-style mode)
- `entry.store?: boolean` - Set to `true` to disable compression (defaults to
  `false`, using DEFLATE compression)

**Examples:**

```ts
// Stream from a fetch response
const response = await fetch(imageUrl);
await zipWriter.addEntry({
  readable: response.body,
  name: "images/photo.jpg",
});

// Stream from a Uint8Array
const data = new TextEncoder().encode("Hello, World!");
await zipWriter.addEntry({
  readable: new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  }),
  name: "hello.txt",
});

// With custom date and permissions
await zipWriter.addEntry({
  readable: scriptStream,
  name: "script.sh",
  date: new Date("2024-01-01"),
  mode: 0o755, // executable
});

// Disable compression for already-compressed files
await zipWriter.addEntry({
  readable: videoStream,
  name: "video.mp4",
  store: true, // no compression
});
```

##### `finalize(options?): Promise<{ zip64: boolean, uncompressedEntriesSize: bigint, compressedEntriesSize: bigint, fileSize: bigint }>`

Finalize the ZIP archive by writing the central directory and end of central
directory records. This must be called after all entries have been added. This
will await any pending entries to finish writing before finalizing.

**Parameters:**

- `options.entries?: ReadonlyArray<Readonly<EntryInfo>>` - (Advanced) Override
  the entries to write in the central directory. This can be used to reorder,
  remove, or rename entries before finalizing the archive. You cannot change the
  offset, CRC32, compressed size, or uncompressed size of entries - only the
  name, comment, date, and order.

**Returns:**

- `zip64: boolean` - Whether the archive uses ZIP64 format
- `uncompressedEntriesSize: bigint` - Total uncompressed size of all entries
- `compressedEntriesSize: bigint` - Total compressed size of all entries
- `fileSize: bigint` - Total size of the ZIP file

```ts
const result = await zipWriter.finalize();
console.log(`Created ${result.zip64 ? "ZIP64" : "standard"} archive`);
console.log(`File size: ${result.fileSize} bytes`);
console.log(
  `Compression ratio: ${Number(result.compressedEntriesSize) / Number(result.uncompressedEntriesSize)}`,
);
```

**Example with entries option:**

```ts
// Get current entries and modify them
const entries = await zipWriter.entries();

// Remove an entry
const filtered = entries.filter((e) => e.name !== "temp.txt");

// Rename entries
const renamed = entries.map((e) => ({
  ...e,
  name: e.name.replace(/^old\//, "new/"),
}));

// Sort entries alphabetically
const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));

// Finalize with modified entries
await zipWriter.finalize({ entries: sorted });
```

### `EntryInfo`

Returned by `ZipWriter.addEntry()`. Contains metadata about a written entry.

**Properties:**

- `name: string` - Entry name
- `comment?: string` - Entry comment
- `date?: Date` - Entry date
- `mode?: number` - Entry permissions
- `store?: boolean` - Whether compression was disabled
- `startOffset: bigint | number` - Byte offset in the archive
- `crc32: number` - CRC32 checksum
- `uncompressedSize: bigint | number` - Uncompressed size in bytes
- `compressedSize: bigint | number` - Compressed size in bytes
- `zip64: boolean` - Whether this entry uses ZIP64 format

**Example:**

```ts
const info = await zipWriter.addEntry({
  readable: dataStream,
  name: "test.txt",
});
console.log(
  `Wrote ${info.name}: ${info.uncompressedSize} bytes (compressed to ${info.compressedSize})`,
);
```

## Complete Example

```ts
import { ZipWriter } from "zip-writable";
import { createWriteStream } from "fs";
import { Writable } from "stream";

async function createZip() {
  const zipWriter = new ZipWriter();

  // Pipe output to file
  const fileStream = Writable.toWeb(createWriteStream("output.zip"));
  zipWriter.readable.pipeTo(fileStream);

  // Add a text file
  const data1 = new TextEncoder().encode("This is a readme");
  await zipWriter.addEntry({
    readable: new ReadableStream({
      start(controller) {
        controller.enqueue(data1);
        controller.close();
      },
    }),
    name: "readme.txt",
  });

  // Add files from URLs
  const imageResponse = await fetch("https://example.com/image.png");
  await zipWriter.addEntry({
    readable: imageResponse.body,
    name: "images/photo.png",
  });

  // Add a JSON file
  const data = { hello: "world" };
  const jsonData = new TextEncoder().encode(JSON.stringify(data, null, 2));
  await zipWriter.addEntry({
    readable: new ReadableStream({
      start(controller) {
        controller.enqueue(jsonData);
        controller.close();
      },
    }),
    name: "data.json",
  });

  // Wait for all entries and check results
  const entries = await zipWriter.entries();
  console.log(`Added ${entries.length} entries`);

  // Finalize the archive
  const result = await zipWriter.finalize();
  console.log(`Created archive: ${result.fileSize} bytes`);
}

createZip().catch(console.error);
```

## Browser Usage

```ts
// Create a ZIP and trigger download
const zipWriter = new ZipWriter();

// Add entries...
const data = new TextEncoder().encode("Hello");
await zipWriter.addEntry({
  readable: new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  }),
  name: "file.txt",
});
await zipWriter.finalize();

// Create download link
const blob = await new Response(zipWriter.readable).blob();
const url = URL.createObjectURL(blob);
const a = document.createElement("a");
a.href = url;
a.download = "archive.zip";
a.click();
URL.revokeObjectURL(url);
```

## Benchmarks

Run using `npm run bench`. On a MacBook Pro (M2 Pro, 2023), Node.js 20.19.0:

### Small files (10 × 10KB)

| Library                       | ops/sec | Relative Speed |
| ----------------------------- | ------- | -------------- |
| zip-writable (@node-rs/crc32) | 721.94  | **fastest**    |
| zip-writable                  | 674.57  | 1.07x slower   |
| zip-writable (js crc32)       | 659.90  | 1.09x slower   |
| fflate                        | 553.00  | 1.31x slower   |
| archiver                      | 338.14  | 2.14x slower   |
| @zip.js/zip.js                | 279.19  | 2.59x slower   |

### Medium files (100 × 100KB)

| Library                       | ops/sec | Relative Speed |
| ----------------------------- | ------- | -------------- |
| zip-writable                  | 23.91   | **fastest**    |
| zip-writable (@node-rs/crc32) | 22.91   | 1.04x slower   |
| zip-writable (js crc32)       | 18.93   | 1.26x slower   |
| archiver                      | 18.10   | 1.32x slower   |
| @zip.js/zip.js                | 11.65   | 2.05x slower   |
| fflate                        | 10.27   | 2.33x slower   |

### Large files (5 × 10MB)

| Library                       | ops/sec | Relative Speed |
| ----------------------------- | ------- | -------------- |
| zip-writable                  | 7.22    | **fastest**    |
| zip-writable (@node-rs/crc32) | 6.78    | 1.06x slower   |
| archiver                      | 5.65    | 1.28x slower   |
| zip-writable (js crc32)       | 4.82    | 1.50x slower   |
| fflate                        | 4.20    | 1.72x slower   |
| @zip.js/zip.js                | 4.00    | 1.81x slower   |

### Many files (1000 × 1KB)

| Library                       | ops/sec | Relative Speed |
| ----------------------------- | ------- | -------------- |
| fflate                        | 10.08   | **fastest**    |
| zip-writable                  | 6.89    | 1.46x slower   |
| zip-writable (@node-rs/crc32) | 5.94    | 1.70x slower   |
| zip-writable (js crc32)       | 5.63    | 1.79x slower   |
| archiver                      | 4.98    | 2.02x slower   |
| @zip.js/zip.js                | 2.93    | 3.44x slower   |

Note: These benchmarks vary quite a bit, and they aren't an indication that any
library is "better" than any other. For ZipWriter, these exist as a check to
ensure that performance isn't significantly worse than other libraries.

## ZIP64 Support

The library automatically uses ZIP64 format when needed:

- Archives with more than 65,535 entries
- Files larger than 4GB
- Central directory larger than 4GB
- Central directory offset greater than 4GB

No special configuration is needed - it's handled automatically.

## Error Handling

```ts
try {
  await zipWriter.addEntry({ readable: someStream, name: "test.txt" });
} catch (error) {
  console.error("Failed to write entry:", error);
  // The ZIP stream is aborted on error - cannot add more entries
}
```

Once an error occurs during entry writing, the ZIP stream is in the errored
state and cannot be recovered. You must create a new `ZipWriter` instance.

## License

MIT
