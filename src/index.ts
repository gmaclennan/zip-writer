import { writeZipEntry } from "./write-entry.js";
import {
  getCDFH,
  getEOCDZip64,
  getEOCDStandard,
} from "./write-central-directory.js";
import { ZIP64_LIMIT } from "./constants.js";
import { noop } from "./utils.js";
import { crc32 as crc32Default } from "#crc32";

const BUFFER_SIZE = 16 * 1024; // 16 KB
const bufferedQueue = new ByteLengthQueuingStrategy({
  highWaterMark: BUFFER_SIZE,
});

export interface EntryOptions {
  /** Entry name including internal path */
  name: string;
  /** Entry comment */
  comment?: string;
  /** Entry date */
  date?: Date;
  /** Entry permissions */
  mode?: number;
  /** Compression method to `STORE` (defaults to `DEFLATE`) */
  store?: boolean;
}

export interface EntryInfoZip64 extends EntryOptions {
  /** Byte offset of the local file header within the ZIP archive */
  startOffset: bigint;
  /** CRC32 checksum of the uncompressed data */
  crc32: number;
  /** Uncompressed size in bytes */
  uncompressedSize: bigint;
  /** Compressed size in bytes */
  compressedSize: bigint;
  /** Entry information is in ZIP64 format */
  zip64: true;
}

export type EntryInfoStandard = {
  [K in keyof EntryInfoZip64]: EntryInfoZip64[K] extends bigint
    ? number
    : K extends "zip64"
      ? false
      : EntryInfoZip64[K];
};

export type EntryInfo = EntryInfoZip64 | EntryInfoStandard;

