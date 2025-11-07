export function getDosTime(date: Date): number {
  return (
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (date.getSeconds() >> 1)
  );
}

export function getDosDate(date: Date): number {
  return (
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate()
  );
}

export function noop() {}

type DataViewValue<T extends keyof typeof OFFSETS = keyof typeof OFFSETS> =
  T extends "setBigUint64" ? [T, bigint, boolean] : [T, number, boolean];

export const UINT16 = "setUint16";
export const UINT32 = "setUint32";
export const UINT64 = "setBigUint64";
type Ints = typeof UINT16 | typeof UINT32 | typeof UINT64;

const OFFSETS = {
  setUint16: 2,
  setUint32: 4,
  setBigUint64: 8,
} satisfies Record<Ints, number>;

export function writeDataView(
  view: DataView,
  values: DataViewValue[],
  offset: number = 0
): number {
  for (const [method, value, littleEndian] of values) {
    // @ts-expect-error
    view[method](offset, value, littleEndian);
    offset += OFFSETS[method];
  }
  return offset;
}
