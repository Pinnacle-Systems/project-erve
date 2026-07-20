// Single canonical form for stored/looked-up emails, shared by user
// creation, profile edits, and login so the same input always resolves
// to the same account regardless of case or incidental whitespace.
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
