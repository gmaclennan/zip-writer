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
} from "./utils.js";

const textEncoder = new TextEncoder();

/**
 * Write a zip entry to the given writer from the given reader.
 */
export async function writeZipEntry({
  writer,
  reader,
  entryOptions,
  startOffset,
  crc32,
}: {
  /** Writer for the zip archive */
  writer: WritableStreamDefaultWriter<Uint8Array<ArrayBuffer>>;
  /** Reader for the entry data */
  reader: ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>;
  /** Options for the zip entry */
  entryOptions: EntryOptions;
  /** Offset in the zip archive where this entry starts */
  startOffset: bigint;
  /** CRC32 function to use */
  crc32: (data: Uint8Array<ArrayBuffer>, value?: number) => number;
}) {
  let uncompressedSize = BigInt(0);
  let compressedSize = BigInt(0);
  let checksum = 0;

  await writer.write(getLocalFileHeader(entryOptions));

  if (entryOptions.store) {
    // Store mode: no compression, direct copy
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const byteLength = BigInt(value.byteLength);
      uncompressedSize += byteLength;
      compressedSize += byteLength;
      checksum = crc32(value, checksum);
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
          checksum = crc32(value, checksum);
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
      crc32: checksum,
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
      crc32: checksum,
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
    [UINT16, nameBytes.length, LITTLE_ENDIAN],
    // Extra field length
    [UINT16, 0, LITTLE_ENDIAN],
  ]);

  // File name
  header.set(nameBytes, offset);
  return header;
}

export function getDataDescriptorStandard(entryInfo: {
  uncompressedSize: number;
  compressedSize: number;
  crc32: number;
}): Uint8Array<ArrayBuffer> {
  const descriptor = new Uint8Array(DATA_DESCRIPTOR_SIZE);
  const view = new DataView(descriptor.buffer);

  writeDataView(view, [
    // Data descriptor signature
    [UINT32, DATA_DESCRIPTOR_SIGNATURE, BIG_ENDIAN],
    // CRC-32 (4 bytes)
    [UINT32, entryInfo.crc32, LITTLE_ENDIAN],
    // Compressed size (4 bytes)
    [UINT32, entryInfo.compressedSize, LITTLE_ENDIAN],
    // Uncompressed size (4 bytes)
    [UINT32, entryInfo.uncompressedSize, LITTLE_ENDIAN],
  ]);

  return descriptor;
}

export function getDataDescriptorZip64(entryInfo: {
  uncompressedSize: bigint;
  compressedSize: bigint;
  crc32: number;
}): Uint8Array<ArrayBuffer> {
  const descriptor = new Uint8Array(DATA_DESCRIPTOR_SIZE_ZIP64);
  const view = new DataView(descriptor.buffer);

  writeDataView(view, [
    // Data descriptor signature
    [UINT32, DATA_DESCRIPTOR_SIGNATURE, BIG_ENDIAN],
    // CRC-32 (4 bytes)
    [UINT32, entryInfo.crc32, LITTLE_ENDIAN],
    // Compressed size (8 bytes)
    [UINT64, entryInfo.compressedSize, LITTLE_ENDIAN],
    // Uncompressed size (8 bytes)
    [UINT64, entryInfo.uncompressedSize, LITTLE_ENDIAN],
  ]);

  return descriptor;
}
