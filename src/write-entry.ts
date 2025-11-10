import type { EntryOptionsInternal } from "./index.js";
import {
  LOCAL_FILE_HEADER_SIGNATURE,
  DATA_DESCRIPTOR_SIGNATURE,
  VERSION_NEEDED_STANDARD,
  GENERAL_PURPOSE_FLAGS,
  COMPRESSION_METHOD_STORE,
  COMPRESSION_METHOD_DEFLATE,
  LOCAL_FILE_HEADER_SIZE,
  DATA_DESCRIPTOR_SIZE,
  DATA_DESCRIPTOR_SIZE_ZIP64,
  LITTLE_ENDIAN,
  BIG_ENDIAN,
} from "./constants.js";
import {
  getDosTime,
  getDosDate,
  writeDataView,
  UINT16,
  UINT32,
  UINT64,
  entryNeedsZip64,
} from "./utils.js";

export function getLocalFileHeader(
  options: EntryOptionsInternal
): Uint8Array<ArrayBuffer> {
  const headerSize = LOCAL_FILE_HEADER_SIZE + options.nameBytes.length;
  const header = new Uint8Array(headerSize);
  const view = new DataView(header.buffer);
  const date = options.date || new Date();
  const compressionMethod = options.store
    ? COMPRESSION_METHOD_STORE
    : COMPRESSION_METHOD_DEFLATE;

  let offset = writeDataView(view, [
    // Local file header signature
    [UINT32, LOCAL_FILE_HEADER_SIGNATURE, BIG_ENDIAN],
    // Version needed to extract
    [UINT16, VERSION_NEEDED_STANDARD, LITTLE_ENDIAN],
    // General purpose bit flag
    [UINT16, GENERAL_PURPOSE_FLAGS, LITTLE_ENDIAN],
    // Compression method
    [UINT16, compressionMethod, LITTLE_ENDIAN],
    // Last mod file time & date (MS-DOS format)
    [UINT16, getDosTime(date), LITTLE_ENDIAN],
    [UINT16, getDosDate(date), LITTLE_ENDIAN],
    // CRC-32 (0 when using data descriptor)
    [UINT32, 0, LITTLE_ENDIAN],
    // Compressed size (0 when using data descriptor)
    [UINT32, 0, LITTLE_ENDIAN],
    // Uncompressed size (0 when using data descriptor)
    [UINT32, 0, LITTLE_ENDIAN],
    // File name length
    [UINT16, options.nameBytes.length, LITTLE_ENDIAN],
    // Extra field length
    [UINT16, 0, LITTLE_ENDIAN],
  ]);

  // File name
  header.set(options.nameBytes, offset);
  return header;
}

export function getDataDescriptor(entryInfo: {
  uncompressedSize: bigint;
  compressedSize: bigint;
  startOffset: bigint;
  crc32: number;
}): Uint8Array<ArrayBuffer> {
  const descriptor = new Uint8Array(DATA_DESCRIPTOR_SIZE_ZIP64);
  const view = new DataView(descriptor.buffer);

  const needsZip64 = entryNeedsZip64(entryInfo);

  writeDataView(view, [
    // Data descriptor signature
    [UINT32, DATA_DESCRIPTOR_SIGNATURE, BIG_ENDIAN],
    // CRC-32 (4 bytes)
    [UINT32, entryInfo.crc32, LITTLE_ENDIAN],
    // Compressed size (8 bytes)
    needsZip64
      ? [UINT64, entryInfo.compressedSize, LITTLE_ENDIAN]
      : [UINT32, Number(entryInfo.compressedSize), LITTLE_ENDIAN],
    // Uncompressed size (8 bytes)
    needsZip64
      ? [UINT64, entryInfo.uncompressedSize, LITTLE_ENDIAN]
      : [UINT32, Number(entryInfo.uncompressedSize), LITTLE_ENDIAN],
  ]);

  return descriptor;
}
