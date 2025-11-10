import { describe, it, assert, expect } from "vitest";
import { ZipWriter } from "../src/index.js";
import {
  validateZip,
  collectStream,
  sha256,
  getDosTime,
  getDosDate,
  readableFrom,
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
      zipWriter.addEntry({
        readable: readableFrom(fileBytes),
        name: fileName,
        store: true,
      });

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
      zipWriter.addEntry({
        readable: readableFrom(fileBytes),
        name: fileName,
      });

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
        {
          name: "file1.txt",
          content: new Array(10000).fill("First file content").join(""),
        },
        {
          name: "file2.txt",
          content: new Array(10000).fill("Second file content").join(""),
        },
        {
          name: "file3.txt",
          content: new Array(10000).fill("Third file content").join(""),
        },
      ];

      // Write all entries
      for (const file of files) {
        zipWriter.addEntry({
          name: file.name,
          store: true,
          readable: readableFrom(new TextEncoder().encode(file.content)),
        });
      }

      // Finalize and collect ZIP
      zipWriter.finalize();
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
        zipWriter.addEntry({
          name: file.name,
          store: true,
          readable: readableFrom(new TextEncoder().encode(file.content)),
        });
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

      zipWriter.addEntry({
        name: fileName,
        store: true,
        date: testDate,
        readable: readableFrom(new TextEncoder().encode("Content")),
      });

      zipWriter.finalize();
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

      zipWriter.addEntry({
        name: fileName,
        store: true,
        comment: fileComment,
        readable: readableFrom(
          new TextEncoder().encode("Content with comment")
        ),
      });

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

      zipWriter.addEntry({
        name: fileName,
        store: true,
        mode: fileMode,
        readable: readableFrom(
          new TextEncoder().encode("#!/bin/bash\necho 'test'")
        ),
      });

      zipWriter.finalize();
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
        zipWriter.addEntry({
          name: file.name,
          store: true,
          readable: readableFrom(new TextEncoder().encode(file.content)),
        });
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

      zipWriter.addEntry({
        name: fileName,
        store: true,
        readable: readableFrom(new Uint8Array(0)),
      });

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

      zipWriter.addEntry({
        name: longName,
        store: true,
        readable: readableFrom(new TextEncoder().encode("Content")),
      });

      zipWriter.finalize();
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
        zipWriter.addEntry({
          name: file.name,
          store: file.store,
          readable: readableFrom(new TextEncoder().encode(file.content)),
        });
      }

      zipWriter.finalize();
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

  describe("Entry filtering", () => {
    it("should allow filtering out entries before finalization", async () => {
      const zipWriter = new ZipWriter();
      const files = [
        { name: "keep1.txt", content: "Keep this file" },
        { name: "remove.txt", content: "Remove this file" },
        {
          name: "keep2.txt",
          content: "Keep this too",
          comment: "Important file",
        },
      ];

      // Add all entries
      for (const file of files) {
        zipWriter.addEntry({
          name: file.name,
          store: true,
          readable: readableFrom(new TextEncoder().encode(file.content)),
          comment: file.comment,
        });
      }

      // Get current entries and filter out the one to remove
      const currentEntries = await zipWriter.entries();
      const filteredEntries = currentEntries.filter(
        (entry) => entry.name !== "remove.txt"
      );

      // Finalize with filtered entries
      await zipWriter.finalize({ entries: filteredEntries });
      const zipBuffer = await collectStream(zipWriter.readable);

      // Validate with yauzl
      const entries = await validateZip(zipBuffer);

      // Should only have 2 entries (the removed one should not appear)
      assert.strictEqual(entries.length, 2, "Should have 2 entries");

      // Verify the removed entry is not present
      const entryNames = entries.map((e) => e.filename);
      assert.notInclude(
        entryNames,
        "remove.txt",
        "Removed entry should not appear in final ZIP"
      );
      assert.include(
        entryNames,
        "keep1.txt",
        "First kept entry should be present"
      );
      assert.include(
        entryNames,
        "keep2.txt",
        "Second kept entry should be present"
      );

      // Verify content of kept files
      const keep1Entry = entries.find((e) => e.filename === "keep1.txt");
      const keep2Entry = entries.find((e) => e.filename === "keep2.txt");

      const keep1Hash = await sha256(
        new TextEncoder().encode("Keep this file")
      );
      const keep2Hash = await sha256(new TextEncoder().encode("Keep this too"));

      assert.strictEqual(
        keep1Entry!.sha256,
        keep1Hash,
        "keep1.txt content should match"
      );
      assert.strictEqual(
        keep2Entry!.sha256,
        keep2Hash,
        "keep2.txt content should match"
      );
      assert.strictEqual(
        keep2Entry!.comment,
        "Important file",
        "keep2.txt comment should be preserved"
      );
    });
  });
});
