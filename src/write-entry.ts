import type {
  EntryInfoStandard,
  EntryInfoZip64,
  EntryOptions,
} from "./index.js";
import {
  LOCAL_FILE_HEADER_SIGNATURE,
  DATA_DESCRIPTOR_SIGNATURE,
  VERSION_NEEDED_STANDARD,
  GENERAL_PURPOSE_FLAGS,
  COMPRESSION_METHOD_STORE,
  COMPRESSION_METHOD_DEFLATE,
  LOCAL_FILE_HEADER_SIZE,
  ZIP64_LIMIT,
  DATA_DESCRIPTOR_SIZE,
  DATA_DESCRIPTOR_SIZE_ZIP64,
} from "./constants.js";
import { getDosTime, getDosDate } from "./utils.js";
import { CRC32 } from "./crc.js";

const textEncoder = new TextEncoder();

/**
 * Write a zip entry to the given writer from the given reader.
 */
export async function writeZipEntry({
  writer,
  reader,
  entryOptions,
  startOffset,
}: {
  /** Writer for the zip archive */
  writer: WritableStreamDefaultWriter<Uint8Array<ArrayBuffer>>;
  /** Reader for the entry data */
  reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
  /** Options for the zip entry */
  entryOptions: EntryOptions;
  /** Offset in the zip archive where this entry starts */
  startOffset: bigint;
}) {
  let uncompressedSize = BigInt(0);
  let compressedSize = BigInt(0);
  const crc = new CRC32();

  await writer.write(getLocalFileHeader(entryOptions));

  if (entryOptions.store) {
    // Store mode: no compression, direct copy
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const byteLength = BigInt(value.byteLength);
      uncompressedSize += byteLength;
      compressedSize += byteLength;
      crc.update(value);
      await writer.write(value);
    }
  } else {
    // Deflate mode: manual reader/writer loops to minimize overhead
    const compressionStream = new CompressionStream("deflate-raw");
    const compressionWriter = compressionStream.writable.getWriter();
    const compressionReader = compressionStream.readable.getReader();

    const writePromise = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          uncompressedSize += BigInt(value.byteLength);
          crc.update(value);
          await compressionWriter.write(value);
        }
        await compressionWriter.close();
      } catch (err) {
        await compressionWriter.abort(err);
        throw err;
      }
    })();

    const readPromise = (async () => {
      try {
        while (true) {
          const { value, done } = await compressionReader.read();
          if (done) break;
          compressedSize += BigInt(value.byteLength);
          await writer.write(value);
        }
        compressionReader.releaseLock();
      } catch (err) {
        await compressionReader.cancel(err);
        throw err;
      }
    })();

    await Promise.all([writePromise, readPromise]);
  }

  const needsZip64 =
    uncompressedSize > ZIP64_LIMIT ||
    compressedSize > ZIP64_LIMIT ||
    startOffset > ZIP64_LIMIT;

  if (needsZip64) {
    const entryInfo: EntryInfoZip64 = {
      ...entryOptions,
      startOffset,
      crc32: crc.digest(),
      uncompressedSize,
      compressedSize,
      zip64: true,
    };
    await writer.write(getDataDescriptorZip64(entryInfo));
    return entryInfo;
  } else {
    const entryInfo: EntryInfoStandard = {
      ...entryOptions,
      startOffset: Number(startOffset),
      crc32: crc.digest(),
      uncompressedSize: Number(uncompressedSize),
      compressedSize: Number(compressedSize),
      zip64: false,
    };
    await writer.write(getDataDescriptorStandard(entryInfo));
    return entryInfo;
  }
}

export function getLocalFileHeader(
  options: EntryOptions
): Uint8Array<ArrayBuffer> {
  const nameBytes = textEncoder.encode(options.name);

  const headerSize = LOCAL_FILE_HEADER_SIZE + nameBytes.length;
  const header = new Uint8Array(headerSize);
  const view = new DataView(header.buffer);

  let offset = 0;

  // Local file header signature
  view.setUint32(offset, LOCAL_FILE_HEADER_SIGNATURE);
  offset += 4;

  // Version needed to extract
  view.setUint16(offset, VERSION_NEEDED_STANDARD);
  offset += 2;

  // General purpose bit flag
  view.setUint16(offset, GENERAL_PURPOSE_FLAGS);
  offset += 2;

  // Compression method
  view.setUint16(
    offset,
    options.store ? COMPRESSION_METHOD_STORE : COMPRESSION_METHOD_DEFLATE,
    true
  );
  offset += 2;

  // Last mod file time & date (MS-DOS format)
  const date = options.date || new Date();
  view.setUint16(offset, getDosTime(date), true);
  offset += 2;
  view.setUint16(offset, getDosDate(date), true);
  offset += 2;

  // CRC-32 (0 when using data descriptor)
  view.setUint32(offset, 0, true);
  offset += 4;

  // Compressed size (0 when using data descriptor)
  view.setUint32(offset, 0, true);
  offset += 4;

  // Uncompressed size (0 when using data descriptor)
  view.setUint32(offset, 0, true);
  offset += 4;

  // File name length
  view.setUint16(offset, nameBytes.length, true);
  offset += 2;

  // Extra field length
  view.setUint16(offset, 0, true);
  offset += 2;

  // File name
  header.set(nameBytes, offset);

  return header;
}

export function getDataDescriptorStandard(entryInfo: {
  uncompressedSize: number;
  compressedSize: number;
}): Uint8Array<ArrayBuffer> {
  const descriptor = new Uint8Array(DATA_DESCRIPTOR_SIZE);
  const view = new DataView(descriptor.buffer);

  let offset = 0;

  // Data descriptor signature
  view.setUint32(offset, DATA_DESCRIPTOR_SIGNATURE);
  offset += 4;

  // CRC-32 (TODO: implement CRC calculation)
  view.setUint32(offset, 0, true);
  offset += 4;

  // Compressed size (4 bytes)
  view.setUint32(offset, entryInfo.compressedSize, true);
  offset += 4;

  // Uncompressed size (4 bytes)
  view.setUint32(offset, entryInfo.uncompressedSize, true);
  offset += 4;

  return descriptor;
}

export function getDataDescriptorZip64(entryInfo: {
  uncompressedSize: bigint;
  compressedSize: bigint;
}): Uint8Array<ArrayBuffer> {
  const descriptor = new Uint8Array(DATA_DESCRIPTOR_SIZE_ZIP64);
  const view = new DataView(descriptor.buffer);

  let offset = 0;

  // Data descriptor signature
  view.setUint32(offset, DATA_DESCRIPTOR_SIGNATURE);
  offset += 4;

  // CRC-32 (TODO: implement CRC calculation)
  view.setUint32(offset, 0, true);
  offset += 4;

  // Compressed size (8 bytes for ZIP64)
  view.setBigUint64(offset, entryInfo.compressedSize, true);
  offset += 8;

  // Uncompressed size (8 bytes for ZIP64)
  view.setBigUint64(offset, entryInfo.uncompressedSize, true);
  offset += 8;

  return descriptor;
}
