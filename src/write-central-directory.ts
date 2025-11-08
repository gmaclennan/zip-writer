import type { EntryInfo, EntryInfoStandard, EntryInfoZip64 } from "./index.js";
import {
  CENTRAL_DIRECTORY_SIGNATURE,
  END_OF_CENTRAL_DIR_SIGNATURE,
  ZIP64_END_OF_CENTRAL_DIR_SIGNATURE,
  ZIP64_END_OF_CENTRAL_DIR_LOCATOR_SIGNATURE,
  VERSION_MADE_BY,
  VERSION_NEEDED_STANDARD,
  VERSION_NEEDED_ZIP64,
  GENERAL_PURPOSE_FLAGS,
  COMPRESSION_METHOD_STORE,
  COMPRESSION_METHOD_DEFLATE,
  ZIP64_LIMIT,
  CENTRAL_DIRECTORY_HEADER_SIZE,
  EOCD_SIZE,
  EOCD64_SIZE,
  EOCD64_LOCATOR_SIZE,
  BIG_ENDIAN,
  LITTLE_ENDIAN,
} from "./constants.js";
import {
  getDosTime,
  getDosDate,
  writeDataView,
  UINT16,
  UINT32,
  UINT64,
} from "./utils.js";

const textEncoder = new TextEncoder();

/**
 * Generate the Central Directory File Header for the given entry info.
 */
export function getCDFH(entryInfo: EntryInfo): Uint8Array<ArrayBuffer> {
  if (entryInfo.zip64) {
    return getCDFHZip64(entryInfo);
  } else {
    return getCDFHStandard(entryInfo);
  }
}

function getCDFHStandard(
  entryInfo: EntryInfoStandard
): Uint8Array<ArrayBuffer> {
  const nameBytes = textEncoder.encode(entryInfo.name);
  const commentBytes = entryInfo.comment
    ? textEncoder.encode(entryInfo.comment)
    : new Uint8Array(0);

  if (commentBytes.length > 0xffff) {
    throw new Error(
      `File comment exceeds maximum length of 65535 bytes (got ${commentBytes.length} bytes)`
    );
  }

  const headerSize =
    CENTRAL_DIRECTORY_HEADER_SIZE + nameBytes.length + commentBytes.length;
  const header = new Uint8Array(headerSize);
  const view = new DataView(header.buffer);
  const date = entryInfo.date || new Date();
  const externalAttrs = entryInfo.mode ? entryInfo.mode << 16 : 0;
  const compressionMethod = entryInfo.store
    ? COMPRESSION_METHOD_STORE
    : COMPRESSION_METHOD_DEFLATE;

  let offset = writeDataView(view, [
    // Central directory file header signature
    [UINT32, CENTRAL_DIRECTORY_SIGNATURE, BIG_ENDIAN],
    // Version made by
    [UINT16, VERSION_MADE_BY, LITTLE_ENDIAN],
    // Version needed to extract
    [UINT16, VERSION_NEEDED_STANDARD, LITTLE_ENDIAN],
    // General purpose bit flag
    [UINT16, GENERAL_PURPOSE_FLAGS, LITTLE_ENDIAN],
    // Compression method
    [UINT16, compressionMethod, LITTLE_ENDIAN],
    // Last mod file time & date
    [UINT16, getDosTime(date), LITTLE_ENDIAN],
    [UINT16, getDosDate(date), LITTLE_ENDIAN],
    // CRC-32
    [UINT32, entryInfo.crc32, LITTLE_ENDIAN],
    // Compressed size
    [UINT32, entryInfo.compressedSize, LITTLE_ENDIAN],
    // Uncompressed size
    [UINT32, entryInfo.uncompressedSize, LITTLE_ENDIAN],
    // File name length
    [UINT16, nameBytes.length, LITTLE_ENDIAN],
    // Extra field length
    [UINT16, 0, LITTLE_ENDIAN],
    // File comment length
    [UINT16, commentBytes.length, LITTLE_ENDIAN],
    // Disk number start
    [UINT16, 0, LITTLE_ENDIAN],
    // Internal file attributes
    [UINT16, 0, LITTLE_ENDIAN],
    // External file attributes (Unix permissions if provided)
    [UINT32, externalAttrs, LITTLE_ENDIAN],
    // Relative offset of local header
    [UINT32, entryInfo.startOffset, LITTLE_ENDIAN],
  ]);

  // File name
  header.set(nameBytes, offset);
  offset += nameBytes.length;

  // File comment
  if (commentBytes.length > 0) {
    header.set(commentBytes, offset);
  }

  return header;
}

