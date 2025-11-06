// Shim for validateZip that works in both Node and browser contexts

export interface ZipEntryInfo {
  filename: string;
  uncompressedSize: number;
  compressedSize: number;
  compressionMethod: number;
  sha256: string;
  isDirectory: boolean;
  externalFileAttributes: number;
}

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

// if you are using TypeScript, you can augment the module
declare module "vitest/browser" {
  interface BrowserCommands {
    validateZip: (
      zipAsHex: string
    ) => Promise<ZipEntryInfo[] | { error: Error }>;
  }
}
