// Shim for validateZip that works in both Node and browser contexts
import type { ZipEntryInfo } from "./commands.js";

/**
 * Convert Uint8Array to hex string
 */
function toHex(buffer: Uint8Array): string {
  return Array.from(buffer)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// In Node context, import the command directly
// In browser context, use vitest browser commands
export async function validateZip(zipBuffer: Uint8Array): Promise<ZipEntryInfo[]> {
  const hexString = toHex(zipBuffer);

  // Check if we're in a browser context
  if (typeof window !== "undefined") {
    // Browser: use vitest browser commands
    const { commands } = await import("vitest/browser");
    return commands.validateZip(hexString);
  } else {
    // Node: use the command directly
    const { validateZip: validateZipCommand } = await import("./commands.js");
    // Call the command with a mock context
    return validateZipCommand({} as any, hexString);
  }
}
