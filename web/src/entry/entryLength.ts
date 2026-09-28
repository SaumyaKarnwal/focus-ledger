export const LENGTH_MESSAGE =
  "The length must be a whole number of minutes from 1 to 1440.";

/** A whole number from 1 to 1440, as the server accepts for minutes. */
export function isEntryLength(text: string): boolean {
  if (!/^\d+$/.test(text.trim())) return false;
  const minutes = Number(text);
  return minutes >= 1 && minutes <= 1440;
}
