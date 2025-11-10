// ZIP format constants (stored in file byte order)
export const LOCAL_FILE_HEADER_SIGNATURE = 0x504b0304; // "PK\x03\x04"
export const DATA_DESCRIPTOR_SIGNATURE = 0x504b0708; // "PK\x07\x08"
export const CENTRAL_DIRECTORY_SIGNATURE = 0x504b0102; // "PK\x01\x02"
export const END_OF_CENTRAL_DIR_SIGNATURE = 0x504b0506; // "PK\x05\x06"
export const ZIP64_END_OF_CENTRAL_DIR_SIGNATURE = 0x504b0606; // "PK\x06\x06"
export const ZIP64_END_OF_CENTRAL_DIR_LOCATOR_SIGNATURE = 0x504b0607; // "PK\x06\x07"

// Version constants
export const VERSION_MADE_BY = 45; // Version 4.5 (ZIP64 support)
export const VERSION_NEEDED_STANDARD = 20; // Version 2.0
export const VERSION_NEEDED_ZIP64 = 45; // Version 4.5 for ZIP64

// Flags
export const GENERAL_PURPOSE_FLAGS = 0b0000_1000_0000_1000; // Bit 3: crc and file-sizes unknown when header was written, Bit 11: UTF-8

// Compression methods
export const COMPRESSION_METHOD_STORE = 0;
export const COMPRESSION_METHOD_DEFLATE = 8;

// Size constants
export const LOCAL_FILE_HEADER_SIZE = 30;
export const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
export const DATA_DESCRIPTOR_SIZE = 16;
export const DATA_DESCRIPTOR_SIZE_ZIP64 = 24;
export const EOCD_SIZE = 22;
export const EOCD64_SIZE = 56;
export const EOCD64_LOCATOR_SIZE = 20;

// Limits
export const ZIP64_LIMIT = BigInt(0xffffffff);
export const MAX_2_BYTE = 0xffff;
export const MAX_4_BYTE = 0xffffffff;

/** Little-endian for DataView methods */
export const LITTLE_ENDIAN = true;
/** Big-endian for DataView methods */
export const BIG_ENDIAN = false;
