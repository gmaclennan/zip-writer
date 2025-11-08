import { describe, it, assert } from "vitest";
import { ZipWriter } from "../src/index.js";
import {
  validateZip,
  collectStream,
  sha256,
  getDosTime,
  getDosDate,
} from "./utils.js";
import { crc32 } from "../src/crc-browser.js";

describe("ZIP Integration Tests", () => {
  describe("Single file archives", () => {
    it("should create a valid ZIP with one stored (uncompressed) file", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "test.txt";
      const fileContent = "Hello, World!";
      const fileBytes = new TextEncoder().encode(fileContent);

      // Write entry
      const entryWriter = zipWriter.createEntryStream({
        name: fileName,
        store: true,
      });
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
      const entryWriter = zipWriter.createEntryStream({ name: fileName });
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
        const entryWriter = zipWriter.createEntryStream({
          name: file.name,
          store: true,
        });
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
        const entryWriter = zipWriter.createEntryStream({
          name: file.name,
          store: true,
        });
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

      const entryWriter = zipWriter.createEntryStream({
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
      assert.equal(
        entry.lastModTime,
        getDosTime(testDate),
        "Modification time should match"
      );
      assert.equal(
        entry.lastModDate,
        getDosDate(testDate),
        "Modification date should match"
      );
    });

    it("should handle file comments", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "commented.txt";
      const fileComment = "This is a test comment";

      const entryWriter = zipWriter.createEntryStream({
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
      assert.equal(entry.comment, fileComment, "File comment should match");
    });

    it("should handle Unix file permissions", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "executable.sh";
      const fileMode = 0o755; // rwxr-xr-x

      const entryWriter = zipWriter.createEntryStream({
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
        const entryWriter = zipWriter.createEntryStream({
          name: file.name,
          store: true,
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

      const entryWriter = zipWriter.createEntryStream({
        name: fileName,
        store: true,
      });
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

      const entryWriter = zipWriter.createEntryStream({
        name: longName,
        store: true,
      });
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
        const entryWriter = zipWriter.createEntryStream({
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

  describe("createEntry() convenience method", () => {
    it("should create entry with data in one call", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "convenience.txt";
      const fileContent = "Hello from createEntry!";
      const fileBytes = new TextEncoder().encode(fileContent);
      const expectedCrc32 = crc32(fileBytes);

      // Write entry using createEntry convenience method
      const entryInfo = await zipWriter.createEntry(fileBytes, {
        name: fileName,
      });

      // Verify returned entry info
      assert.strictEqual(entryInfo.name, fileName);
      assert.strictEqual(entryInfo.uncompressedSize, fileBytes.length);

      // Finalize and collect ZIP
      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl
      const entries = await validateZip(zipBuffer);

      assert.strictEqual(entries.length, 1, "Should have one entry");
      const entry = entries[0];
      assert.strictEqual(entry.filename, fileName);

      // Verify content via SHA256
      const expectedHash = await sha256(fileBytes);
      assert.strictEqual(entry.sha256, expectedHash, "Content should match");
      assert.strictEqual(entry.crc32, expectedCrc32, "CRC32 should match");
      assert.strictEqual(entry.uncompressedSize, fileBytes.length);
    });

    it("should create multiple entries with createEntry", async () => {
      const zipWriter = new ZipWriter();
      const files = [
        { name: "file1.txt", content: "First file" },
        { name: "file2.txt", content: "Second file" },
        { name: "file3.txt", content: "Third file" },
      ];

      // Write all entries using createEntry
      for (const file of files) {
        const fileBytes = new TextEncoder().encode(file.content);
        await zipWriter.createEntry(fileBytes, {
          name: file.name,
        });
      }

      // Finalize and collect ZIP
      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl
      const entries = await validateZip(zipBuffer);

      assert.strictEqual(entries.length, files.length);

      // Verify each file
      for (let i = 0; i < files.length; i++) {
        const expectedFile = files[i];
        const entry = entries[i];
        const expectedBytes = new TextEncoder().encode(expectedFile.content);

        assert.strictEqual(entry.filename, expectedFile.name);

        const expectedHash = await sha256(expectedBytes);
        assert.strictEqual(entry.sha256, expectedHash);
      }
    });

    it("should support all entry options with createEntry", async () => {
      const zipWriter = new ZipWriter();
      const fileName = "configured.txt";
      const fileContent = "Configured file";
      const fileBytes = new TextEncoder().encode(fileContent);
      const testDate = new Date("2024-06-15T12:00:00Z");
      const testMode = 0o755;
      const testComment = "Test comment";

      // Write entry with all options
      const entryInfo = await zipWriter.createEntry(fileBytes, {
        name: fileName,
        date: testDate,
        mode: testMode,
        comment: testComment,
        store: true,
      });

      // Verify returned entry info
      assert.strictEqual(entryInfo.name, fileName);
      assert.strictEqual(entryInfo.comment, testComment);
      assert.strictEqual(entryInfo.mode, testMode);

      // Finalize and collect ZIP
      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl
      const entries = await validateZip(zipBuffer);

      const entry = entries[0];
      assert.strictEqual(entry.filename, fileName);
      assert.strictEqual(entry.comment, testComment);
      assert.equal(entry.lastModTime, getDosTime(testDate));
      assert.equal(entry.lastModDate, getDosDate(testDate));

      const mode = (entry.externalFileAttributes >> 16) & 0xffff;
      assert.strictEqual(mode, testMode);

      const expectedHash = await sha256(fileBytes);
      assert.strictEqual(entry.sha256, expectedHash);
    });

    it("should create multiple entries in parallel with createEntry", async () => {
      const zipWriter = new ZipWriter();
      const files = [
        { name: "parallel1.txt", content: "First parallel file" },
        { name: "parallel2.txt", content: "Second parallel file" },
        { name: "parallel3.txt", content: "Third parallel file" },
      ];

      // Create all entries in parallel using Promise.all
      await Promise.all(
        files.map((file) => {
          const fileBytes = new TextEncoder().encode(file.content);
          return zipWriter.createEntry(fileBytes, {
            name: file.name,
          });
        })
      );

      // Finalize and collect ZIP
      await zipWriter.finalize();
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl
      const entries = await validateZip(zipBuffer);

      assert.strictEqual(entries.length, files.length);

      // Verify each file (entries may be in any order due to parallel creation)
      for (const expectedFile of files) {
        const entry = entries.find((e) => e.filename === expectedFile.name);
        assert.isDefined(entry, `Should find entry for ${expectedFile.name}`);

        const expectedBytes = new TextEncoder().encode(expectedFile.content);
        const expectedHash = await sha256(expectedBytes);
        assert.strictEqual(
          entry!.sha256,
          expectedHash,
          `Content for ${expectedFile.name} should match`
        );
      }
    });
  });

  describe("Error handling", () => {
    it("should throw error when file comment exceeds 65535 bytes", async () => {
      const zipWriter = new ZipWriter();

      // Create a comment that exceeds the 65535 byte limit
      const fileComment = new Array(70000).fill("Z").join(""); // 70000 bytes

      const entryWriter = zipWriter.createEntryStream({
        name: "test.txt",
        comment: fileComment,
        store: true,
      });

      const writer = entryWriter.writable.getWriter();
      await writer.write(new TextEncoder().encode("test"));
      await writer.close();

      // The error should be thrown during finalize when the central directory is written
      let error: Error | null = null;
      try {
        await zipWriter.finalize();
        // Drain the readable stream
        const reader = zipWriter.readable.getReader();
        while (true) {
          const { done } = await reader.read();
          if (done) break;
        }
      } catch (e) {
        error = e as Error;
      }

      assert.ok(error, "Expected an error to be thrown");
      assert.match(
        error!.message,
        /File comment exceeds maximum length of 65535 bytes \(got 70000 bytes\)/
      );
    });

    it("should throw error when adding entry after finalize()", async () => {
      const zipWriter = new ZipWriter();

      // Add one entry and finalize
      const entryWriter = zipWriter.createEntryStream({
        name: "test.txt",
        store: true,
      });
      const writer = entryWriter.writable.getWriter();
      await writer.write(new TextEncoder().encode("test"));
      await writer.close();
      await zipWriter.finalize();

      // Try to add another entry after finalize
      let error: Error | null = null;
      try {
        zipWriter.createEntryStream({
          name: "after-finalize.txt",
          store: true,
        });
      } catch (e) {
        error = e as Error;
      }

      assert.ok(error, "Expected an error to be thrown");
      assert.match(
        error!.message,
        /Cannot add entry after finalize\(\) has been called/
      );
    });
  });
});
