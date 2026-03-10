export function createDeflateRawStream(): CompressionStream {
  return new CompressionStream("deflate-raw");
}
