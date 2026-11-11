// ISS-075: how a packing destination is named on screen and in documents.
//
// Internal readers get the owning Distributor appended ("Store — Distributor"). A reader that may
// not identify Distributors (Factory, QA) receives no `distributor` from the API, so the Store
// code is appended instead ("Store (CODE)") — that keeps two destinations with the same Store
// name or city apart without naming the party that owns them.
export interface DestinationDisplayInput {
  label: string | null;
  city: string;
  state: string;
  storeCode?: string | null;
  distributor?: { name: string } | null;
}

export function destinationBaseName(destination: Pick<DestinationDisplayInput, 'label' | 'city' | 'state'>): string {
  return destination.label ?? `${destination.city}, ${destination.state}`;
}

export function destinationDisplayName(destination: DestinationDisplayInput): string {
  const base = destinationBaseName(destination);
  if (destination.distributor) return `${base} — ${destination.distributor.name}`;
  return destination.storeCode ? `${base} (${destination.storeCode})` : base;
}
