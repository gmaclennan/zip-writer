import {
  getDataDescriptorStandard,
  getDataDescriptorZip64,
  getLocalFileHeader,
} from "./write-entry.js";
import {
  getCDFH,
  getEOCDZip64,
  getEOCDStandard,
} from "./write-central-directory.js";
import { ZIP64_LIMIT } from "./constants.js";
import { noop, validateEntryOptions } from "./utils.js";
import { crc32 as crc32Default } from "#crc32";
import Mutex from "p-mutex";

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

export interface EntryOptionsInternal extends EntryOptions {
  /** Encoded entry name */
  nameBytes: Uint8Array;
  /** Encoded entry comment */
  commentBytes: Uint8Array;
}

export interface Entry extends EntryOptions {
  /** Readable stream of entry data */
  readable: ReadableStream<ArrayBufferView<ArrayBufferLike>>;
}

export interface EntryInfoZip64 extends EntryOptionsInternal {
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

export interface ZipInfo {
  /** Does the archive use ZIP64 format? */
  zip64: boolean;
  /** Total uncompressed size of all entries */
  uncompressedEntriesSize: bigint;
  /** Total compressed size of all entries */
  compressedEntriesSize: bigint;
  /** Total size of the ZIP file */
  fileSize: bigint;
}

export type EntryInfoStandard = {
  [K in keyof EntryInfoZip64]: EntryInfoZip64[K] extends bigint
    ? number
    : K extends "zip64"
      ? false
      : EntryInfoZip64[K];
};

export type EntryInfoInternal = EntryInfoZip64 | EntryInfoStandard;

type OmitUnion<T, U extends keyof T> = T extends U ? never : Omit<T, U>;

export type EntryInfo = OmitUnion<
  EntryInfoInternal,
  "nameBytes" | "commentBytes"
>;

const textEncoder = new TextEncoder();

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
  #entries: EntryInfoInternal[] = [];
  #crc32;
  #mutex = new Mutex();
  #finalized = false;

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

