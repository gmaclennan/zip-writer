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
} from "./constants.js";
import { getDosTime, getDosDate } from "./utils.js";

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

  const headerSize =
    CENTRAL_DIRECTORY_HEADER_SIZE + nameBytes.length + commentBytes.length;
  const header = new Uint8Array(headerSize);
  const view = new DataView(header.buffer);

  let offset = 0;

  // Central directory file header signature
  view.setUint32(offset, CENTRAL_DIRECTORY_SIGNATURE);
  offset += 4;

  // Version made by
  view.setUint16(offset, VERSION_MADE_BY, true);
  offset += 2;

  // Version needed to extract
  view.setUint16(offset, VERSION_NEEDED_STANDARD, true);
  offset += 2;

  // General purpose bit flag
  view.setUint16(offset, GENERAL_PURPOSE_FLAGS);
  offset += 2;

  // Compression method
  view.setUint16(
    offset,
    entryInfo.store ? COMPRESSION_METHOD_STORE : COMPRESSION_METHOD_DEFLATE,
    true
  );
  offset += 2;

  // Last mod file time & date
  const date = entryInfo.date || new Date();
  view.setUint16(offset, getDosTime(date), true);
  offset += 2;
  view.setUint16(offset, getDosDate(date), true);
  offset += 2;

  // CRC-32
  view.setUint32(offset, entryInfo.crc32, true);
  offset += 4;

  // Compressed size
  view.setUint32(offset, entryInfo.compressedSize, true);
  offset += 4;

  // Uncompressed size
  view.setUint32(offset, entryInfo.uncompressedSize, true);
  offset += 4;

  // File name length
  view.setUint16(offset, nameBytes.length, true);
  offset += 2;

  // Extra field length
  view.setUint16(offset, 0, true);
  offset += 2;

  // File comment length
  view.setUint16(offset, commentBytes.length, true);
  offset += 2;

  // Disk number start
  view.setUint16(offset, 0, true);
  offset += 2;

  // Internal file attributes
  view.setUint16(offset, 0, true);
  offset += 2;

  // External file attributes (Unix permissions if provided)
  const externalAttrs = entryInfo.mode ? entryInfo.mode << 16 : 0;
  view.setUint32(offset, externalAttrs, true);
  offset += 4;

  // Relative offset of local header
  view.setUint32(offset, entryInfo.startOffset, true);
  offset += 4;

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

  // Extra field for ZIP64
  const extraField = new Uint8Array(28); // ZIP64 extra field
  const extraView = new DataView(extraField.buffer);
  extraView.setUint16(0, 0x0001, true); // ZIP64 extra field tag
  extraView.setUint16(2, 24, true); // Size of extra field data (3x 8-byte fields)
  extraView.setBigUint64(4, entryInfo.uncompressedSize, true); // Original size
  extraView.setBigUint64(12, entryInfo.compressedSize, true); // Compressed size
  extraView.setBigUint64(20, entryInfo.startOffset, true); // Relative header offset

  const headerSize =
    CENTRAL_DIRECTORY_HEADER_SIZE +
    nameBytes.length +
    extraField.length +
    commentBytes.length;
  const header = new Uint8Array(headerSize);
  const view = new DataView(header.buffer);

  let offset = 0;

  // Central directory file header signature
  view.setUint32(offset, CENTRAL_DIRECTORY_SIGNATURE);
  offset += 4;

  // Version made by
  view.setUint16(offset, VERSION_MADE_BY, true);
  offset += 2;

  // Version needed to extract
  view.setUint16(offset, VERSION_NEEDED_ZIP64, true);
  offset += 2;

  // General purpose bit flag
  view.setUint16(offset, GENERAL_PURPOSE_FLAGS);
  offset += 2;

  // Compression method
  view.setUint16(
    offset,
    entryInfo.store ? COMPRESSION_METHOD_STORE : COMPRESSION_METHOD_DEFLATE,
    true
  );
  offset += 2;

  // Last mod file time & date
  const date = entryInfo.date || new Date();
  view.setUint16(offset, getDosTime(date), true);
  offset += 2;
  view.setUint16(offset, getDosDate(date), true);
  offset += 2;

  // CRC-32
  view.setUint32(offset, entryInfo.crc32, true);
  offset += 4;

  // Compressed size (0xFFFFFFFF for ZIP64)
  view.setUint32(offset, 0xffffffff, true);
  offset += 4;

  // Uncompressed size (0xFFFFFFFF for ZIP64)
  view.setUint32(offset, 0xffffffff, true);
  offset += 4;

  // File name length
  view.setUint16(offset, nameBytes.length, true);
  offset += 2;

  // Extra field length
  view.setUint16(offset, extraField.length, true);
  offset += 2;

  // File comment length
  view.setUint16(offset, commentBytes.length, true);
  offset += 2;

  // Disk number start
  view.setUint16(offset, 0, true);
  offset += 2;

  // Internal file attributes
  view.setUint16(offset, 0, true);
  offset += 2;

  // External file attributes (Unix permissions if provided)
  const externalAttrs = entryInfo.mode ? entryInfo.mode << 16 : 0;
  view.setUint32(offset, externalAttrs, true);
  offset += 4;

  // Relative offset of local header (0xFFFFFFFF for ZIP64)
  view.setUint32(offset, 0xffffffff, true);
  offset += 4;

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

  let offset = 0;

  // End of central dir signature
  view.setUint32(offset, END_OF_CENTRAL_DIR_SIGNATURE);
  offset += 4;

  // Number of this disk
  view.setUint16(offset, 0, true);
  offset += 2;

  // Disk where central directory starts
  view.setUint16(offset, 0, true);
  offset += 2;

  // Number of central directory records on this disk
  view.setUint16(offset, entriesCount, true);
  offset += 2;

  // Total number of central directory records
  view.setUint16(offset, entriesCount, true);
  offset += 2;

  // Size of central directory
  view.setUint32(offset, Number(centralDirectorySize), true);
  offset += 4;

  // Offset of start of central directory
  view.setUint32(offset, Number(centralDirectoryOffset), true);
  offset += 4;

  // ZIP file comment length
  view.setUint16(offset, 0, true);

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

  let offset = 0;

  // === ZIP64 End of Central Directory Record ===

  // Signature
  view.setUint32(offset, ZIP64_END_OF_CENTRAL_DIR_SIGNATURE);
  offset += 4;

  // Size of zip64 end of central directory record excluding the leading 12 bytes
  view.setBigUint64(offset, BigInt(EOCD64_SIZE - 12), true);
  offset += 8;

  // Version made by
  view.setUint16(offset, VERSION_MADE_BY, true);
  offset += 2;

  // Version needed to extract
  view.setUint16(offset, VERSION_NEEDED_ZIP64, true);
  offset += 2;

  // Number of this disk
  view.setUint32(offset, 0, true);
  offset += 4;

  // Disk where central directory starts
  view.setUint32(offset, 0, true);
  offset += 4;

  // Number of central directory records on this disk
  view.setBigUint64(offset, entriesCount, true);
  offset += 8;

  // Total number of central directory records
  view.setBigUint64(offset, entriesCount, true);
  offset += 8;

  // Size of central directory
  view.setBigUint64(offset, centralDirectorySize, true);
  offset += 8;

  // Offset of start of central directory
  view.setBigUint64(offset, centralDirectoryOffset, true);
  offset += 8;

  // === ZIP64 End of Central Directory Locator ===

  // Signature
  view.setUint32(offset, ZIP64_END_OF_CENTRAL_DIR_LOCATOR_SIGNATURE);
  offset += 4;

  // Number of the disk with the start of the zip64 end of central directory
  view.setUint32(offset, 0, true);
  offset += 4;

  // Relative offset of the zip64 end of central directory record
  view.setBigUint64(
    offset,
    centralDirectoryOffset + centralDirectorySize,
    true
  );
  offset += 8;

  // Total number of disks
  view.setUint32(offset, 1, true);
  offset += 4;

  // === Standard End of Central Directory Record ===

  // Signature
  view.setUint32(offset, END_OF_CENTRAL_DIR_SIGNATURE);
  offset += 4;

  // Number of this disk
  view.setUint16(offset, 0xffff, true);
  offset += 2;

  // Disk where central directory starts
  view.setUint16(offset, 0xffff, true);
  offset += 2;

  // Number of central directory records on this disk
  view.setUint16(offset, 0xffff, true);
  offset += 2;

  // Total number of central directory records
  view.setUint16(offset, 0xffff, true);
  offset += 2;

  // Size of central directory
  view.setUint32(offset, 0xffffffff, true);
  offset += 4;

  // Offset of start of central directory
  view.setUint32(offset, 0xffffffff, true);
  offset += 4;

  // ZIP file comment length
  view.setUint16(offset, 0, true);

  return buffer;
}
