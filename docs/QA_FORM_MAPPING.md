# QA sample checklist mapping (ERVE-015)

The supplied paper form is represented by the existing Job Order context and
the inspection session. No current master-data value is copied into QA.

| Paper form field                                            | System representation                                                                                     |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Factory, PO/Customer, item/style, description, colour, size | Read-only Job Order, PO, Style and `JobOrderLineSize` context                                             |
| Date, inspector/signatures                                  | Inspection creation/finalization timestamps and authenticated inspector; no signature image is fabricated |
| Season                                                      | Immutable `JobOrderSeasonSnapshot` display value                                                          |
| Quantity of samples                                         | Optional `QaInspectionSession.sampleQuantity`                                                             |
| Remarks                                                     | Optional `QaInspectionSession.notes` / API `notes`; multiline, trimmed, max 2,000 characters, null when blank |
| Fabric construction, stated GSM                             | No existing authoritative Job Order field; unsupported rather than guessed                                |
| 15 checklist rows, Yes / No / Available columns, Remarks    | `QaInspectionChecklistItem.itemCode`, nullable `status`, and optional `remarks`                           |
| Pass/fail disposition and defect evidence                   | Existing size-wise QA quantity, defect, evidence, approval, and rework model                              |

## Checklist rows

All rows below are optional while a session is editable. A blank paper-form
mark is persisted and returned as `null`; remarks are independently optional.
The allowed stored/API values are exactly `YES`, `NO`, and `AVAILABLE`, which
are the literal headings printed on the paper form (not an inferred N/A
value). Web and mobile render the controls in this order and use the same
persisted/API values.

| Paper-form label                                                                                      | DB/API item code                     | Web and mobile |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------- |
| Confirm fabric has been checked and is correct colour and quality (Approved Shade band / Bulk Hanger) | `FABRIC_COLOUR_QUALITY`              | Mark + remarks |
| Confirm trims is available and checked as per trims card                                              | `TRIMS_CARD`                         | Mark + remarks |
| Confirm fabric gsm is correct                                                                         | `FABRIC_GSM`                         | Mark + remarks |
| Confirm all measurements are within tolerance and measurement report is attached                      | `MEASUREMENTS_REPORT`                | Mark + remarks |
| Confirm garment construction is correct and as per all previous samples comment                       | `GARMENT_CONSTRUCTION`               | Mark + remarks |
| Confirm samples general quality and presentation are acceptable                                       | `GENERAL_QUALITY_PRESENTATION`       | Mark + remarks |
| Confirm Labelling Position have been checked and correct                                              | `LABELLING_POSITION`                 | Mark + remarks |
| Fit sample made based on buyer comments                                                               | `FIT_SAMPLE_BUYER_COMMENTS`          | Mark + remarks |
| Confirm SPI is correct (outside 11-12 per inch and inside 12-13 per inc)                              | `SPI`                                | Mark + remarks |
| Confirm Sample tag with details                                                                       | `SAMPLE_TAG`                         | Mark + remarks |
| Confirm all Data Sheet/Pull Test/Pinch Setting have been checked and are correct                      | `DATA_SHEET_PULL_TEST_PINCH_SETTING` | Mark + remarks |
| Confirm Metal Detection have been checked and are correct                                             | `METAL_DETECTION`                    | Mark + remarks |
| Confirm P&P have been checked and are correct                                                         | `P_AND_P`                            | Mark + remarks |
| Confirm PP sample made based on fit comments                                                          | `PP_SAMPLE_FIT_COMMENTS`             | Mark + remarks |
| Source declaration form available                                                                     | `SOURCE_DECLARATION_FORM`            | Mark + remarks |

`QaInspectionChecklistItem.status` and `.remarks` are exposed as
`QaInspectionSessionView.checklist[].status` and `.remarks`; no response
conversion or defaults are applied. `sample_quantity` is likewise optional,
and is exposed as `sampleQuantity`.

The paper form does not establish a separate finalization rule for unanswered
checks, so draft/finalization behavior remains the existing QA lifecycle.

`OTHER` is a line-level `QaInspectionLine.defectCategory` value. Its required,
trimmed explanation is stored on that same line as `otherDefectDetails` (max
2,000 characters); it is cleared from the payload for every other defect type.

## Web-entry scope

The web `QaDetailPage` is the complete QA inspection workflow: authorized
users can start, save, edit and finalize an inspection there, while the
existing detail sections retain evidence, approval, reopen, reconciliation and
audit access. Mobile provides the operational form using the same API contract
and persisted data. Authorization remains enforced by the API.
