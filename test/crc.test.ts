import { describe, it, assert } from "vitest";
import { crc32 } from "../src/crc-browser.js";
import { crc32 as zlibCrc32 } from "node:zlib";

describe("CRC32 (tested against zlib)", () => {
  const testData = new Uint8Array(1024);
  crypto.getRandomValues(testData);
  const expectedCrc = zlibCrc32(testData);

  it("should calculate correct CRC when writing entire buffer at once", () => {
    const crc = crc32(testData);
    assert.strictEqual(crc, expectedCrc);
  });

  it("should calculate correct CRC when writing in chunks > 16 bytes", () => {
    let crc = 0;
    const chunkSize = 20; // > 16
    for (let i = 0; i < testData.length; i += chunkSize) {
      const chunk = testData.slice(i, i + chunkSize);
      crc = crc32(chunk, crc);
    }
    assert.strictEqual(crc, expectedCrc);
  });

  it("should calculate correct CRC when writing in chunks < 16 bytes", () => {
    let crc = 0;
    const chunkSize = 10; // < 16
    for (let i = 0; i < testData.length; i += chunkSize) {
      const chunk = testData.slice(i, i + chunkSize);
      crc = crc32(chunk, crc);
    }
    assert.strictEqual(crc, expectedCrc);
  });

  it("should calculate correct CRC when writing in chunks of exactly 16 bytes", () => {
    let crc = 0;
    const chunkSize = 16; // = 16
    for (let i = 0; i < testData.length; i += chunkSize) {
      const chunk = testData.slice(i, i + chunkSize);
      crc = crc32(chunk, crc);
    }
    assert.strictEqual(crc, expectedCrc);
  });
});
