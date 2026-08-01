# Mobile operational scope

Mobile targets workflow parity where mobility has operational value. It does not mirror every
desktop page. A workflow is mobile-complete only when an authorized user can discover it, see
organizationally scoped records, complete permitted actions, understand the result, retry safely,
and continue to the next task without a placeholder.

## Role-by-role scope

| Role              | Mobile now                                                                                       | Access level                                              | Web remains primary                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Factory user      | Assigned job orders, assignment confirmation, production stages, completed quantities, QA rework | Factory-mapped records; operational updates               | Masters, flow configuration, bulk work, detailed reporting                          |
| QA user           | Inspection queue, quantity disposition, evidence, reinspection, final QA outcome                 | All factories; inspect and approve                        | QA configuration and detailed reporting                                             |
| Admin             | QA queue, factory exceptions and rework, pending QA approvals, recent activity                   | Cross-factory oversight and permitted operational actions | Master data, users, purchase orders, price lists, configuration, bulk work, reports |
| Merchandiser      | QA queue, factory exceptions and rework, pending QA approvals, recent activity                   | Cross-factory oversight and permitted operational actions | Purchase-order authoring, masters, price lists, configuration, bulk work, reports   |
| Senior management | No committed mobile workflow in this slice                                                       | None                                                      | Reporting and management oversight                                                  |
| Accountant        | No committed mobile workflow in this slice                                                       | None                                                      | Finance-oriented desktop workflows                                                  |
| Distributor       | No committed mobile workflow in this slice                                                       | None                                                      | Distributor desktop workflows                                                       |

Users with more than one role receive the union of the mobile workflows allowed by those roles.
Backend authorization and organization mapping remain authoritative; the home screen only exposes
entry points and summaries that match those rules.

## Home-screen contract

The mobile home provides role-appropriate entry points for active job orders, the QA queue, factory
exceptions and rework, pending approvals, and recent operational activity. Each summary loads
independently. A transient summary failure offers a retry and does not block other workflows.

Roles without a committed mobile workflow receive an explicit scope message directing
configuration-heavy work to the web application, rather than a generic future-feature placeholder.

## Deferred mobile workflows

- Packing
- Dispatch
- Delivery and proof of delivery
- Stock receipt
- Broader exception reporting and resolution

These items should be added to the home only when their end-to-end mobile workflows and permission
rules exist.

## Web-only scope

- Style, size, factory, and distributor masters
- Process-flow configuration
- User administration
- Distributor price-list maintenance
- Purchase-order creation and complex editing
- Detailed reporting and bulk operations
- Other configuration-heavy administration
