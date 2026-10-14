# ERVE India — Operational Runbook: EI Tax Invoice Numbering Cutover

**Document:** `EI_NUMBERING_CUTOVER_RUNBOOK.md`  
**Story Reference:** INV-012 (EI Numbering Cutover Preparation)  
**Downstream Dependency:** INV-006 (Tax Invoice Finalization & Atomic Number Allocation)  
**Governing Standard:** Indian GST (Section 31 CGST Act / Rule 46 CGST Rules) & ERVE Financial Year Infrastructure  
**Canonical Invoice Syntax:** `EI/<FY>/<serial>` with a 4-digit minimum width (e.g., `EI/26-27/0001`). Note: Serials $\ge 10000$ format with 5+ digits under the shared formatter; exceeding 9999 represents an unresolved width policy that blocks production cutover when it affects the next allocation.

---

## 1. Executive Summary & Cutover Scope

This runbook defines the idempotent, operator-controlled procedure for transitioning Tax Invoice numbering from the existing external accounting system (e.g. Tally, physical register, or legacy ERP) into ERVE India.

### Core Invariants:

1. **Never guess the high-water mark:** Allocation must continue from the _actual verified live high-water mark_ of issued Tax Invoices in the active Indian Financial Year (1 April – 31 March). Illustrative numbers (such as `0270`) must never be used as default or assumed values.
2. **Never rewind or decrease sequences:** A `DocumentSequence` high-water mark is strictly append-only. Lowering a sequence is prohibited and rejected by application controls.
3. **Never reuse cancelled, voided, or reversed numbers:** Under statutory Indian GST rules, cancelled, voided, or reversed invoice numbers remain part of the historical serial registry and cannot be recycled, backfilled, or reassigned under any circumstances, regardless of the eventual lifecycle state design in ERVE.
4. **Read-only preflight diagnostics:** The preflight utility (`pnpm run ei-numbering:preflight`) performs zero writes, zero table modifications, and zero sequence adjustments. It may be run repeatedly without operational side effects.
5. **No premature activation:** Sequence initialization and finalization must only occur during an approved maintenance window after the external accounting system is frozen.

---

## 2. Roles, Responsibilities & Approval Gates

| Role                             | Responsibilities                                                                                                                                                                                               | Mandatory Sign-Off Gates                                                                                                          |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Accountant (Finance Lead)**    | • Owns external invoice registers and GST filings.<br>• Extracts and signs off on the live external high-water mark.<br>• Enforces freeze on legacy billing.<br>• Validates first ERVE-issued invoice.         | **Gate 1:** Authoritative ledger export sign-off.<br>**Gate 2:** Pre-baseline approval.<br>**Gate 3:** Post-cutover verification. |
| **Deployment Operator / DevOps** | • Executes read-only preflight diagnostic CLI.<br>• Executes baseline adjustment CLI when authorized.<br>• Inspects transaction logs and database health.<br>• Halts procedure if any check reports `BLOCKED`. | **Gate 2:** Preflight `READY` confirmation.<br>**Gate 3:** Sequence baseline execution log verification.                          |
| **Engineering (INV-006 Owner)**  | • Deploys INV-006 migration adding `TAX_INVOICE` to `DocumentType` enum.<br>• Delivers atomic allocation inside Tax Invoice finalization transaction.<br>• Enforces sequence gates preventing auto-seed at 1.  | **Prerequisite:** INV-006 merged and deployed.                                                                                    |

### 2.1 Manifest Attestation vs Physical Operational Verification

- **Manifest as Self-Attestation:** The metadata in `manifest.json` (`systemName`, `extractedAt`, `verifiedBy`, `freezeConfirmed`) is a machine-readable operational declaration accompanying the data export. It does **not** constitute independent proof of accountant sign-off or physical billing freeze.
- **Mandatory Operational Verification:** Prior to sequence baseline adjustment or production activation, the Deployment Operator must obtain documented authorization (e.g., change request sign-off) and independently verify that external billing is physically frozen (e.g. ERP write permissions revoked, batch billing services halted, and confirmed in writing by Finance).

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
  "freezeConfirmed": true,
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

From the release directory on the host (e.g., `/var/www/erve/current/` or within `apps/api` during local development):

