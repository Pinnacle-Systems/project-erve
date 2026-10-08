# ERVE India — Operational Runbook: EI Tax Invoice Numbering Cutover

**Document:** `EI_NUMBERING_CUTOVER_RUNBOOK.md`  
**Story Reference:** INV-012 (EI Numbering Cutover Preparation)  
**Downstream Dependency:** INV-006 (Tax Invoice Finalization & Atomic Number Allocation)  
**Governing Standard:** Indian GST (Section 31 CGST Act / Rule 46 CGST Rules) & ERVE Financial Year Infrastructure  
**Canonical Invoice Syntax:** `EI/<FY>/<4-digit serial>` (e.g., `EI/26-27/0001`)

---

## 1. Executive Summary & Cutover Scope

This runbook defines the idempotent, operator-controlled procedure for transitioning Tax Invoice numbering from the existing external accounting system (e.g. Tally, physical register, or legacy ERP) into ERVE India.

### Core Invariants:

1. **Never guess the high-water mark:** Allocation must continue from the _actual verified live high-water mark_ of issued Tax Invoices in the active Indian Financial Year (1 April – 31 March). Illustrative numbers (such as `0270`) must never be used as default or assumed values.
2. **Never rewind or decrease sequences:** A `DocumentSequence` high-water mark is strictly append-only. Lowering a sequence is prohibited and rejected by application controls.
3. **Never reuse cancelled or voided numbers:** Under statutory Indian GST rules, cancelled or voided invoice numbers remain part of the historical serial registry and cannot be recycled or backfilled.
4. **Read-only preflight diagnostics:** The preflight utility (`pnpm run ei-numbering:preflight`) performs zero writes, zero table modifications, and zero sequence adjustments. It may be run repeatedly without operational side effects.
5. **No premature activation:** Sequence initialization and finalization must only occur during an approved maintenance window after the external accounting system is frozen.

---

## 2. Roles, Responsibilities & Approval Gates

| Role                             | Responsibilities                                                                                                                                                                                               | Mandatory Sign-Off Gates                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Accountant (Finance Lead)**    | • Owns external invoice registers and GST filings.<br>• Extracts and signs off on the live external high-water mark.<br>• Enforces freeze on legacy billing.<br>• Validates first ERVE-issued invoice.         | **Gate 1:** Authoritative ledger export sign-off.<br>**Gate 2:** Pre-baseline approval.<br>**Gate 3:** Post-cutover verification. |
| **Deployment Operator / DevOps** | • Executes read-only preflight diagnostic CLI.<br>• Executes baseline adjustment CLI when authorized.<br>• Inspects transaction logs and database health.<br>• Halts procedure if any check reports `BLOCKED`. | **Gate 2:** Preflight `READY` confirmation.<br>**Gate 3:** Sequence baseline execution log verification.                          |
| **Engineering (INV-006 Owner)**  | • Deploys INV-006 migration adding `TAX_INVOICE` to `DocumentType` enum.<br>• Delivers atomic allocation inside Tax Invoice finalization transaction.                                                          | **Prerequisite:** INV-006 merged and deployed.                                                                                    |

---

## 3. Phase 1: Cutover Preparation & Prerequisites

### 3.1 Prerequisite Verification Checklist

Before scheduling the cutover window, confirm that:

- [ ] Active Indian Financial Year (e.g. `2026-27`) exists in `financial_years` table with boundaries `YYYY-04-01` to `(YYYY+1)-03-31`.
- [ ] INV-006 database migration has been deployed, adding `TAX_INVOICE` to `DocumentType` and updating `DOCUMENT_PREFIXES`.
- [ ] Target environment (Dev, Staging, or Production) has been explicitly identified.
- [ ] The authorized Accountant has assembled the complete Tax Invoice ledger for the active FY from the legacy system.
- [ ] External source manifest metadata (`systemName`, `extractedAt`, `verifiedBy`) is prepared.

### 3.2 External Invoice Data Preparation

Export all issued, cancelled, and voided invoices for the active financial year from the legacy system as a JSON file (`external-ledger.json`):

```json
[
  {
    "invoiceNumber": "EI/26-27/0001",
    "invoiceDate": "2026-04-02",
    "status": "ISSUED",
    "sourceReference": "INV-2026-0001"
  },
  {
    "invoiceNumber": "EI/26-27/0002",
    "invoiceDate": "2026-04-03",
    "status": "CANCELLED",
    "sourceReference": "INV-2026-0002"
  }
]
```

Prepare manifest file (`manifest.json`):

```json
{
  "systemName": "Tally Prime ERP",
  "extractedAt": "2026-10-15T18:00:00.000Z",
  "verifiedBy": "lead.accountant@example.com",
  "notes": "Verified against GSTR-1 filings through September 2026."
}
```

---

## 4. Phase 2: Cutover-Time Verification (Preflight)

### 4.1 Step 1: External Billing Freeze

1. The Accountant issues a strict operational freeze on invoice generation in the legacy/external billing system.
2. Confirm zero draft or in-progress invoices remain uncommitted in the legacy system.
3. Export the final, immutable `external-ledger.json` and generate `manifest.json`.

### 4.2 Step 2: Run Read-Only Preflight Diagnostic

From `apps/api`:

```bash
# Example for local/dev validation
pnpm run ei-numbering:preflight \
  --financial-year 2026-27 \
  --external-records-file ./path/to/external-ledger.json \
  --manifest-file ./path/to/manifest.json \
  --target dev

# Example for production validation (strictly read-only)
pnpm run ei-numbering:preflight \
  --financial-year 2026-27 \
  --external-records-file /secure/path/external-ledger.json \
  --manifest-file /secure/path/manifest.json \
  --target production
```

