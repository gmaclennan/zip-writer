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

/** @private */
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

/** @private */
export interface EntryInfoInternal extends EntryOptionsInternal {
  /** Byte offset of the local file header within the ZIP archive */
  startOffset: bigint;
  /** CRC32 checksum of the uncompressed data */
  crc32: number;
  /** Uncompressed size in bytes */
  uncompressedSize: bigint;
  /** Compressed size in bytes */
  compressedSize: bigint;
  /** Entry information is in ZIP64 format */
  zip64: boolean;
}

type BigIntToNumber<T> = {
  [K in keyof T]: T[K] extends bigint
    ? number
    : K extends "zip64"
      ? false
      : T[K];
};

interface ZipInfoZip64 {
  /** Does the archive use ZIP64 format? */
  zip64: true;
  /** Total uncompressed size of all entries */
  uncompressedEntriesSize: bigint;
  /** Total compressed size of all entries */
  compressedEntriesSize: bigint;
  /** Total size of the ZIP file */
  fileSize: bigint;
}

export type ZipInfoStandard = BigIntToNumber<ZipInfoZip64>;

export type ZipInfo = ZipInfoZip64 | ZipInfoStandard;

export type EntryInfoZip64 = Omit<
  EntryInfoInternal,
  "nameBytes" | "commentBytes" | "zip64"
> & {
  zip64: true;
};

export type EntryInfoStandard = BigIntToNumber<EntryInfoZip64>;

export type EntryInfo = EntryInfoZip64 | EntryInfoStandard;
