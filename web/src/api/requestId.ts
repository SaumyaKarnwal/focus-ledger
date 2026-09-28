/** A new idempotency key for one user action (docs/api.md, "Idempotency"). */
export function newRequestId(): string {
  return crypto.randomUUID();
}
