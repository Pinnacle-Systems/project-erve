# QA slice acceptance record

Date: 2026-07-30

## Automated acceptance

The isolated PostgreSQL target is `erve_test`; migration `20260729160000_add_qa_workflow` applied successfully. The focused QA API suite proves:

- full inspection, final approval, purchase-order QA-passed propagation, idempotent replay and single audit emission;
- prepared-capacity rejection, stale concurrent save rejection and idempotency payload-mismatch rejection;
- QA global visibility without factory mapping, factory-route denial, required permanent-rejection evidence, factory-scoped evidence reads, successful permanent rejection and final approved quantity derivation;
- partial acceptance, factory acknowledgement, ready-for-reinspection handoff, reinspection, protected accepted quantity and final approval after rework.

Client regression results:

- shared client: 1 file, 8 tests passed;
- web: 12 files, 103 tests passed;
- mobile: 12 files, 101 tests passed.

Repository typecheck, lint and production builds pass. The full isolated API suite passed 77 files / 276 tests with no failures.

## Packaged Android verification

`apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk` was built from the current worktree, installed with `adb install -r` on `emulator-5554`, and launched as `com.erve.mobile` version `1.0` (`versionCode=1`). Artifact size: 5,319,500 bytes.

The existing secure session survived reinstall/cold start, but session recovery displayed `Temporarily unavailable`. `adb reverse tcp:4000 tcp:4000` was restored and the local API health endpoint returned HTTP 200; retry remained unavailable. No test credentials were available to replace the saved session safely. Therefore the packaged UI workflows, camera/gallery selection, the focused leading-zero smoke test, and device-level scenarios A-G are **not accepted as executed**. API automation and APK installation do not substitute for that device acceptance.

## Scenario status

- A — full acceptance: passed through the real API and database; packaged Android not executed.
- B — partial acceptance and rework: passed through the real API and database, including reinspection and final approval; packaged Android not executed.
- C — permanent rejection: passed through the real API, file storage and database; packaged Android camera/gallery not executed.
- D — concurrent inspectors: passed at the mutation/concurrency boundary; two physical devices not used.
- E — retry after timeout: exact replay and payload mismatch passed; an actual network timeout was not induced on device.
- F — authorization: QA is global for active QA users; factory workflows and factory-user evidence remain scoped.
- G — interrupted mobile workflow: local draft persistence is implemented and mobile tests pass; physical connectivity interruption/recovery was not executed.

Warehouse, stock, receipt, allocation, reservation, packing, dispatch, invoicing, returns, payments, Tally, notifications and dashboards were not started.