export class ZipWriter<TIsZip64 extends boolean = false> {
  #offset = BigInt(0);
  #zipStream = new TransformStream(
    {
      transform: (chunk, controller) => {
        controller.enqueue(chunk);
        this.#offset += BigInt(chunk.byteLength);
      },
    },
    // default buffer on the writable side, we already queue entries
    bufferedQueue,
    // Readable buffer, so that temporary delays on writable consumers don't
    // block the zip writing.
    bufferedQueue
  );
  #entries: EntryInfo[] = [];
  #queued: Promise<unknown> = Promise.resolve();
  #entryCount = 0;
  #finalized = false;
  #crc32;

  /**
   * @param crc Optional CRC32 function to use. Defaults to zlib.crc32 on Node and a pure JS implementation in browsers.
   */
  constructor({
    crc32 = crc32Default,
  }: {
    crc32?: (data: Uint8Array<ArrayBuffer>, value?: number) => number;
  } = {}) {
    this.#crc32 = crc32;
  }

  get readable() {
    return this.#zipStream.readable;
  }

  get entries(): ReadonlyArray<Readonly<EntryInfo>> {
    return this.#entries;
  }

  /**
   * Wait until all currently queued entries have been written.
   */
  async onceQueueEmpty(): Promise<void> {
    while (this.#entries.length < this.#entryCount) {
      await this.#queued;
    }
  }

  /**
   * Convenience wrapper around `createEntryStream` to write all data at once.
   * Use `createEntryStream` for more efficient streaming writes. Calls to
   * createEntry() will be queued internally and each will resolve once it's
   * written to the archive.
   *
   * @example
   * ```ts
   * const data = new TextEncoder().encode("Hello, World!");
   * const entryInfo = await zipWriter.createEntry(data, { name: "hello.txt" });
   * console.log(entryInfo);
   * ```
   *
   * @param data Entry data
   * @param options Entry filename, comment, compression method, etc.
   * @returns Entry information once the entry has been written.
   */
  async createEntry(data: Uint8Array<ArrayBuffer>, options: EntryOptions) {
    const entryWriter = this.createEntryStream(options);
    const writer = entryWriter.writable.getWriter();
    try {
      await writer.write(data);
    } finally {
      await writer.close();
    }
    return entryWriter.getEntryInfo();
  }

  /**
   * Create a new entry in the Zip archive. Use the returned
   * entryWriter.writable to write data to the entry. You can await
   * entryWriter.getEntryInfo() to get the entry info once all data has been written.
   *
   * @example
   * ```ts
   * const response = await fetch(imageUrl);
   * response.body!.pipeTo(
   *   zipWriter.entry({ name: "path/to/file.png" }).writable
   * );
   * ```
   *
   * @example
   * ```ts
   * const entryWriter = zipWriter.entry({ name: "hello.txt" });
   * const writer = entryWriter.writable.getWriter();
   * await writer.write(
   *   new TextEncoder().encode("Hello, World!")
   * );
   * await writer.close();
   * console.log(await entryWriter.getEntryInfo()); // Entry info
   * ```
   *
   * @param options Entry options
   */
  createEntryStream(options: EntryOptions) {
    if (this.#finalized) {
      throw new TypeError("Cannot add entry after finalize() has been called");
    }
    this.#entryCount++;

    // Capture the previous queue position
    const prevQueued = this.#queued;

    // Create a promise that will be resolved when this entry completes
    let entryDone: () => void;
    let entryError: (reason: unknown) => void;
    this.#queued = new Promise<void>((resolve, reject) => {
      entryDone = resolve;
      entryError = reject;
    });
    // prevent unhandled rejection, but we still want this.#queued to reject
    // when awaited if there's an error
    this.#queued.catch(noop);

    return new EntryWriter(async (readable) => {
      // Wait for previous entry to complete
      await prevQueued;

      const writer = this.#zipStream.writable.getWriter();
      const reader = readable.getReader();
      try {
        const entryInfo = await writeZipEntry({
          crc32: this.#crc32,
          writer,
          reader,
          entryOptions: options,
          startOffset: this.#offset,
        });
        this.#entries.push(entryInfo);
        entryDone();
        return entryInfo;
      } catch (err) {
        entryError(err);
        await reader.cancel(err);
        // Abort the zip stream - it's corrupted after a partial entry write
        this.#zipStream.writable.abort(err);
        // Don't call entryDone() - leave subsequent entries waiting forever
        // since the zip stream is corrupted
        // This error is handled in the EntryWriter constructor, and used to
        // abort the entry writable stream
        throw err;
      } finally {
        reader.releaseLock();
        writer.releaseLock();
      }
    });
  }

  /**
   * Set the entries of the Zip archive. This can be used to reorder,
   * remove, or rename entries before finalizing the archive.
   *
   * @param entries New entries array
   */
  #setEntries(entries: ReadonlyArray<Readonly<EntryInfo>>) {
    const currentEntriesByOffset = new Map<bigint, EntryInfo>();
    for (const entry of this.#entries) {
      currentEntriesByOffset.set(BigInt(entry.startOffset), entry);
    }
    // Entries can't have their offset, crc32, compressed size, or uncompressed
    // size changed, but they can be removed, reordered, or have the name and
    // comment changed.
    for (const entry of entries) {
      const existingEntry = currentEntriesByOffset.get(
        BigInt(entry.startOffset)
      );
      if (!existingEntry) {
        throw new Error(
          `Cannot set entries: entry at offset ${entry.startOffset} does not exist`
        );
      }
      if (existingEntry.crc32 !== entry.crc32) {
        throw new Error(
          `Cannot set entries: entry at offset ${entry.startOffset} has different CRC32`
        );
      }
      if (existingEntry.uncompressedSize !== entry.uncompressedSize) {
        throw new Error(
          `Cannot set entries: entry at offset ${entry.startOffset} has different uncompressed size`
        );
      }
      if (existingEntry.compressedSize !== entry.compressedSize) {
        throw new Error(
          `Cannot set entries: entry at offset ${entry.startOffset} has different compressed size`
        );
      }
    }
    this.#entries = entries.map((entry) => ({ ...entry }));
  }

  /**
   * Finalize the ZIP archive by writing the central directory and end of
   * central directory records. You may not add any more entries after calling
   * this method. This will await any pending entries to finish writing before
   * finalizing.
   *
   * @param options.entries (Advanced) Optionally override the entries to write
   * in the central directory. This can be used to reorder, remove, or rename
   * entries before finalizing the archive, however you cannot add invalid
   * entries, add additional entries, or modify their crc32, offsets or sizes.
   * Use zipWriter.entries or entryWriter.getEntryInfo() to get the current
   * entries for sorting or filtering.
   *
   * @returns Information about the finalized archive.
   */
  async finalize({
    entries,
  }: { entries?: ReadonlyArray<Readonly<EntryInfo>> } = {}): Promise<{
    /** Does the archive use ZIP64 format? */
    zip64: boolean;
    /** Total uncompressed size of all entries */
    uncompressedEntriesSize: bigint;
    /** Total compressed size of all entries */
    compressedEntriesSize: bigint;
    /** Total size of the ZIP file */
    fileSize: bigint;
  }> {
    if (this.#finalized) {
      throw new TypeError("finalize() has already been called");
    }
    this.#finalized = true;
    if (entries) {
      this.#setEntries(entries);
    }

    // We do this as an IIFE to avoid an unhandled error, so that a user can
    // call finalize() without needing to await and catch an error. Any error
    // will be propagated to the stream output, but the user can optionally
    // await finalize() to also see the error.
    const finalizePromise = (async () => {
      await this.onceQueueEmpty();

      // Write central directory headers for all entries
      const centralDirectoryStart = this.#offset;
      const writer = this.#zipStream.writable.getWriter();

      try {
        let entryUsesZip64 = false;
        let uncompressedEntriesSize = BigInt(0);
        let compressedEntriesSize = BigInt(0);
        for (const entry of this.#entries) {
          if (entry.zip64) {
            entryUsesZip64 = true;
          }
          uncompressedEntriesSize += BigInt(entry.uncompressedSize);
          compressedEntriesSize += BigInt(entry.compressedSize);
          await writer.write(getCDFH(entry));
        }

        const centralDirectorySize = this.#offset - centralDirectoryStart;

        // Determine if the archive needs ZIP64 based on entries or central directory
        const eocdNeedsZip64 =
          this.#entries.length > 0xffff ||
          centralDirectoryStart > ZIP64_LIMIT ||
          centralDirectorySize > ZIP64_LIMIT;

        let eocd: Uint8Array<ArrayBuffer>;
        if (eocdNeedsZip64) {
          eocd = getEOCDZip64(
            BigInt(this.#entries.length),
            centralDirectoryStart,
            centralDirectorySize
          );
        } else {
          eocd = getEOCDStandard(
            this.#entries.length,
            Number(centralDirectoryStart),
            Number(centralDirectorySize)
          );
        }

        await writer.write(eocd);

        // Close the zip stream
        await writer.close();

        return {
          zip64: eocdNeedsZip64 || entryUsesZip64,
          uncompressedEntriesSize,
          compressedEntriesSize,
          fileSize: this.#offset,
        };
      } catch (err) {
        await writer.abort(err);
        throw err;
      } finally {
        writer.releaseLock();
      }
    })();
    finalizePromise.catch(noop); // prevent unhandled rejection
    return finalizePromise;
  }
}