```bash
# Standalone packaged CLI on server (Node.js 24 runtime, zero tsx/dev dependency):
node api/ei-numbering-preflight.js \
  --target dev \
  --financial-year 2026-27 \
  --external-records-file ./path/to/external-ledger.json \
  --manifest-file ./path/to/manifest.json \
  --expect-database erve_dev

# Production diagnostic execution (strictly read-only):
node api/ei-numbering-preflight.js \
  --target production \
  --financial-year 2026-27 \
  --external-records-file /secure/path/external-ledger.json \
  --manifest-file /secure/path/manifest.json \
  --expect-database erve_prod
```

### 4.3 Step 3: Interpret Diagnostic Results

The diagnostic evaluates four distinct readiness dimensions:

1. **Preparation Completeness (`isPreparationReady`):** Validates that external ledgers, manifests, FY boundaries, and historical serial reconciliation are sound. Missing downstream INV-006 schema dependencies do not prevent preparation completeness.
2. **Schema & Config Readiness (`isSchemaConfigReady`):** Validates that `DocumentType.TAX_INVOICE` and `DOCUMENT_PREFIXES.TAX_INVOICE` are migrated in the database and active.
3. **Baseline Reconciliation Readiness (`isBaselineReconciliationReady`):** Validates that all prerequisite data evidence (FY boundaries, syntax, uniqueness, collision checks, capacity limits, and manifest structure) is sound, formally clearing the operator to execute sequence baseline adjustment.
4. **Production Cutover Readiness (`isProductionCutoverReady`):** Strict production activation readiness. Requires baseline reconciliation to be complete (`sequenceLastAllocatedSerial === verifiedHighWaterMark`), schema readiness, accountant manifest verification, independent physical freeze verification, and zero blocked checks.

Review check status codes in the output:

| Status      | Meaning                                                                                                                                                                                                                                | Required Operator Action                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **PASS**    | Check completely verified with evidence.                                                                                                                                                                                               | Proceed.                                                                                                                             |
| **WARN**    | Non-blocking condition in dev/prep (e.g. sequence uninitialized, approaching serial 9000, or cross-system ambiguous match).                                                                                                             | Requires review and explicit Accountant sign-off before proceeding.                                                                  |
| **BLOCKED** | Fatal cutover blocker (missing FY, duplicate invoice numbers, malformed numbers, serial > 9999 affecting next allocation, or missing/invalid manifest). Pre-baseline sequence shortfall blocks live allocation pending baseline adjustment. | **STOP IMMEDIATELY on data integrity errors.** If sequence shortfall is the only blocker and evidence is verified, proceed to Gate 2. |

### 4.4 Diagnostic Checks Overview:

1. `CHK_FINANCIAL_YEAR`: Confirms target FY exists and calendar boundaries are strictly April 1 to March 31.
2. `CHK_DOCUMENT_TYPE_CONFIG`: Confirms `TAX_INVOICE` is registered in database enum and configuration. (Permitted as WARN in DEV/LOCAL; strictly BLOCKED in PRODUCTION).
3. `CHK_SEQUENCE_STATE`: Reports existing sequence state without creating or mutating rows. In production, uninitialized sequence blocks live allocation pending baseline adjustment.
4. `CHK_INVOICE_SYNTAX`: Confirms all ERVE and external invoice numbers match formatter syntax `^EI\/(\d{2}-\d{2})\/(\d{4,})$` ($\ge 4$ digits). Identifies serials exceeding 4 digits.
5. `CHK_UNIQUENESS`: Detects duplicate invoice numbers within ERVE and external registers. Inspects cross-system matches: matching number, date, and status alone cannot prove identical underlying invoices. Requires authoritative identity evidence (`sourceReference`); ambiguous matches are flagged for operator review.
6. `CHK_FY_SEPARATION`: Detects any cross-FY attribution bleed.
7. `CHK_HIGH_WATER_RECON`: Reconciles external ledger max serial, ERVE max serial, and `DocumentSequence.lastAllocatedSerial`. Rejects manually entered HWM without authoritative manifest in production. In production pre-baseline state, sequence shortfall blocks live allocation pending baseline adjustment.
8. `CHK_NUMBER_COLLISION`: Confirms proposed next serial does not collide with any existing record.
9. `CHK_SERIAL_CAPACITY`: Assesses remaining serial capacity. Warns between 9000–9999. Does not impose an arbitrary hard limit of 9999, but identifies when serial exceeds 4 digits and blocks production cutover if an unresolved 5-digit policy affects the next allocation.
10. `CHK_SOURCE_COMPLETENESS`: Validates manifest presence, completeness, and declared metadata. Manifest metadata is an accompanying operational self-attestation and does not constitute independent proof of accountant sign-off or physical billing freeze.
11. `CHK_PERMISSIONS`: Confirms read-only execution with zero mutations.

