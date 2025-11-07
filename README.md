# zip-writable

A modern streaming ZIP archive writer for JavaScript that uses the
[Web Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Streams_API)
and
[Compression Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API).

## Features

- **Streaming API** - Write ZIP archives using Web Streams
- **Memory efficient** - Process large files without loading them entirely into
  memory
- **ZIP64 support** - Automatic handling of large files and archives
- **Modern JavaScript** - Built with TypeScript, uses native Web Streams API
- **Flexible** - Reorder, rename, or remove entries before finalizing

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
const entryWriter = zipWriter.createEntryStream({ name: "hello.txt" });
const writer = entryWriter.writable.getWriter();
await writer.write(new TextEncoder().encode("Hello, World!"));
await writer.close();

// Get entry info after writing
const info = await entryWriter.getEntryInfo();
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

##### `entries: ReadonlyArray<Readonly<EntryInfo>>`

Array of all entries that have been written to the archive. Each entry contains
metadata like size, CRC32, compression info, etc.

#### Methods

##### `createEntry(data: Uint8Array, options: EntryOptions): Promise<EntryInfo>`

Convenience method to add a buffer as an entry to the zip archive. Returns a
promise that resolves to the entry info once written. For more efficient
streaming writes, use `createEntryStream()`.

**Parameters:**

- `data: Uint8Array` - Entry data to write
- `options.name: string` - Entry name including internal path (required)
- `options.comment?: string` - Entry comment
- `options.date?: Date` - Entry date (defaults to current date)
- `options.mode?: number` - Entry permissions (Unix-style mode)
- `options.store?: boolean` - Set to `true` to disable compression (defaults to
  `false`, using DEFLATE compression)

**Example:**

```ts
const data = new TextEncoder().encode("Hello, World!");
const entryInfo = await zipWriter.createEntry(data, { name: "hello.txt" });
console.log(entryInfo);
```

##### `createEntryStream(options: EntryOptions): EntryWriter`

Create a new entry in the ZIP archive. Returns an `EntryWriter` that you can
write data to via streams.

**Parameters:**

- `options.name: string` - Entry name including internal path (required)
- `options.comment?: string` - Entry comment
- `options.date?: Date` - Entry date (defaults to current date)
- `options.mode?: number` - Entry permissions (Unix-style mode)
- `options.store?: boolean` - Set to `true` to disable compression (defaults to
  `false`, using DEFLATE compression)

**Examples:**

```ts
// Simple text file
const entry = zipWriter.createEntryStream({ name: "readme.txt" });
const writer = entry.writable.getWriter();
await writer.write(new TextEncoder().encode("Hello!"));
await writer.close();

// Stream a fetch response
const response = await fetch(imageUrl);
response.body.pipeTo(
  zipWriter.createEntryStream({ name: "images/photo.jpg" }).writable,
);

// With custom date and permissions
zipWriter.createEntryStream({
  name: "script.sh",
  date: new Date("2024-01-01"),
  mode: 0o755, // executable
}).writable;

// Disable compression for already-compressed files
zipWriter.createEntryStream({
  name: "video.mp4",
  store: true, // no compression
}).writable;
```

##### `onceQueueEmpty(): Promise<void>`

Wait until all currently queued entries have been written. Useful when you need
to ensure entries are complete before continuing.

```ts
// Add multiple entries
zipWriter.createEntryStream({ name: "file1.txt" }).writable;
zipWriter.createEntryStream({ name: "file2.txt" }).writable;

// Wait for all to complete
await zipWriter.onceQueueEmpty();
console.log(`Wrote ${zipWriter.entries.length} entries`);
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
// Wait for all entries to be written
await zipWriter.onceQueueEmpty();

// Get current entries and modify them
const entries = [...zipWriter.entries];

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

### `EntryWriter`

Returned by `ZipWriter.createEntryStream()`. Provides a writable stream to write
entry data.

#### Properties

##### `writable: WritableStream<Uint8Array>`

The writable stream to write entry data to. Close this stream when done writing.

```ts
const entryWriter = zipWriter.createEntryStream({ name: "data.txt" });

// Using a writer
const writer = entryWriter.writable.getWriter();
await writer.write(new TextEncoder().encode("chunk 1"));
await writer.write(new TextEncoder().encode("chunk 2"));
await writer.close();

// Using pipeTo
someReadableStream.pipeTo(entryWriter.writable);
```

#### Methods

##### `getEntryInfo(): Promise<EntryInfo>`

Get entry info. Resolves once all data has been written to the ZIP stream.

**Returns `EntryInfo`:**

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

```ts
const entryWriter = zipWriter.createEntryStream({ name: "test.txt" });
await someStream.pipeTo(entryWriter.writable);

const info = await entryWriter.getEntryInfo();
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

  // Add a text file using createEntry
  const data1 = new TextEncoder().encode("This is a readme");
  await zipWriter.createEntry(data1, { name: "readme.txt" });

  // Add files from URLs using createEntryStream
  const imageResponse = await fetch("https://example.com/image.png");
  await imageResponse.body.pipeTo(
    zipWriter.createEntryStream({ name: "images/photo.png" }).writable,
  );

  // Add a JSON file using createEntry
  const data = { hello: "world" };
  const jsonData = new TextEncoder().encode(JSON.stringify(data, null, 2));
  await zipWriter.createEntry(jsonData, { name: "data.json" });

  // Wait for all entries and check results
  await zipWriter.onceQueueEmpty();
  console.log(`Added ${zipWriter.entries.length} entries`);

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
zipWriter
  .createEntry(data, { name: "file.txt" })
  .then(() => zipWriter.finalize());

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
  const entryWriter = zipWriter.entry({ name: "test.txt" });
  await someStream.pipeTo(entryWriter.writable);
  await entryWriter.getEntryInfo();
} catch (error) {
  console.error("Failed to write entry:", error);
  // The ZIP stream is aborted on error - cannot add more entries
}
```

Once an error occurs during entry writing, the ZIP stream is corrupted and
cannot be recovered. You must create a new `ZipWriter` instance.

## License

MIT
