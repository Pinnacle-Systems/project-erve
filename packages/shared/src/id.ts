import { ulid } from 'ulid';

// ULIDs are globally unique and roughly time-sortable, which keeps
// operational records (audit logs, ledgers, lifecycle entities) ordered
// without leaking sequence information the way auto-increment ids do.
export function createId(): string {
  return ulid();
}