### 4.3 Step 3: Interpret Diagnostic Results

Review each check in the console output:

| Status      | Meaning                                                                                                                                                             | Required Operator Action                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **PASS**    | Check completely verified with evidence.                                                                                                                            | Proceed.                                                                  |
| **WARN**    | Non-blocking condition (e.g. sequence uninitialized, approaching serial 9000, or cross-system overlap of known migrated records).                                   | Requires review and explicit Accountant sign-off before proceeding.       |
| **BLOCKED** | Fatal cutover blocker (missing FY, duplicate invoice numbers, malformed numbers, serial > 9999, sequence behind external reality, or missing external source data). | **STOP IMMEDIATELY.** Do not proceed with baseline adjustment or cutover. |

### 4.4 Diagnostic Checks Overview:

1. `CHK_FINANCIAL_YEAR`: Confirms target FY exists and calendar boundaries are strictly April 1 to March 31.
2. `CHK_DOCUMENT_TYPE_CONFIG`: Confirms `TAX_INVOICE` is registered in database enum and configuration.
3. `CHK_SEQUENCE_STATE`: Reports existing sequence state without creating or mutating rows.
4. `CHK_INVOICE_SYNTAX`: Confirms all ERVE and external invoice numbers match canonical regex `^EI\/(\d{2}-\d{2})\/(\d{4})$`.
5. `CHK_UNIQUENESS`: Detects duplicate invoice numbers within ERVE and external registers.
6. `CHK_FY_SEPARATION`: Detects any cross-FY attribution bleed.
7. `CHK_HIGH_WATER_RECON`: Reconciles external ledger max serial, ERVE max serial, and `DocumentSequence.lastAllocatedSerial`.
8. `CHK_NUMBER_COLLISION`: Confirms proposed next serial does not collide with any existing record.
9. `CHK_SERIAL_CAPACITY`: Assesses remaining headroom within the 4-digit serial capacity (1..9999).
10. `CHK_SOURCE_COMPLETENESS`: Assesses presence and completeness of external authoritative ledger and manifest.
11. `CHK_PERMISSIONS`: Confirms read-only execution with zero mutations.

---

## 5. Phase 3: Controlled Activation (Post-Approval)

> **CRITICAL SAFEGUARD:** This step must ONLY be performed after:
>
> 1. Preflight reports `READY` or `READY WITH CONDITIONS` (with approved sign-off).
> 2. Gate 2 approval from the Accountant is signed.
> 3. Legacy system billing freeze is active.

### 5.1 Step 1: Execute Sequence Baseline Adjustment

Once INV-006 is deployed, the operator sets the sequence high-water mark to the verified external serial:

```bash
# Example syntax:
tsx src/cli/document-sequence-baseline.cli.ts \
  --document-type TAX_INVOICE \
  --financial-year 2026-27 \
  --serial <VERIFIED_LIVE_HWM>
```

### 5.2 Idempotency & Invariant Verification:

- **First Run:** Sets `lastAllocatedSerial = <VERIFIED_LIVE_HWM>`. CLI reports `raised: TAX_INVOICE sequence for FY 2026-27 from 0 to <VERIFIED_LIVE_HWM>`.
- **Repeat Run:** If run again with the same serial, the CLI detects identical value and reports: `no-op: TAX_INVOICE sequence for FY 2026-27 is already at <VERIFIED_LIVE_HWM>`.
- **Attempted Decrease:** If accidentally run with a lower serial, the CLI rejects the command with an error: `Refusing to lower TAX_INVOICE sequence... sequences are never decreased`.

---

## 6. Phase 4: Post-Cutover Verification

Immediately following baseline setting and INV-006 activation:

1. **First Finalization Test:**
   - In coordination with the Accountant, finalize the first eligible ERVE Tax Invoice.
   - Inspect the generated `invoiceNumber`.
   - **Verification:** The invoice number must equal `EI/<FY>/<VERIFIED_LIVE_HWM + 1>` padded to 4 digits.
2. **Second Finalization Verification:**
   - Finalize a subsequent invoice or perform a dry-run allocation test.
   - Confirm serial increments by exactly 1 (`<VERIFIED_LIVE_HWM + 2>`).
3. **Audit Trail Retention:**
   - Save the preflight report (`--json` output) and baseline CLI execution logs in the release audit repository.
   - Archive `external-ledger.json` and `manifest.json` permanently.

---

## 7. Phase 5: Failure Handling, Stop Conditions & Rollback Guidance

### 7.1 Immediate Stop Conditions

Halt the cutover immediately if:

- Preflight diagnostic reports `BLOCKED`.
- Any external invoice number is malformed or lacks canonical `EI/<FY>/<4-digit serial>` formatting.
- Legacy system issues an invoice after the extraction timestamp.
- Database connection aborts mid-transaction.
- First finalized invoice generates a number that collides with historical records.

### 7.2 Rollback and Recovery Rules

1. **Never reset or decrement DocumentSequence:**
   - Even if the first post-cutover invoice is erroneous, **do not decrement `lastAllocatedSerial`**.
   - If an invoice is created in error, mark that invoice `CANCELLED` within ERVE according to statutory GST accounting workflows.
   - The sequence must continue forward. Under Indian GST law, gaps caused by cancelled invoices are acceptable when supported by documented cancellation logs, but duplicate numbers are strictly illegal.
2. **Partial Cutover Resolution:**
   - If sequence was raised but INV-006 activation fails, keep the sequence at the raised baseline. It will safely remain ready for retry once the underlying service issue is resolved.