function getCDFHZip64(entryInfo: EntryInfoZip64): Uint8Array<ArrayBuffer> {
  const nameBytes = textEncoder.encode(entryInfo.name);
  const commentBytes = entryInfo.comment
    ? textEncoder.encode(entryInfo.comment)
    : new Uint8Array(0);

  if (commentBytes.length > 0xffff) {
    throw new Error(
      `File comment exceeds maximum length of 65535 bytes (got ${commentBytes.length} bytes)`
    );
  }

  // Extra field for ZIP64
  const extraField = new Uint8Array(28); // ZIP64 extra field
  const extraView = new DataView(extraField.buffer);
  writeDataView(extraView, [
    // ZIP64 extra field tag
    [UINT16, 0x0001, LITTLE_ENDIAN],
    // Size of extra field data (3x 8-byte fields)
    [UINT16, 24, LITTLE_ENDIAN],
    // Original size
    [UINT64, entryInfo.uncompressedSize, LITTLE_ENDIAN],
    // Compressed size
    [UINT64, entryInfo.compressedSize, LITTLE_ENDIAN],
    // Relative header offset
    [UINT64, entryInfo.startOffset, LITTLE_ENDIAN],
  ]);

  const headerSize =
    CENTRAL_DIRECTORY_HEADER_SIZE +
    nameBytes.length +
    extraField.length +
    commentBytes.length;
  const header = new Uint8Array(headerSize);
  const view = new DataView(header.buffer);
  const compressionMethod = entryInfo.store
    ? COMPRESSION_METHOD_STORE
    : COMPRESSION_METHOD_DEFLATE;
  const date = entryInfo.date || new Date();
  const externalAttrs = entryInfo.mode ? entryInfo.mode << 16 : 0;

  let offset = writeDataView(view, [
    // Central directory file header signature
    [UINT32, CENTRAL_DIRECTORY_SIGNATURE, BIG_ENDIAN],
    // Version made by
    [UINT16, VERSION_MADE_BY, LITTLE_ENDIAN],
    // Version needed to extract
    [UINT16, VERSION_NEEDED_ZIP64, LITTLE_ENDIAN],
    // General purpose bit flag
    [UINT16, GENERAL_PURPOSE_FLAGS, LITTLE_ENDIAN],
    // Compression method
    [UINT16, compressionMethod, LITTLE_ENDIAN],
    // Last mod file time & date
    [UINT16, getDosTime(date), LITTLE_ENDIAN],
    [UINT16, getDosDate(date), LITTLE_ENDIAN],
    // CRC-32
    [UINT32, entryInfo.crc32, LITTLE_ENDIAN],
    // Compressed size (0xFFFFFFFF for ZIP64)
    [UINT32, 0xffffffff, LITTLE_ENDIAN],
    // Uncompressed size (0xFFFFFFFF for ZIP64)
    [UINT32, 0xffffffff, LITTLE_ENDIAN],
    // File name length
    [UINT16, nameBytes.length, LITTLE_ENDIAN],
    // Extra field length
    [UINT16, extraField.length, LITTLE_ENDIAN],
    // File comment length
    [UINT16, commentBytes.length, LITTLE_ENDIAN],
    // Disk number start
    [UINT16, 0, LITTLE_ENDIAN],
    // Internal file attributes
    [UINT16, 0, LITTLE_ENDIAN],
    // External file attributes (Unix permissions if provided)
    [UINT32, externalAttrs, LITTLE_ENDIAN],
    // Relative offset of local header (0xFFFFFFFF for ZIP64)
    [UINT32, 0xffffffff, LITTLE_ENDIAN],
  ]);

  // File name
  header.set(nameBytes, offset);
  offset += nameBytes.length;

  // Extra field
  header.set(extraField, offset);
  offset += extraField.length;

  // File comment
  if (commentBytes.length > 0) {
    header.set(commentBytes, offset);
  }

  return header;
}