---

## 5. Operational Sequence Procedures

Two distinct operational procedures govern sequence initialization. Follow the appropriate procedure based on operational phase.

### Procedure A — Internal UAT Sequence Initialization

> [!WARNING]
> **CRITICAL ENVIRONMENT NOTICE:**
> Customer UAT is conducted directly on the production-hosted Hostinger VPS environment (`DATABASE_URL` pointing to `erve_prod`). While UAT documents are internal test invoices preceding commercial sign-off, **the database must be treated as a live production environment for all safety controls and authorization**. Do NOT bypass production safeguards.

#### A.1 Objective & Context
To unblock customer testing and Tax Invoice finalization during internal UAT. In this phase, the database has been bootstrapped for UAT. A baseline of `0` is initialized on the fresh sequence so that the first finalized test invoice receives serial `1` (`EI/26-27/0001`).

After UAT concludes and prior to commercial go-live, the database will undergo a formal approved reset and bootstrap, followed by Procedure B.

#### A.2 Preconditions & Target Verification
1. Confirm the release artifact has been extracted to `/var/www/erve/current/` (or staging path). Note: Prisma Client is generated during release artifact construction on the build runner by `package-production.sh` (as part of `pnpm deploy`), not on the VPS during extraction.
2. Verify executable availability without needing database connectivity:
   ```bash
   node /var/www/erve/current/api/document-sequence-baseline.js --help
   node /var/www/erve/current/api/ei-numbering-preflight.js --help
   ```
3. Runtime Environment Resolution:
   - The CLIs automatically discover and load environment configuration from `.env` located next to the CLI executable (`/var/www/erve/current/api/.env`, symlinked to `/var/www/erve/shared/api.env`), regardless of the operator's current working directory.
   - Alternatively, operators may supply an explicit configuration path via `--env-file /var/www/erve/shared/api.env`.
4. Confirm target database parameters from `/var/www/erve/shared/api.env`:
   - Connected DB Name: `erve_prod`
   - Active FY: `2026-27`
   - Active Schema: `public`

#### A.3 Current Sequence Inspection
Run read-only preflight diagnostic to inspect current sequence state:
```bash
node /var/www/erve/current/api/ei-numbering-preflight.js \
  --target production \
  --financial-year 2026-27 \
  --expect-database erve_prod
```
Verify that `sequenceState.exists` is reported as uninitialized (or at approved baseline) and no data collisions exist.

#### A.4 Selecting a Safe Test Baseline
- **Fresh UAT sequence:** Choose baseline `0`. Setting baseline `0` records that `lastAllocatedSerial = 0`. The first invoice will atomically allocate serial `1` (`EI/26-27/0001`).
- **Offset test sequence:** If Accounts requires test invoices to occupy a distinct test partition (e.g. starting at 1001), choose baseline `1000`.

#### A.5 Execution with Packaged CLI
1. **Dry-Run Simulation:** Validate connectivity, targets, expected schema, and transaction rollback without committing changes:
   ```bash
   node /var/www/erve/current/api/document-sequence-baseline.js \
     --target production \
     --document-type TAX_INVOICE \
     --financial-year 2026-27 \
     --serial 0 \
     --expect-database erve_prod \
     --expect-schema public \
     --confirm-production \
     --dry-run
   ```
   Verify the dry-run summary: `[DRY RUN] Would initialize TAX_INVOICE sequence for FY 2026-27 at 0`.

