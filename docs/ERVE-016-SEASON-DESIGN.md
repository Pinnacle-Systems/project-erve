# ERVE-016 season design

Season is reusable master data: `seasons` stores a configurable operational
`code`, descriptive free-form trimmed `name`, compact `YY-YY` financial year
whose end year must be consecutive, and an active state. Codes are normalized
to uppercase and accept 1–20 letters, numbers, hyphens, or slashes; names
preserve their human-readable casing. Case-insensitive unique indexes protect
`(code, financial_year)` without prescribing any values. Descriptive names
are not identity and may be shared by different codes in a financial year.
Compact display is `CODE YY-YY`; supporting detail is
`CODE YY-YY — descriptive name`.

`style_seasons` is a normalized many-to-many mapping with a composite primary
key. A Style create request requires one or more active season IDs; updates
replace the selected set and retain inactive existing mappings when submitted.
Inactive Seasons cannot be newly assigned, but remain visible and removable on
an existing Style; unrelated edits preserve those mappings. Administrators and
Merchandisers manage the Season master through `/master-data/seasons`; other
roles receive Season data only through an authorized parent response.

Historical data deliberately does not read this mapping. Each purchase-order
line copies every current Style Season into `purchase_order_line_season_snapshots`
(`season_id`, code, name, financial year, display label). Job Orders copy the union
of their selected PO-line snapshots into `job_order_season_snapshots`. The
snapshot fields are the display source, so later master edits or deactivation
cannot rewrite documents. No backfill is performed because pre-production
records must not receive invented Seasons.

The current repository contains QA workflow records but no stock, dispatch,
packing, invoice, or reporting modules. QA reads its authoritative Job Order;
additional transactional modules should copy its Job Order snapshot at creation
using the same four-field shape, rather than re-reading Style mappings.

QA currently has Job Order context but no independent Season snapshot column;
its fuller inheritance model is deferred with ERVE-015. Stock, dispatch,
packing, invoice, reporting, filtering, and exports are not implemented
modules and remain deliberately deferred. Applied migration files are
immutable, including comments. Hand-written migration identifiers must follow
Prisma's convention-derived foreign-key and index names; corrective changes
belong in a new migration, never an edited historical migration.

The `20260805110000_add_season_code_and_snapshot_code` migration deliberately
adds required code fields without defaults. It works from an empty database;
an existing database with Season or snapshot rows must have disposable data
reset or be deliberately corrected before it is applied. The migration never
guesses a descriptive name from an operational code, and historical snapshots
retain code, name, and financial year even after master edits.

For a disposable pre-production upgrade, back up anything needed for review,
drop and recreate the dedicated disposable database, then run `prisma migrate
deploy` with that database as `DATABASE_URL`. For example, with Podman:
`psql -d postgres -c 'DROP DATABASE erve_upgrade_test WITH (FORCE)'` followed
by `CREATE DATABASE erve_upgrade_test`, then `prisma migrate deploy`. This
removes only disposable data and applies the full migration chain. Alternatively,
populate every existing Season and PO/Job Order snapshot with deliberately
chosen code and descriptive name values before applying the migration. Never
run either procedure against production, staging, or `erve_dev` without an
approved data migration.
