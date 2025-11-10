/**
 * Helper for creating a ReadableStream from a Uint8Array
 * with proper backpressure handling.
 *
 * @param data The input Uint8Array
 */
export function readableFromBytes(data: Uint8Array<ArrayBuffer>) {
  let offset = 0;
  return new ReadableStream(
    {
      pull(controller) {
        if (offset >= data.byteLength) {
          controller.close();
          return;
        }
        const chunkSize = Math.min(
          // desiredSize can't be null here - it's only null after close()
          // It could be <=0 under some circumstances, so ensure at least 1 byte is read
          Math.max(controller.desiredSize!, 1),
          data.byteLength - offset
        );
        const chunk = data.subarray(offset, offset + chunkSize);
        controller.enqueue(chunk);
        offset += chunkSize;
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 16 * 1024 })
  );
}