2. **Authorized Live Execution:**
   ```bash
   node /var/www/erve/current/api/document-sequence-baseline.js \
     --target production \
     --document-type TAX_INVOICE \
     --financial-year 2026-27 \
     --serial 0 \
     --expect-database erve_prod \
     --expect-schema public \
     --confirm-production
   ```
   Expected output:
   ```text
   ======================================================================
   ERVE India — Document Sequence Baseline Operation Summary
   ======================================================================
   Target Environment:      PRODUCTION
   Configured Endpoint:     localhost:5432
   Server-Reported Address: 127.0.0.1:5432
   Database Name:           erve_prod
   Database Schema:         public
   Document Type:           TAX_INVOICE
   Financial Year:          2026-27
   Requested Serial:        0
   Current Baseline:        Uninitialized (row does not exist)
   Action:                  INITIALIZE sequence at 0 (next allocated serial will be 1)
   ======================================================================
   initialized: TAX_INVOICE sequence for FY 2026-27 at 0 (next allocated serial will be 1)
   ```

#### A.6 Next Invoice Verification
1. Create and finalize the first test Tax Invoice in ERVE UI.
2. Confirm the assigned invoice number is strictly `EI/26-27/0001`.
3. Create and finalize a second invoice; confirm serial is `EI/26-27/0002`.

#### A.7 Error Inspection & Recovery
- **Missing `NODE_ENV=production`:** In production mutation mode, omitting `NODE_ENV=production` fails closed with: `ERROR: Production mutation requires explicit NODE_ENV="production", but found "<env>".`
- **Missing `--confirm-production`:** The CLI exits immediately with code 1: `ERROR: Production execution requires explicit confirmation via --confirm-production`.
- **Missing `--expect-schema`:** In production mutation mode, omitting `--expect-schema` fails closed with: `ERROR: Production mutation requires --expect-schema <schema> (e.g. "public")`.
- **Database Mismatch:** If `--expect-database` does not match `SELECT current_database()`, the CLI exits with code 1 without executing SQL transactions.
- **Repeat Execution:** Executing the identical command again is idempotent and reports `no-op: TAX_INVOICE sequence for FY 2026-27 is already at 0`.
- **Accidental Decrement:** Attempting to specify a serial lower than the current database state is rejected and leaves the sequence unchanged.

---

### Procedure B — Commercial Go-Live Sequence Initialization

> [!IMPORTANT]
> **COMMERCIAL SIGN-OFF PREREQUISITE:**
> Procedure B is strictly reserved for the final production commercial cutover. Execution of this procedure is OUT OF SCOPE for RST-002 and requires separate formal Change Advisory Board (CAB) and Finance Lead sign-off.

#### B.1 Prerequisite Requirements
1. **Database Reset and Bootstrap:** Complete the approved production database reset and bootstrap procedure.
2. **Official Invoice Register:** Obtain verified `external-ledger.json` from Accounts containing every issued, cancelled, and voided Tax Invoice up to the freeze cutoff.
3. **Legacy Billing Freeze:** Verify that legacy system billing permissions are revoked and automated batch runs are halted.
4. **Reconciled High-Water Mark:** Confirm that the last-issued commercial serial number is reconciled across all physical and electronic registers.
5. **Signed Manifest:** Obtain `manifest.json` signed with Accountant email/name and extraction timestamp.

#### B.2 Cutover Preflight Execution
Run read-only preflight to verify all 11 commercial gates:
```bash
node /var/www/erve/current/api/ei-numbering-preflight.js \
  --target production \
  --financial-year 2026-27 \
  --external-records-file /secure/path/external-ledger.json \
  --manifest-file /secure/path/manifest.json \
  --expect-database erve_prod
```
Preflight must report `isBaselineReconciliationReady: true` with 0 BLOCKED checks.

#### B.3 Authorized Commercial Baseline Execution
Execute sequence baseline advancement using the verified external high-water mark serial ($N$):
```bash
node /var/www/erve/current/api/document-sequence-baseline.js \
  --target production \
  --document-type TAX_INVOICE \
  --financial-year 2026-27 \
  --serial <VERIFIED_COMMERCIAL_HWM> \
  --expect-database erve_prod \
  --expect-schema public \
  --confirm-production
```

#### B.4 Post-Baseline Cutover Verification
Immediately rerun preflight:
```bash
node /var/www/erve/current/api/ei-numbering-preflight.js \
  --target production \
  --financial-year 2026-27 \
  --external-records-file /secure/path/external-ledger.json \
  --manifest-file /secure/path/manifest.json \
  --expect-database erve_prod
```
Confirm:
- `isProductionCutoverReady: true`
- `CHK_SEQUENCE_STATE: PASS`
- `CHK_HIGH_WATER_RECON: PASS`

