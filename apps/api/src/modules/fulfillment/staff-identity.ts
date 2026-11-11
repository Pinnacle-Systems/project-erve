// ISS-075 — internal staff contact details never reach external readers.
//
// Post-dispatch views carry "who did this" references (dispatched/delivered/approved/received by …).
// The web UI and PDFs only ever render the person's name, and Invoice Handoff already withholds
// "who recorded it" from Distributors, so the staff e-mail address is dropped for every reader that
// is not an internal (ADMIN / MERCHANDISER / SENIOR_MANAGEMENT / ACCOUNTANT) role. The name and id
// are kept: they are the operational "who" a Distributor sees on the Dispatch screen and PDF.
export interface StaffRef {
  id: string;
  name: string;
  email: string;
}

export type ReaderStaffRef = Omit<StaffRef, 'email'> & { email?: string };

export function staffRefForReader(ref: StaffRef, internalReader: boolean): ReaderStaffRef;
export function staffRefForReader(
  ref: StaffRef | null,
  internalReader: boolean,
): ReaderStaffRef | null;
export function staffRefForReader(
  ref: StaffRef | null,
  internalReader: boolean,
): ReaderStaffRef | null {
  if (!ref) return null;
  return internalReader
    ? { id: ref.id, name: ref.name, email: ref.email }
    : { id: ref.id, name: ref.name };
}
