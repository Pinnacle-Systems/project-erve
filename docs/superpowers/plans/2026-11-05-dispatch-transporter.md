# Assigned Transporter implementation plan

Spec: user-approved A2 / ISS-078 Phase B, 2026-11-05.
Base: 22d564992c293d55315b87314cce1017e6029a40.

1. Role foundation: exclusive TRANSPORTER role, additive enum/nullable assignment migrations, bootstrap/seed compatibility and server-side role mutation checks. Verify exclusive-role/provisioning unit cases before proceeding.
2. Transport API: separate permissions; bounded assigned list and account picker; minimal DTO; locked, versioned, audited assignment and LR writes. Verify isolation, revocation, stale writes, redaction and existing internal behavior with database-free named tests.
3. Workspace: reuse Transport & Delivery form; restricted assigned list/detail; internal assignment picker; preserve delivery gates and drafts. Verify named frontend tests and one mocked browser smoke.
4. Review complete diff, run affected-file diagnostics, obtain a fresh whole-branch review, fix findings, commit/push and open one PR. Stop at handoff; never inspect CI or merge.

Constraints: no shared database writes/migrations, no broad tests/builds, no E-Way Bill worktree changes, no QR/receipt/finance/inventory implementation.
Migration order: enum addition commits before dependent role use; nullable association follows; role bootstrap before application release and account provisioning. No historical backfill.
Review focus: concurrent role grants; assignment revocation during writes/responses; minimal PATCH response; forced frontend tabs/full-detail fetches; historical null assignments.
