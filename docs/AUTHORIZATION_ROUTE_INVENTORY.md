# ERVE-018 Exact API Route Inventory

Generated from the API route declarations on 2026-08-05. Each row is a separately authorized endpoint. Policy codes and their allowed roles are defined in `docs/AUTHORIZATION_MATRIX.md`; `requireAuth` applies to every non-public module route before the listed middleware.

| Module | Method | Route | Policy | Record/status scope | Enforcement middleware | Unauthorized result |
| --- | --- | --- | --- | --- | --- | --- |
| Auth | POST | `/auth/login` | PUBLIC | public session/probe operation | `router-level policy` | validation/auth failure as applicable |
| Auth | POST | `/auth/refresh` | PUBLIC | public session/probe operation | `router-level policy` | validation/auth failure as applicable |
| Auth | POST | `/auth/mobile/login` | PUBLIC | public session/probe operation | `router-level policy` | validation/auth failure as applicable |
| Auth | POST | `/auth/mobile/refresh` | PUBLIC | public session/probe operation | `router-level policy` | validation/auth failure as applicable |
| Auth | POST | `/auth/mobile/logout` | PUBLIC | public session/probe operation | `router-level policy` | validation/auth failure as applicable |
| Auth | POST | `/auth/logout` | PUBLIC | public session/probe operation | `router-level policy` | validation/auth failure as applicable |
| Auth | GET | `/auth/me` | AUTH | active current user | `requireAuth` | 401 |
| Users | POST | `/users/` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | GET | `/users/` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | GET | `/users/:id` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | PATCH | `/users/:id` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | PATCH | `/users/:id/status` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | POST | `/users/:id/reset-password` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | POST | `/users/:id/roles` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | DELETE | `/users/:id/roles/:roleName` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | POST | `/users/:id/distributors` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | DELETE | `/users/:id/distributors/:distributorId` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | POST | `/users/:id/factories` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Users | DELETE | `/users/:id/factories/:factoryId` | A | global | `router-level policy` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/distributors/` | D | distributor user: sole mapped distributor | `canViewDistributors` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/distributors/` | A | global | `canManageDistributors` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/distributors/:id` | D | distributor user: sole mapped distributor | `canViewDistributors` | 401 unauthenticated; 403 role/scope |
| Master data | PATCH | `/distributors/:id` | A | global | `canManageDistributors` | 401 unauthenticated; 403 role/scope |
| Master data | PATCH | `/distributors/:id/status` | A | global | `canManageDistributors` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/distributors/:id/users` | A | global | `canManageDistributors` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/styles/` | STYLE-R | global style read | `canViewStyles` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/styles/` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/styles/:id` | STYLE-R | global style read | `canViewStyles` | 401 unauthenticated; 403 role/scope |
| Master data | PATCH | `/styles/:id` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | PATCH | `/styles/:id/status` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/styles/:id/sizes` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | DELETE | `/styles/:id/sizes/:sizeId` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/styles/:id/factories` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | DELETE | `/styles/:id/factories/:factoryId` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/styles/:id/images` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/styles/:id/images` | STYLE-R | global style read | `canViewStyles` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/styles/:id/images/:imageId/content` | STYLE-R | global style read | `canViewStyles` | 401 unauthenticated; 403 role/scope |
| Master data | PUT | `/styles/:id/images/:imageId` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | DELETE | `/styles/:id/images/:imageId` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | PATCH | `/styles/:id/images/:imageId/primary` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/sizes/` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/sizes/` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/sizes/:id` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | PATCH | `/sizes/:id` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | PATCH | `/sizes/:id/status` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/factories/` | F | factory user: mapped factories | `canViewFactories` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/factories/:id/users` | A | global | `requireRoles('ADMIN')` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/factories/` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/factories/:id` | F | factory user: mapped factories | `canViewFactories` | 401 unauthenticated; 403 role/scope |
| Master data | PATCH | `/factories/:id` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | PATCH | `/factories/:id/status` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/process-flows/` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/process-flows/` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/process-flows/:id` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/process-flows/:id/versions` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | GET | `/process-flow-versions/:id` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | POST | `/process-flow-versions/:id/activate` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Master data | PUT | `/process-flow-versions/:id/stages` | M | global | `canManageMasterData` | 401 unauthenticated; 403 role/scope |
| Price lists | GET | `/price-lists/` | P | distributor: own ACTIVE price lists | `canViewPriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | POST | `/price-lists/` | M | global | `canManagePriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | GET | `/price-lists/lookup` | P | distributor: own ACTIVE price lists | `canViewPriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | GET | `/price-lists/distributors/:distributorId/history` | P | distributor: own ACTIVE price lists | `canViewPriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | GET | `/price-lists/:id` | P | distributor: own ACTIVE price lists | `canViewPriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | PATCH | `/price-lists/:id` | M | global | `canManagePriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | POST | `/price-lists/:id/lines` | M | global | `canManagePriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | PATCH | `/price-lists/:id/lines/:lineId` | M | global | `canManagePriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | DELETE | `/price-lists/:id/lines/:lineId` | M | global | `canManagePriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | POST | `/price-lists/:id/actions/activate` | M | global | `canManagePriceLists` | 401 unauthenticated; 403 role/scope |
| Price lists | POST | `/price-lists/:id/actions/retire` | M | global | `canManagePriceLists` | 401 unauthenticated; 403 role/scope |
| Purchase orders | GET | `/purchase-orders/` | PO-V | distributor: own purchase orders | `canViewPOs` | 401 unauthenticated; 403 role/scope |
| Purchase orders | POST | `/purchase-orders/` | PO-M | distributor ownership and active status | `canManagePOs` | 401 unauthenticated; 403 role/scope |
| Purchase orders | GET | `/purchase-orders/:id` | PO-V | distributor: own purchase orders | `canViewPOs` | 401 unauthenticated; 403 role/scope |
| Purchase orders | PATCH | `/purchase-orders/:id` | PO-M | distributor ownership and active status | `canManagePOs` | 401 unauthenticated; 403 role/scope |
| Purchase orders | POST | `/purchase-orders/:id/actions/submit` | PO-M | distributor ownership and active status | `canManagePOs` | 401 unauthenticated; 403 role/scope |
| Purchase orders | POST | `/purchase-orders/:id/actions/cancel` | PO-M | distributor ownership and active status | `canManagePOs` | 401 unauthenticated; 403 role/scope |
| Purchase orders | GET | `/purchase-orders/:id/job-order-balance` | PO-V | distributor: own purchase orders | `canViewPOs` | 401 unauthenticated; 403 role/scope |
| Purchase orders | GET | `/purchase-orders/:id/fulfilment-summary` | PO-V | distributor: own purchase orders | `canViewPOs` | 401 unauthenticated; 403 role/scope |
| Job orders | GET | `/job-orders/` | JO-V | factory mapping; QA global visibility | `canViewJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | PATCH | `/job-orders/:id/disclaimer` | JO-M | PO/factory/process-flow/draft eligibility | `canCreateJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | POST | `/job-orders/` | JO-M | PO/factory/process-flow/draft eligibility | `canCreateJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | GET | `/job-orders/assigned-tasks` | FACTORY-TASK | exactly one mapped factory | `requireRoles('FACTORY_USER')` | 401 unauthenticated; 403 role/scope |
| Job orders | GET | `/job-orders/:id` | JO-V | factory mapping; QA global visibility | `canViewJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | POST | `/job-orders/:id/actions/send-to-factory` | JO-M | PO/factory/process-flow/draft eligibility | `canCreateJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | POST | `/job-orders/:id/actions/confirm` | JO-W | mapped active factory; status/version | `canWorkflowJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | POST | `/job-orders/:id/actions/complete-stage` | JO-W | mapped active factory; status/version | `canWorkflowJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | POST | `/job-orders/:id/actions/update-prepared-quantity` | JO-W | mapped active factory; status/version | `canWorkflowJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | GET | `/job-orders/:id/stages` | JO-V | factory mapping; QA global visibility | `canViewJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | GET | `/job-orders/:id/audit` | JO-V | factory mapping; QA global visibility | `canViewJobOrders` | 401 unauthenticated; 403 role/scope |
| Job orders | GET | `/job-orders/:id/variance` | JO-V | factory mapping; QA global visibility | `canViewJobOrders` | 401 unauthenticated; 403 role/scope |
| QA | GET | `/qa/queue` | QA-V | QA global visibility | `canView` | 401 unauthenticated; 403 role/scope |
| QA | GET | `/qa/job-orders/:id` | QA-V | QA global visibility | `canView` | 401 unauthenticated; 403 role/scope |
| QA | POST | `/qa/job-orders/:id/inspections` | QA-O | QA eligibility and version | `canInspect` | 401 unauthenticated; 403 role/scope |
| QA | PUT | `/qa/inspections/:id` | QA-O | QA eligibility and version | `canInspect` | 401 unauthenticated; 403 role/scope |
| QA | POST | `/qa/inspections/:id/finalize` | QA-O | QA eligibility and version | `canInspect` | 401 unauthenticated; 403 role/scope |
| QA | POST | `/qa/job-orders/:id/approve` | QA-O | QA eligibility and version | `canInspect` | 401 unauthenticated; 403 role/scope |
| QA | POST | `/qa/inspections/:id/reopen` | M | inspection status/version | `requireRoles('ADMIN', 'MERCHANDISER')` | 401 unauthenticated; 403 role/scope |
| QA | GET | `/qa/rework` | QA-R | mapped factory; rework status/version | `canRework` | 401 unauthenticated; 403 role/scope |
| QA | POST | `/qa/rework/:id/acknowledge` | QA-R | mapped factory; rework status/version | `canRework` | 401 unauthenticated; 403 role/scope |
| QA | POST | `/qa/rework/:id/ready` | QA-R | mapped factory; rework status/version | `canRework` | 401 unauthenticated; 403 role/scope |
| QA | POST | `/qa/inspections/:id/evidence` | QA-O | QA eligibility and version | `canInspect` | 401 unauthenticated; 403 role/scope |
| QA | GET | `/qa/evidence/:id/content` | QA-E | evidence parent/factory scope | `requireRoles('ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT', 'QA_USER', 'FACTORY_USER')` | 401 unauthenticated; 403 role/scope |
