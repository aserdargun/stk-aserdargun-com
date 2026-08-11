const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function isValidIsoDate(value: string) {
  if (!isoDatePattern.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
