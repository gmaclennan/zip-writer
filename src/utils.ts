import { ZIP64_LIMIT } from "./constants.js";
import type {
  EntryInfo,
  EntryInfoInternal,
  EntryInfoStandard,
  EntryInfoZip64,
} from "./types.js";

export function getDosTime(date: Date): number {
  return (
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (date.getSeconds() >> 1)
  );
}

export function getDosDate(date: Date): number {
  return (
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  );
}

export function noop() {}

/**
 * Validates EntryOptions to ensure they are within the limits of our encoding.
 * Throws an error if any field exceeds the maximum allowed size.
 */
export function validateEntryOptions({
  nameBytes,
  commentBytes,
  mode,
}: {
  nameBytes: Uint8Array;
  commentBytes: Uint8Array;
  mode?: number;
}): void {
  // Validate name
  if (nameBytes.length > 0xffff) {
    throw new RangeError(
      `File name exceeds maximum length of 65535 bytes (got ${nameBytes.length} bytes)`
    );
  }

  // Validate comment
  if (commentBytes.length > 0xffff) {
    throw new RangeError(
      `File comment exceeds maximum length of 65535 bytes (got ${commentBytes.length} bytes)`
    );
  }

  // Validate mode (Unix file mode is 16 bits, stored in upper 16 bits of external attributes)
  if (mode !== undefined) {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0xffff) {
      throw new RangeError(
        `File mode must be an integer between 0 and 65535 (got ${mode})`
      );
    }
  }
}

type DataViewValue<T extends keyof typeof OFFSETS = keyof typeof OFFSETS> =
  T extends "setBigUint64" ? [T, bigint, boolean] : [T, number, boolean];

export const UINT16 = "setUint16";
export const UINT32 = "setUint32";
export const UINT64 = "setBigUint64";
type Ints = typeof UINT16 | typeof UINT32 | typeof UINT64;

const OFFSETS = {
  setUint16: 2,
  setUint32: 4,
  setBigUint64: 8,
} satisfies Record<Ints, number>;

export function writeDataView(
  view: DataView,
  values: DataViewValue[],
  offset: number = 0
): number {
  for (const [method, value, littleEndian] of values) {
    // @ts-expect-error
    view[method](offset, value, littleEndian);
    offset += OFFSETS[method];
  }
  return offset;
}

export function entryNeedsZip64({
  uncompressedSize,
  compressedSize,
  startOffset,
}: Pick<
  EntryInfoInternal,
  "uncompressedSize" | "compressedSize" | "startOffset"
>): boolean {
  return (
    uncompressedSize >= ZIP64_LIMIT ||
    compressedSize >= ZIP64_LIMIT ||
    startOffset >= ZIP64_LIMIT
  );
}

export function eocdNeedsZip64(options: {
  centralDirectoryStart: bigint;
  centralDirectorySize: bigint;
  entriesCount: number;
}): boolean {
  return (
    options.centralDirectoryStart >= ZIP64_LIMIT ||
    options.centralDirectorySize >= ZIP64_LIMIT ||
    options.entriesCount >= 0xffff
  );
}

export function getPublicEntryInfo(entryInfo: EntryInfoInternal): EntryInfo {
  const { nameBytes, commentBytes, ...rest } = entryInfo;
  if (rest.zip64) {
    return {
      ...rest,
      zip64: true,
    } satisfies EntryInfoZip64;
  } else {
    return {
      ...rest,
      zip64: false,
      uncompressedSize: Number(rest.uncompressedSize),
      compressedSize: Number(rest.compressedSize),
      startOffset: Number(rest.startOffset),
    } satisfies EntryInfoStandard;
  }
}
