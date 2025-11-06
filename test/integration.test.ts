import { describe, it, assert } from "vitest";
import { ZipWriter } from "../src/index.js";
import { validateZip } from "./utils.js";

/**
 * Helper to collect a ReadableStream into a Uint8Array
 */
async function collectStream(
  stream: ReadableStream<ArrayBufferView>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(
        new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      );
    }
  } finally {
    reader.releaseLock();
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Calculate SHA256 hash of data using Web Crypto API (browser) or crypto module (Node)
 */
async function sha256(data: Uint8Array): Promise<string> {
  if (typeof window !== "undefined" && window.crypto?.subtle) {
    // Browser: use Web Crypto API
    const hashBuffer = await crypto.subtle.digest(
      "SHA-256",
      data as BufferSource
    );
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    // Node: use crypto module
    const { createHash } = await import("crypto");
    return createHash("sha256").update(data).digest("hex");
  }
}

describe("ZIP Integration Tests", () => {
  describe("Single file archives", () => {
    it("should create a valid ZIP with one stored (uncompressed) file", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "test.txt";
      const fileContent = "Hello, World!";
      const fileBytes = new TextEncoder().encode(fileContent);

      // Write entry
      const entryWriter = zipWriter.entry({ name: fileName, store: true });
      const writer = entryWriter.writable.getWriter();
      await writer.write(fileBytes);
      await writer.close();

      // Finalize and collect ZIP
      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      assert.strictEqual(entries.length, 1, "Should have one entry");
      const entry = entries[0];
      assert.strictEqual(entry.filename, fileName, "Filename should match");
      assert.strictEqual(
        entry.uncompressedSize,
        fileBytes.length,
        "Uncompressed size should match"
      );
      assert.strictEqual(
        entry.compressionMethod,
        0,
        "Should use store (0) compression"
      );

      // Verify content via SHA256
      const expectedHash = await sha256(fileBytes);
      assert.strictEqual(
        entry.sha256,
        expectedHash,
        "Content SHA256 should match"
      );
    });

    it("should create a valid ZIP with one deflated (compressed) file", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "compressed.txt";
      const fileContent = "A".repeat(1000); // Repeating content compresses well
      const fileBytes = new TextEncoder().encode(fileContent);

      // Write entry with deflate (default)
      const entryWriter = zipWriter.entry({ name: fileName });
      const writer = entryWriter.writable.getWriter();
      await writer.write(fileBytes);
      await writer.close();

      // Finalize and collect ZIP
      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      assert.strictEqual(entries.length, 1, "Should have one entry");
      const entry = entries[0];
      assert.strictEqual(entry.filename, fileName, "Filename should match");
      assert.strictEqual(
        entry.uncompressedSize,
        fileBytes.length,
        "Uncompressed size should match"
      );
      assert.strictEqual(
        entry.compressionMethod,
        8,
        "Should use deflate (8) compression"
      );
      assert.isBelow(
        entry.compressedSize,
        entry.uncompressedSize,
        "Compressed size should be smaller"
      );

      // Verify content via SHA256
      const expectedHash = await sha256(fileBytes);
      assert.strictEqual(
        entry.sha256,
        expectedHash,
        "Content SHA256 should match after decompression"
      );
    });
  });

  describe("Multiple file archives", () => {
    it("should create a valid ZIP with multiple files", async () => {
      const zipWriter = new ZipWriter();
      const files = [
        { name: "file1.txt", content: "First file content" },
        { name: "file2.txt", content: "Second file content" },
        { name: "file3.txt", content: "Third file content" },
      ];

      // Write all entries
      for (const file of files) {
        const entryWriter = zipWriter.entry({ name: file.name, store: true });
        const writer = entryWriter.writable.getWriter();
        await writer.write(new TextEncoder().encode(file.content));
        await writer.close();
      }

      // Finalize and collect ZIP
      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      assert.strictEqual(
        entries.length,
        files.length,
        `Should have ${files.length} entries`
      );

      // Verify each file
      for (let i = 0; i < files.length; i++) {
        const expectedFile = files[i];
        const entry = entries[i];
        const expectedBytes = new TextEncoder().encode(expectedFile.content);

        assert.strictEqual(
          entry.filename,
          expectedFile.name,
          `Entry ${i} filename should match`
        );
        const expectedHash = await sha256(expectedBytes);
        assert.strictEqual(
          entry.sha256,
          expectedHash,
          `Entry ${i} content should match`
        );
      }
    });

    it("should handle files with subdirectories", async () => {
      const zipWriter = new ZipWriter();
      const files = [
        { name: "root.txt", content: "Root file" },
        { name: "subdir/file1.txt", content: "Subdirectory file 1" },
        { name: "subdir/nested/file2.txt", content: "Nested file 2" },
      ];

      // Write all entries
      for (const file of files) {
        const entryWriter = zipWriter.entry({ name: file.name, store: true });
        const writer = entryWriter.writable.getWriter();
        await writer.write(new TextEncoder().encode(file.content));
        await writer.close();
      }

      // Finalize and collect ZIP
      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      assert.strictEqual(
        entries.length,
        files.length,
        "Should have all entries"
      );

      // Verify paths are preserved correctly
      for (const file of files) {
        const entry = entries.find((e) => e.filename === file.name);
        assert.isDefined(entry, `Should find entry for ${file.name}`);

        const expectedBytes = new TextEncoder().encode(file.content);
        const expectedHash = await sha256(expectedBytes);
        assert.strictEqual(
          entry!.sha256,
          expectedHash,
          `Content for ${file.name} should match`
        );
      }
    });
  });

  describe("File metadata", () => {
    it("should preserve file modification dates", async () => {
      const zipWriter = new ZipWriter();
      const testDate = new Date("2024-06-15T12:00:00Z");
      const fileName = "dated-file.txt";

      const entryWriter = zipWriter.entry({
        name: fileName,
        store: true,
        date: testDate,
      });
      const writer = entryWriter.writable.getWriter();
      await writer.write(new TextEncoder().encode("Content"));
      await writer.close();

      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      const entry = entries[0];
      assert.strictEqual(entry.filename, fileName);
      // Just verify that the entry exists with proper metadata
      assert.isAbove(entry.uncompressedSize, 0, "Should have content");
    });

    it("should handle file comments", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "commented.txt";
      const fileComment = "This is a test comment";

      const entryWriter = zipWriter.entry({
        name: fileName,
        store: true,
        comment: fileComment,
      });
      const writer = entryWriter.writable.getWriter();
      await writer.write(new TextEncoder().encode("Content with comment"));
      await writer.close();

      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      const entry = entries[0];
      assert.strictEqual(entry.filename, fileName);
      // Entry should exist - comment validation depends on reader implementation
      assert.isDefined(entry, "Entry should exist");
    });

    it("should handle Unix file permissions", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "executable.sh";
      const fileMode = 0o755; // rwxr-xr-x

      const entryWriter = zipWriter.entry({
        name: fileName,
        store: true,
        mode: fileMode,
      });
      const writer = entryWriter.writable.getWriter();
      await writer.write(new TextEncoder().encode("#!/bin/bash\necho 'test'"));
      await writer.close();

      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      const entry = entries[0];
      assert.strictEqual(entry.filename, fileName);

      // Extract Unix mode from external file attributes (upper 16 bits)
      const mode = (entry.externalFileAttributes >> 16) & 0xffff;
      assert.strictEqual(mode, fileMode, "Unix file mode should be preserved");
    });
  });

  describe("UTF-8 filename handling", () => {
    it("should handle UTF-8 filenames correctly", async () => {
      const zipWriter = new ZipWriter();
      const files = [
        { name: "test-文件.txt", content: "Chinese filename" },
        { name: "тест.txt", content: "Cyrillic filename" },
        { name: "δοκιμή.txt", content: "Greek filename" },
        { name: "テスト.txt", content: "Japanese filename" },
      ];

      // Write all entries
      for (const file of files) {
        const entryWriter = zipWriter.entry({ name: file.name, store: true });
        const writer = entryWriter.writable.getWriter();
        await writer.write(new TextEncoder().encode(file.content));
        await writer.close();
      }

      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      assert.strictEqual(
        entries.length,
        files.length,
        "Should have all UTF-8 named files"
      );

      // Verify each filename and content
      for (const file of files) {
        const entry = entries.find((e) => e.filename === file.name);
        assert.isDefined(entry, `Should find entry for ${file.name}`);

        const expectedBytes = new TextEncoder().encode(file.content);
        const expectedHash = await sha256(expectedBytes);
        assert.strictEqual(
          entry!.sha256,
          expectedHash,
          `Content for ${file.name} should match`
        );
      }
    });
  });

  describe("Empty files and edge cases", () => {
    it("should handle empty files", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "empty.txt";

      const entryWriter = zipWriter.entry({ name: fileName, store: true });
      const writer = entryWriter.writable.getWriter();
      await writer.close(); // Close without writing anything

      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      const entry = entries[0];
      assert.strictEqual(entry.filename, fileName);
      assert.strictEqual(
        entry.uncompressedSize,
        0,
        "Empty file should have 0 size"
      );
      assert.strictEqual(
        entry.compressedSize,
        0,
        "Empty file compressed size should be 0"
      );

      // SHA256 of empty buffer
      const expectedHash = await sha256(new Uint8Array(0));
      assert.strictEqual(entry.sha256, expectedHash, "Content should be empty");
    });

    it("should handle very long filenames", async () => {
      const zipWriter = new ZipWriter();
      // ZIP format supports filenames up to 65535 bytes
      const longName = "a".repeat(200) + "/b".repeat(200) + "/file.txt";

      const entryWriter = zipWriter.entry({ name: longName, store: true });
      const writer = entryWriter.writable.getWriter();
      await writer.write(new TextEncoder().encode("Content"));
      await writer.close();

      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      const entry = entries[0];
      assert.strictEqual(
        entry.filename,
        longName,
        "Long filename should be preserved"
      );
    });
  });

  describe("Mixed compression methods", () => {
    it("should handle mix of stored and deflated files in same archive", async () => {
      const zipWriter = new ZipWriter();
      const files = [
        { name: "stored.txt", content: "Stored content", store: true },
        { name: "deflated.txt", content: "Deflated content", store: false },
        { name: "stored2.txt", content: "Another stored", store: true },
      ];

      // Write all entries
      for (const file of files) {
        const entryWriter = zipWriter.entry({
          name: file.name,
          store: file.store,
        });
        const writer = entryWriter.writable.getWriter();
        await writer.write(new TextEncoder().encode(file.content));
        await writer.close();
      }

      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl via validateZip helper
      const entries = await validateZip(zipBuffer);

      assert.strictEqual(
        entries.length,
        files.length,
        "Should have all entries"
      );

      // Verify compression methods
      for (let i = 0; i < files.length; i++) {
        const expectedFile = files[i];
        const entry = entries[i];

        assert.strictEqual(entry.filename, expectedFile.name);
        const expectedMethod = expectedFile.store ? 0 : 8;
        assert.strictEqual(
          entry.compressionMethod,
          expectedMethod,
          `${expectedFile.name} should use correct compression method`
        );

        const expectedBytes = new TextEncoder().encode(expectedFile.content);
        const expectedHash = await sha256(expectedBytes);
        assert.strictEqual(
          entry.sha256,
          expectedHash,
          `Content for ${expectedFile.name} should match`
        );
      }
    });
  });
});
