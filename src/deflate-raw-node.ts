// @ts-expect-error - TS is configured to target DOM, not node
import { createDeflateRaw } from "node:zlib";
// @ts-expect-error - TS is configured to target DOM, not node
import { Duplex } from "node:stream";

let nativeSupported: boolean;
try {
  new CompressionStream("deflate-raw");
  nativeSupported = true;
} catch {
  nativeSupported = false;
}

export function createDeflateRawStream(): CompressionStream {
  if (nativeSupported) {
    return new CompressionStream("deflate-raw");
  }
  return Duplex.toWeb(createDeflateRaw()) as unknown as CompressionStream;
}