/**
 * Generate the End of Central Directory record with zip64 support.
 */
export function getEOCDStandard(
  entriesCount: number,
  centralDirectoryOffset: number,
  centralDirectorySize: number
): Uint8Array<ArrayBuffer> {
  const eocd = new Uint8Array(EOCD_SIZE);
  const view = new DataView(eocd.buffer);

  writeDataView(view, [
    // End of central dir signature
    [UINT32, END_OF_CENTRAL_DIR_SIGNATURE, BIG_ENDIAN],
    // Number of this disk
    [UINT16, 0, LITTLE_ENDIAN],
    // Disk where central directory starts
    [UINT16, 0, LITTLE_ENDIAN],
    // Number of central directory records on this disk
    [UINT16, entriesCount, LITTLE_ENDIAN],
    // Total number of central directory records
    [UINT16, entriesCount, LITTLE_ENDIAN],
    // Size of central directory
    [UINT32, centralDirectorySize, LITTLE_ENDIAN],
    // Offset of start of central directory
    [UINT32, centralDirectoryOffset, LITTLE_ENDIAN],
    // ZIP file comment length
    [UINT16, 0, LITTLE_ENDIAN],
  ]);

  return eocd;
}

/**
 * Generate the ZIP64 End of Central Directory record.
 */
export function getEOCDZip64(
  entriesCount: bigint,
  centralDirectoryOffset: bigint,
  centralDirectorySize: bigint
): Uint8Array<ArrayBuffer> {
  const totalSize = EOCD64_SIZE + EOCD64_LOCATOR_SIZE + EOCD_SIZE;
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);

  let offset = writeDataView(view, [
    // === ZIP64 End of Central Directory Record ===

    // End of central dir signature
    [UINT32, ZIP64_END_OF_CENTRAL_DIR_SIGNATURE, BIG_ENDIAN],
    // Size of zip64 end of central directory record excluding the leading 12 bytes
    [UINT64, BigInt(EOCD64_SIZE - 12), LITTLE_ENDIAN],
    // Version made by
    [UINT16, VERSION_MADE_BY, LITTLE_ENDIAN],
    // Version needed to extract
    [UINT16, VERSION_NEEDED_ZIP64, LITTLE_ENDIAN],
    // Number of this disk
    [UINT32, 0, LITTLE_ENDIAN],
    // Disk where central directory starts
    [UINT32, 0, LITTLE_ENDIAN],
    // Number of central directory records on this disk
    [UINT64, entriesCount, LITTLE_ENDIAN],
    // Total number of central directory records
    [UINT64, entriesCount, LITTLE_ENDIAN],
    // Size of central directory
    [UINT64, centralDirectorySize, LITTLE_ENDIAN],
    // Offset of start of central directory
    [UINT64, centralDirectoryOffset, LITTLE_ENDIAN],

    // === ZIP64 End of Central Directory Locator ===

    // Zip64 end of central dir locator signature
    [UINT32, ZIP64_END_OF_CENTRAL_DIR_LOCATOR_SIGNATURE, BIG_ENDIAN],
    // Number of the disk with the start of the zip64 end of central directory
    [UINT32, 0, LITTLE_ENDIAN],
    // Relative offset of the zip64 end of central directory record
    [UINT64, centralDirectoryOffset + centralDirectorySize, LITTLE_ENDIAN],
    // Total number of disks
    [UINT32, 1, LITTLE_ENDIAN],

    // === Standard End of Central Directory Record ===

    // End of central dir signature
    [UINT32, END_OF_CENTRAL_DIR_SIGNATURE, BIG_ENDIAN],
    // Number of this disk
    [UINT16, 0, LITTLE_ENDIAN],
    // Disk where central directory starts
    [UINT16, 0, LITTLE_ENDIAN],
    // Number of central directory records on this disk
    [UINT16, 0xffff, LITTLE_ENDIAN],
    // Total number of central directory records
    [UINT16, 0xffff, LITTLE_ENDIAN],
    // Size of central directory
    [UINT32, 0xffffffff, LITTLE_ENDIAN],
    // Offset of start of central directory
    [UINT32, 0xffffffff, LITTLE_ENDIAN],
    // ZIP file comment length
    [UINT16, 0, LITTLE_ENDIAN],
  ]);

  return buffer;
}
