// Shim for validateZip that works in both Node and browser contexts
import type { ZipEntryInfo } from "./commands.js";

/**
 * Convert Uint8Array to hex string
 */
function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// In Node context, import the command directly
// In browser context, use vitest browser commands
export async function validateZip(
  zipBuffer: Uint8Array
): Promise<ZipEntryInfo[]> {
  const hexString = toHex(zipBuffer);
  let result: ZipEntryInfo[] | { error: Error };

  // Check if we're in a browser context
  if (typeof window !== "undefined") {
    // Browser: use vitest browser commands
    const { commands } = await import("vitest/browser");
    result = await commands.validateZip(hexString);
  } else {
    // Node: use the command directly
    const { validateZip: validateZipCommand } = await import("./commands.js");
    // Call the command with a mock context
    result = await validateZipCommand({} as any, hexString);
  }
  if ("error" in result) {
    throw result.error;
  }

  return result;
}

/**
 * Helper to collect a ReadableStream into a Uint8Array
 */
export async function collectStream(
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
export async function sha256(data: Uint8Array): Promise<string> {
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

/**
 * Convert a JavaScript Date to MS-DOS time format.
 * MS-DOS time is a 16-bit value with the following structure:
 * - Bits 15-11: Hours (0-23)
 * - Bits 10-5: Minutes (0-59)
 * - Bits 4-0: Seconds/2 (0-29, representing 0-58 seconds in 2-second intervals)
 */
export function getDosTime(date: Date): number {
  return (
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (date.getSeconds() >> 1)
  );
}

/**
 * Convert a JavaScript Date to MS-DOS date format.
 * MS-DOS date is a 16-bit value with the following structure:
 * - Bits 15-9: Year offset from 1980 (0-127, representing 1980-2107)
 * - Bits 8-5: Month (1-12)
 * - Bits 4-0: Day (1-31)
 */
export function getDosDate(date: Date): number {
  return (
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  );
}

export function randomBytesReadableStream({
  size = Number.POSITIVE_INFINITY,
} = {}) {
  let producedSize = 0;

  return new ReadableStream({
    type: "bytes",
    pull(controller) {
      if (controller.byobRequest === null) return;

      let view = controller.byobRequest.view as Uint8Array<ArrayBuffer>;
      let readSize = view.byteLength;

      if (producedSize + readSize >= size) {
        readSize = size - producedSize;
        view = view.subarray(0, readSize);
        crypto.getRandomValues(view);
        controller.byobRequest.respondWithNewView(view);
        controller.close();
      } else {
        crypto.getRandomValues(view);
        controller.byobRequest.respond(readSize);
      }
      producedSize += readSize;
    },
  });
}

// if you are using TypeScript, you can augment the module
declare module "vitest/browser" {
  interface BrowserCommands {
    validateZip: (
      zipAsHex: string
    ) => Promise<ZipEntryInfo[] | { error: Error }>;
  }
}