#### B.5 First Commercial Invoice Guarantee
- The first live commercial Tax Invoice generated in ERVE will receive serial `VERIFIED_COMMERCIAL_HWM + 1`.
- Under Indian GST Rule 46, **no previously issued commercial invoice number may ever be reused**.
- If a live commercial invoice is later cancelled, its serial is permanently consumed; the sequence never decreases.

Only when `isProductionCutoverReady: true` is confirmed may live Tax Invoice generation and finalization be activated in ERVE.

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

- Preflight diagnostic reports `BLOCKED` on any data integrity, schema, or manifest check (`CHK_FINANCIAL_YEAR`, `CHK_DOCUMENT_TYPE_CONFIG`, `CHK_INVOICE_SYNTAX`, `CHK_UNIQUENESS`, `CHK_NUMBER_COLLISION`, `CHK_SERIAL_CAPACITY`, or `CHK_SOURCE_COMPLETENESS`). (Note: Sequence shortfall prior to baseline adjustment is expected and resolved in Phase 3, Step 1).
- Following Step 1 baseline adjustment, post-baseline preflight fails to report `isProductionCutoverReady: true`.
- Legacy system issues an invoice after the extraction timestamp.
- Database connection aborts mid-transaction.
- First finalized invoice generates a number that collides with historical records.

### 7.2 Rollback and Recovery Rules

1. **Never reset or decrement DocumentSequence:**
   - Even if the first post-cutover invoice is erroneous, **do not decrement `lastAllocatedSerial`**.
   - If an invoice is created in error, mark that invoice cancelled, voided, or reversed within ERVE according to statutory GST accounting workflows without releasing the invoice number.
   - The sequence must continue forward. Under Indian GST law, gaps caused by cancelled invoices are acceptable when supported by documented cancellation logs, but duplicate numbers are strictly illegal.
2. **Partial Cutover Resolution:**
   - If sequence was raised but INV-006 activation fails, keep the sequence at the raised baseline. It will safely remain ready for retry once the underlying service issue is resolved.

---

## 8. Downstream Engineering Handoff to INV-006

INV-006 owns Tax Invoice finalization, statutory GST calculations, and atomic document sequence allocation. The following architectural constraints and invariants established in INV-012 must be respected:

### 8.1 Sequence Auto-Seed Guard

Existing sequence infrastructure (`allocateDocumentSerial`) defaults to creating a sequence row starting at `lastAllocatedSerial = 1` if no record exists for the given Financial Year and DocumentType.
**Requirement for INV-006:** For `TAX_INVOICE`, INV-006 must explicitly prevent automatic sequence initialization starting at serial 1 until historical high-water mark reconciliation and cutover gates are completed and verified. Attempting to allocate a Tax Invoice serial on an un-baselined sequence in production must throw a fatal guard exception.

### 8.2 Invoice Number Immutability & Anti-Reuse Invariant

Under GST Rule 46, Tax Invoice numbers must be consecutive, unique, and strictly non-reusable:

- Once an invoice number is allocated (e.g. `EI/26-27/0271`), that number is permanently consumed.
- If an invoice is subsequently cancelled, voided, or reversed, its invoice number must never be released, recycled, backfilled, or reassigned to another invoice.
- Gaps in sequence resulting from cancellations are permitted by GST authorities when supported by documented cancellation logs; duplicate or recycled numbers are strictly prohibited.

### 8.3 Lifecycle State Design Independence

INV-012 does not prescribe a specific `CANCELLED` enum on `TaxInvoiceStatus`. INV-006 is free to implement the finalized lifecycle domain design (e.g., status flags, cancellation audit entities, or credit note linkages) provided the anti-reuse invariant above is strictly enforced.

### 8.4 Schema & Configuration Deployment

INV-006 must deploy:

1. Prisma migration adding `TAX_INVOICE` to the `DocumentType` database enum.
2. Mapping in `DOCUMENT_PREFIXES` in `apps/api/src/modules/master-data/document-number.util.ts`:
   ```typescript
   TAX_INVOICE: 'EI',
   ```