  /**
   * Get an array of entry information for all entries added so far to the ZIP archive.
   */
  entries(): Promise<EntryInfo[]> {
    return this.#mutex.withLock(() =>
      this.#entries.map((entry) => {
        const { nameBytes, commentBytes, ...publicEntryInfo } = entry;
        return publicEntryInfo;
      })
    );
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
  addEntry({ readable, ...entryOptions }: Entry): Promise<EntryInfo> {
    if (this.#finalized) {
      throw new TypeError("Cannot add entry after finalize() has been called");
    }
    // Encode now to catch range errors synchronously
    const entryOptionsInternal: EntryOptionsInternal = {
      ...entryOptions,
      nameBytes: textEncoder.encode(entryOptions.name),
      commentBytes: entryOptions.comment
        ? textEncoder.encode(entryOptions.comment)
        : new Uint8Array(),
    };
    validateEntryOptions(entryOptionsInternal);
    const entryInfoPromise = this.#mutex.withLock(async () => {
      // -- Write local file header --
      let writer = this.#zipStream.writable.getWriter();
      await writer.ready;
      const startOffset = this.#offset;
      try {
        // This is in a try...catch because if writing the local file header
        // fails, we want to abort the output zip readable stream.
        await writer.write(getLocalFileHeader(entryOptionsInternal));
        // Await all data has been written before we releaseLock and read the offset
        await writer.ready;
      } catch (err) {
        // Let the readable size know we are no longer consuming data
        /* istanbul ignore next -- @preserve */
        readable.cancel(err);
        // Put the zip stream writable into an error state, which will propogate
        // to the readable side and anything consuming it
        /* istanbul ignore next -- @preserve */
        await writer.abort(err);
        /* istanbul ignore next -- @preserve */
        writer.releaseLock();
        /* istanbul ignore next -- @preserve */
        throw err;
      }

      writer.releaseLock();
      const fileStartOffset = this.#offset;

      // -- Write file data --
      let uncompressedSize = BigInt(0);
      let checksum = 0;
      const crcAndSizeStream = new TransformStream({
        transform: async (chunk, controller) => {
          const byteLength = BigInt(chunk.byteLength);
          uncompressedSize += byteLength;
          checksum = this.#crc32(chunk, checksum);
          controller.enqueue(chunk);
        },
      });
      const compressionStream = entryOptions.store
        ? new TransformStream()
        : new CompressionStream("deflate-raw");
      await readable
        .pipeThrough(crcAndSizeStream)
        .pipeThrough(compressionStream)
        .pipeTo(this.#zipStream.writable, { preventClose: true });

      // -- Write data descriptor --
      writer = this.#zipStream.writable.getWriter();
      // Await here to ensure all data has been written, so we know this.#offset is accurate
      await writer.ready;
      const compressedSize = this.#offset - fileStartOffset;
      const needsZip64 =
        uncompressedSize > ZIP64_LIMIT ||
        compressedSize > ZIP64_LIMIT ||
        startOffset > ZIP64_LIMIT;
      let entryInfo: EntryInfoInternal;
      try {
        // This is in a try...catch because writing the data descriptor could fail,
        // and we want to abort the output zip readable stream if that happens.
        if (needsZip64) {
          entryInfo = {
            ...entryOptionsInternal,
            startOffset,
            crc32: checksum,
            uncompressedSize,
            compressedSize,
            zip64: true,
          };
          await writer.write(getDataDescriptorZip64(entryInfo));
        } else {
          entryInfo = {
            ...entryOptionsInternal,
            startOffset: Number(startOffset),
            crc32: checksum,
            uncompressedSize: Number(uncompressedSize),
            compressedSize: Number(compressedSize),
            zip64: false,
          };
          await writer.write(getDataDescriptorStandard(entryInfo));
        }
      } catch (err) {
        /* istanbul ignore next -- @preserve */
        await writer.abort(err);
        /* istanbul ignore next -- @preserve */
        writer.releaseLock();
        // The readable has already been fully consumed at this point, so no need to cancel it
        /* istanbul ignore next -- @preserve */
        throw err;
      }
      writer.releaseLock();
      this.#entries.push(entryInfo);
      // Clone to avoid mutation affecting our internal state
      const { nameBytes, commentBytes, ...publicEntryInfo } = entryInfo;
      return publicEntryInfo;
    });
    // Avoid an uncaught rejection if the user doesn't await entryInfoPromise
    // - error handling can be done on the readable stream
    entryInfoPromise.catch(noop);
    return entryInfoPromise;
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
    this.#entries = entries.map((entry) => ({
      ...entry,
      nameBytes: textEncoder.encode(entry.name),
      commentBytes: entry.comment
        ? textEncoder.encode(entry.comment)
        : new Uint8Array(0),
    }));
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
  finalize({ entries }: { entries?: EntryInfo[] } = {}): Promise<ZipInfo> {
    if (this.#finalized) {
      throw new TypeError("finalize() has already been called");
    }
    this.#finalized = true;
    const zipInfoPromise = this.#mutex.withLock(async () => {
      if (entries) {
        try {
          this.#setEntries(entries);
        } catch (err) {
          // If setting entries fails, we still want to finalize the zip stream
          // so that consumers don't hang waiting for data that will never come.
          this.#zipStream.writable.abort(err);
          throw err;
        }
      }
      // Write central directory headers for all entries
      const writer = this.#zipStream.writable.getWriter();
      await writer.ready;
      const centralDirectoryStart = this.#offset;

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
          await writer.ready;
          await writer.write(getCDFH(entry));
        }

        await writer.ready;
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
    });
    // Avoid an uncaught rejection if the user doesn't await finalize() - error
    // handling can be done on the readable stream
    zipInfoPromise.catch(noop);
    return zipInfoPromise;
  }
}
