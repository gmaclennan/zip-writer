import { describe, it, assert, expect } from "vitest";
import { ZipWriter } from "../src/index.js";
import {
  createSink,
  errorReadableStream,
  errorWritableStream,
  readableFrom,
} from "./utils.js";

describe("Error Handling", () => {
  describe("Invalid Input: addEntry()", () => {
    it("should throw error when file name exceeds 65535 bytes", async () => {
      const zipWriter = new ZipWriter();

      // Create a name that exceeds the 65535 byte limit
      const fileName = new Array(70000).fill("A").join(""); // 70000 bytes

      assert.throws(
        () =>
          zipWriter.addEntry({
            readable: readableFrom(new TextEncoder().encode("test")),
            name: fileName,
            store: true,
          }),
        RangeError
      );

      zipWriter.finalize();

      await expect(
        zipWriter.readable.pipeTo(createSink()),
        "Invalid input does not error the zip writable stream"
      ).resolves.toBeUndefined();
    });

    it("should throw error when file comment exceeds 65535 bytes", async () => {
      const zipWriter = new ZipWriter();

      // Create a comment that exceeds the 65535 byte limit
      const fileComment = new Array(70000).fill("Z").join(""); // 70000 bytes

      assert.throws(
        () =>
          zipWriter.addEntry({
            readable: readableFrom(new TextEncoder().encode("test")),
            name: "test.txt",
            comment: fileComment,
            store: true,
          }),
        RangeError
      );

      zipWriter.finalize();

      await expect(
        zipWriter.readable.pipeTo(createSink()),
        "Invalid input does not error the zip writable stream"
      ).resolves.toBeUndefined();
    });

    it("should throw error when file mode is invalid", async () => {
      const zipWriter = new ZipWriter();

      assert.throws(
        () =>
          zipWriter.addEntry({
            readable: readableFrom(new TextEncoder().encode("test")),
            name: "test.txt",
            mode: 70000, // Invalid mode (> 65535)
            store: true,
          }),
        RangeError
      );

      zipWriter.finalize();

      await expect(
        zipWriter.readable.pipeTo(createSink()),
        "Invalid input does not error the zip writable stream"
      ).resolves.toBeUndefined();
    });
  });

  describe("Invalid Input: finalize()", () => {
    it("should throw error when finalize entries param has nonexistent entry", async () => {
      const zipWriter = new ZipWriter();

      // Add one entry
      const entryInfo = await zipWriter.addEntry({
        name: "test.txt",
        store: true,
        readable: readableFrom(new TextEncoder().encode("test")),
      });

      // Create a fake entry with a wrong offset
      const fakeEntry = entryInfo.zip64
        ? {
            ...entryInfo,
            startOffset: 99999n,
          }
        : {
            ...entryInfo,
            startOffset: 99999,
          };

      const finalizeExpectPromise = expect(
        zipWriter.finalize({ entries: [fakeEntry] })
      ).rejects.toThrowError(
        /Cannot set entries: entry at offset 99999 does not exist/
      );

      const pipeExpectPromise = expect(
        zipWriter.readable.pipeTo(createSink()),
        "The zip readable goes into an error state when finalize() has invalid entries"
      ).rejects.toThrowError(
        /Cannot set entries: entry at offset 99999 does not exist/
      );

      await Promise.all([finalizeExpectPromise, pipeExpectPromise]);
    });

    it("should throw error when finalize entries param has modified CRC32", async () => {
      const zipWriter = new ZipWriter();

      // Add one entry
      const entryInfo = await zipWriter.addEntry({
        name: "test.txt",
        store: true,
        readable: readableFrom(new TextEncoder().encode("test")),
      });

      // Create an entry with modified CRC32
      const modifiedEntry = {
        ...entryInfo,
        crc32: 12345,
      };

      const finalizeExpectPromise = expect(
        zipWriter.finalize({ entries: [modifiedEntry] })
      ).rejects.toThrowError(
        /Cannot set entries: entry at offset .* has different CRC32/
      );

      const pipeExpectPromise = expect(
        zipWriter.readable.pipeTo(createSink()),
        "The zip readable goes into an error state when finalize() has invalid entries"
      ).rejects.toThrowError(
        /Cannot set entries: entry at offset .* has different CRC32/
      );

      await Promise.all([finalizeExpectPromise, pipeExpectPromise]);
    });

    it("should throw error when finalize entries param has modified uncompressed size", async () => {
      const zipWriter = new ZipWriter();

      // Add one entry
      const entryInfo = await zipWriter.addEntry({
        name: "test.txt",
        store: true,
        readable: readableFrom(new TextEncoder().encode("test")),
      });

      // Create an entry with modified uncompressed size
      const modifiedEntry = entryInfo.zip64
        ? {
            ...entryInfo,
            uncompressedSize: 99999n,
          }
        : {
            ...entryInfo,
            uncompressedSize: 99999,
          };

      const finalizeExpectPromise = expect(
        zipWriter.finalize({ entries: [modifiedEntry] })
      ).rejects.toThrowError(
        /Cannot set entries: entry at offset .* has different uncompressed size/
      );
      const pipeExpectPromise = expect(
        zipWriter.readable.pipeTo(createSink()),
        "The zip readable goes into an error state when finalize() has invalid entries"
      ).rejects.toThrowError(
        /Cannot set entries: entry at offset .* has different uncompressed size/
      );

      await Promise.all([finalizeExpectPromise, pipeExpectPromise]);
    });

    it("should throw error when finalize entries param has modified compressed size", async () => {
      const zipWriter = new ZipWriter();

      // Add one entry
      const entryInfo = await zipWriter.addEntry({
        name: "test.txt",
        store: true,
        readable: readableFrom(new TextEncoder().encode("test")),
      });

      // Create an entry with modified compressed size
      const modifiedEntry = entryInfo.zip64
        ? {
            ...entryInfo,
            compressedSize: 99999n,
          }
        : {
            ...entryInfo,
            compressedSize: 99999,
          };

      const finalizeExpectPromise = expect(
        zipWriter.finalize({ entries: [modifiedEntry] })
      ).rejects.toThrowError(
        /Cannot set entries: entry at offset .* has different compressed size/
      );
      const pipeExpectPromise = expect(
        zipWriter.readable.pipeTo(createSink()),
        "The zip readable goes into an error state when finalize() has invalid entries"
      ).rejects.toThrowError(
        /Cannot set entries: entry at offset .* has different compressed size/
      );

      await Promise.all([finalizeExpectPromise, pipeExpectPromise]);
    });
  });

  describe("Invalid Operations", () => {
    it("should throw error when adding entry after finalize()", async () => {
      const zipWriter = new ZipWriter();

      // Add one entry and finalize
      zipWriter.addEntry({
        readable: readableFrom(new TextEncoder().encode("test")),
        name: "test.txt",
        store: true,
      });
      zipWriter.finalize();

      assert.throws(() => {
        zipWriter.addEntry({
          readable: readableFrom(new TextEncoder().encode("test")),
          name: "after-finalize.txt",
          store: true,
        });
      }, /Cannot add entry after finalize\(\) has been called/);

      await expect(
        zipWriter.readable.pipeTo(createSink()),
        "Adding entry after finalize() does not error the zip writable stream"
      ).resolves.toBeUndefined();
    });

    it("should throw error when calling finalize() twice", async () => {
      const zipWriter = new ZipWriter();

      // Add an entry and finalize
      zipWriter.addEntry({
        readable: readableFrom(new TextEncoder().encode("test")),
        name: "test.txt",
        store: true,
      });
      zipWriter.finalize();
      assert.throws(() => {
        zipWriter.finalize();
      }, /finalize\(\) has already been called/);

      await expect(
        zipWriter.readable.pipeTo(createSink()),
        "Calling finalize() twice does not error the zip writable stream"
      ).resolves.toBeUndefined();
    });
  });

  describe("Stream error propagation", () => {
    it("Errors the zip readable stream if there's an error reading an entry", async () => {
      const forcedError = new Error("Forced error");
      const zipWriter = new ZipWriter();
      let deferred = {} as any;
      deferred.promise = new Promise<any>((resolve, reject) => {
        deferred.resolve = resolve;
        deferred.reject = reject;
      });
      const sink = new WritableStream({
        abort(reason) {
          deferred.reject(reason);
        },
      });
      const zipWritePromise = zipWriter.readable.pipeTo(sink);

      // Write entry
      const addEntryPromise = zipWriter.addEntry({
        name: "test.txt",
        readable: errorReadableStream(forcedError, { afterBytes: 10 }),
      });

      // Wait for all to settle
      await Promise.all([
        expect(deferred.promise).rejects.toThrowError(forcedError),
        expect(addEntryPromise).rejects.toThrowError(forcedError),
        expect(zipWritePromise).rejects.toThrowError(forcedError),
      ]);
    });

    it("Errors the entry readable stream if there's an error writing to the zip writable stream", async () => {
      const forcedError = new Error("Forced error");
      const zipWriter = new ZipWriter();
      const sink = errorWritableStream(forcedError, { afterBytes: 10 });
      const zipWritePromise = zipWriter.readable.pipeTo(sink);

      // Write entry
      const addEntryPromise = zipWriter.addEntry({
        name: "test.txt",
        readable: readableFrom(new TextEncoder().encode("Hello, world!")),
      });

      // Wait for all to settle
      await Promise.all([
        expect(zipWritePromise).rejects.toThrowError(forcedError),
        expect(addEntryPromise).rejects.toThrowError(forcedError),
      ]);
    });

    it("Errors the finalize promise if there's an error writing to the zip writable stream after entries are written", async () => {
      let forcedError: undefined | Error;
      const zipWriter = new ZipWriter();
      const sink = new WritableStream({
        write() {
          if (forcedError) throw forcedError;
        },
      });
      const zipWritePromise = zipWriter.readable.pipeTo(sink);

      // Write entry
      await zipWriter.addEntry({
        name: "test.txt",
        readable: readableFrom(new TextEncoder().encode("Hello, world!")),
      });

      forcedError = new Error("Forced error");

      // Finalize
      const finalizePromise = zipWriter.finalize();

      // Wait for all to settle
      await Promise.all([
        expect(zipWritePromise).rejects.toThrowError(forcedError),
        expect(finalizePromise).rejects.toThrowError(forcedError),
      ]);
    });

    it("Not awaiting finalize() does not result in an unhandled rejection when there's an error", async () => {
      const forcedError = new Error("Forced error");
      const zipWriter = new ZipWriter();
      const sink = errorWritableStream(forcedError, { afterBytes: 10 });
      const zipWritePromise = zipWriter.readable.pipeTo(sink);

      // Write entry
      zipWriter.addEntry({
        name: "test.txt",
        readable: readableFrom(new TextEncoder().encode("Hello, world!")),
      });

      // Finalize without awaiting
      zipWriter.finalize();

      // Wait for zip write to settle
      await expect(zipWritePromise).rejects.toThrowError(forcedError);
    });

    it("Not awaiting addEntry() does not result in an unhandled rejection when there's an error", async () => {
      const forcedError = new Error("Forced error");
      const zipWriter = new ZipWriter();
      const sink = errorWritableStream(forcedError, { afterBytes: 10 });
      const zipWritePromise = zipWriter.readable.pipeTo(sink);

      // Write entry without awaiting
      zipWriter.addEntry({
        name: "test.txt",
        readable: readableFrom(new TextEncoder().encode("Hello, world!")),
      });

      zipWriter.finalize();

      // Wait for zip write to settle
      await expect(zipWritePromise).rejects.toThrowError(forcedError);
    });
  });
});