class EntryWriter {
  #entryStream = new TransformStream<Uint8Array<ArrayBuffer>>(
    undefined,
    bufferedQueue,
    bufferedQueue
  );
  #written: Promise<EntryInfo>;

  /**
   * @param enqueueAndPipe Function that enqueues the entry data readable, pipes it to the Zip stream, and returns a promise that resolves to the entry info once done.
   */
  constructor(
    enqueueAndPipe: (
      readable: ReadableStream<Uint8Array<ArrayBuffer>>
    ) => Promise<EntryInfo>
  ) {
    // We could try to pass the zipstream writable to EntryWriter, but then
    // EntryWriter would not know when the entry has finished writing, and would
    // not have a way to get the entry info.
    this.#written = enqueueAndPipe(this.#entryStream.readable);
    // abort the writable quickly if there is an error, and ensure we don't
    // throw an uncaught error.
    this.#written.catch((reason) => {
      this.#entryStream.writable.abort(reason);
    });
  }

  /**
   * Writable stream to write entry data to.
   *
   * @example
   * ```ts
   * ReadableStream.from([new TextEncoder().encode("Hello, World!")])
   *   .pipeTo(entryWriter.writable);
   * ```
   */
  get writable() {
    return this.#entryStream.writable;
  }

  /**
   * Get entry info. Resolves once all data has been written to the Zip stream.
   */
  async getEntryInfo(): Promise<EntryInfo> {
    return this.#written;
  }
}
