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
