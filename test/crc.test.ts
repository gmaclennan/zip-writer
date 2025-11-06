import { describe, it, assert } from "vitest";
import { crc32 } from "../src/crc.js";

describe("CRC32", () => {
  const testString =
    "abcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefghabcdefgh";
  const expectedCrc = 0x6b64f5d;
  const encoder = new TextEncoder();
  const testBuffer = encoder.encode(testString);

  it("should calculate correct CRC when writing entire buffer at once", () => {
    const crc = crc32(testBuffer);
    assert.strictEqual(crc, expectedCrc);
  });

  it("should calculate correct CRC when writing in chunks > 16 bytes", () => {
    let crc = 0;
    const chunkSize = 20; // > 16
    for (let i = 0; i < testBuffer.length; i += chunkSize) {
      const chunk = testBuffer.slice(i, i + chunkSize);
      crc = crc32(chunk, crc);
    }
    assert.strictEqual(crc, expectedCrc);
  });

  it("should calculate correct CRC when writing in chunks < 16 bytes", () => {
    let crc = 0;
    const chunkSize = 10; // < 16
    for (let i = 0; i < testBuffer.length; i += chunkSize) {
      const chunk = testBuffer.slice(i, i + chunkSize);
      crc = crc32(chunk, crc);
    }
    assert.strictEqual(crc, expectedCrc);
  });

  it("should calculate correct CRC when writing in chunks of exactly 16 bytes", () => {
    let crc = 0;
    const chunkSize = 16; // = 16
    for (let i = 0; i < testBuffer.length; i += chunkSize) {
      const chunk = testBuffer.slice(i, i + chunkSize);
      crc = crc32(chunk, crc);
    }
    assert.strictEqual(crc, expectedCrc);
  });
});
