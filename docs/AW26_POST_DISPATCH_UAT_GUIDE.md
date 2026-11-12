# AW26 Post-Dispatch UAT Guide

For business testers. It walks through one AW26 order from Order Sheet to Distributor sales and returns, and says what you should see at each step.

Screenshots are referred to by number (`Screenshot 33`). They contain customer data, so they are kept outside Git in the illustrated PDF supplied with the test environment.

## 1. Before you start

- Use only the **test environment** prepared by the technical team. Never use production.
- Sign in with the account for the role you are testing (section 2). Passwords are given to you separately.
- Dates are **India time (IST)**. If you report a sale, use today's IST date.
- Anything named **TEST ONLY** is made-up for testing (Purchase Mode, prices, the Store B1, the seller, the carrier). Do not treat it as real business data.

## 2. Accounts

| Role                    | You can                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| Merchandiser            | Order Sheets, Job Orders, Dispatch Orders, Erve Packing Lists, Dispatches, transporter, reviews |
| Factory (Rahaa)         | Pack cartons, finish the Factory Packing List, print labels                                     |
| QA                      | Audit cartons                                                                                   |
| Transporter             | Enter vehicle and LR on assigned dispatches                                                     |
| Distributor (V, G or B) | Receive stock, see own Store Inventory, report sales and returns                                |
| Accountant              | Tax Invoice drafts, Finance review                                                              |
| Senior Management       | View only                                                                                       |

## 3. The AW26 test data

Distributors and Stores appear as labels (Distributor V, Store V1). The key to the real names is on the last page of the illustrated PDF only.

| Item                        | Value                                                                  |
| --------------------------- | ---------------------------------------------------------------------- |
| Style A                     | AW26-5826005 Boys Hoody, sizes 3 to 8                                  |
| Style B                     | AW26-5526026 Boys Sweat Shirt, sizes 9 to 14                           |
| Factory                     | Rahaa (a second Factory, Mass Knit, is used for "cannot see" checks)   |
| Sale-or-Return Distributors | Distributor V (Store V1, Store V2), Distributor G (Store G1, Store G2) |
| Outright Distributor        | Distributor B (TEST ONLY Store B1)                                     |

Four AW26 Styles are not loaded because the Dashboard and the invoice show different MRPs. They need a business decision (section 8).

Screenshots 01 to 06 show the loaded Season, Styles, Distributors and Stores.

## 4. Quantities to expect

Each Dispatch Order splits a Style equally across its sizes.

| Dispatch | Distributor, Store              | Shipped                 | Distributor receipt                                    |
| -------- | ------------------------------- | ----------------------- | ------------------------------------------------------ |
| 1        | Distributor V, Store V1         | Style A 12 + Style B 12 | A full; B size 9 gets **1 of 2** (short 1)             |
| 2        | Distributor V, Store V2         | Style A 12              | 12 (full)                                              |
| 3        | Distributor B (Outright)        | Style A 12              | 12 (full)                                              |
| 4        | Distributor G, Store G1         | Style B 18              | Merchandiser confirms 18, then Distributor G enters 17 |
| 5        | Distributor G, Store G2         | Style B 12              | Not entered (QR only)                                  |
| 6        | Distributor V, Store V1 (later) | Style A 6               | 6 (full)                                               |

The system keeps two different received figures. Do not add them together.

- **Distributor-attested received**: what the Distributor entered on **Distributor Receipt**.
- **Received ledger in use**: the quantity Sales and Returns work from. It is normally the receipt, but an earlier confirmation by the Merchandiser is kept and a different receipt is only recorded beside it as a discrepancy.

| Quantity                           | Style A | Style B |
| ---------------------------------- | ------: | ------: |
| Produced and shipped               |      42 |      42 |
| Distributor-attested received      |      42 |  **28** |
| Received ledger in use             |      42 |  **29** |
| Shipped, awaiting receipt evidence |       0 |      12 |

Style B by dispatch:

| Dispatch     | Distributor-attested | Ledger in use                     | Why                                                            |
| ------------ | -------------------: | --------------------------------- | -------------------------------------------------------------- |
| 1 (Store V1) |                   11 | 11                                | Size 9 received 1 of 2                                         |
| 4 (Store G1) |                   17 | 18                                | Merchandiser confirmed 18 first; Distributor G then entered 17 |
| 5 (Store G2) |         Not recorded | No ledger (counts as 0 in the 29) | No receipt entered                                             |
| **Total**    |               **28** | **29**                            |                                                                |

- 42 shipped = 28 attested + 2 short (one at Dispatch 1, one at Dispatch 4) + 12 awaiting (Dispatch 5).
- The 1-piece difference between 29 and 28 is the Dispatch 4 discrepancy. The system keeps the earlier ledger of 18 and shows the difference; it does not change the quantity.
- **Not recorded** (nothing entered) is not the same as a receipt of **0** (the Distributor says nothing arrived). Screens show Not recorded for Dispatch 5. This run has no zero receipt.

## 5. Walk-through

### 5.1 Order Sheet and Job Order (Merchandiser)

1. Open **Order Sheets**. Each Distributor has its own sheet for the Style.
2. Open the **Job Order**. It combines the Order Sheets for that Style at Rahaa.
3. Production and QA run to **Production complete**.

Expect: Style A and Style B each show 42 pieces released by Final QA.

Screenshots 10, 11.

### 5.2 Dispatch Order (Merchandiser)

Open the Dispatch Order. One order can hold several Distributors and Stores.

Expect: sizes split equally; each Store shows its full address with PIN.

Screenshot 12. PDF: Dispatch Order.

### 5.3 Packing and audit (Factory, QA)

1. Factory packs one carton per Store and prints the **carton label**.
2. QA audits each carton.
3. Factory finishes the **Factory Packing List**.

Expect: the Factory and QA screens do **not** show the Distributor name or Purchase Mode. The label shows the Store and address and a QR code, not the Distributor.

Screenshots 20, 21. PDFs: Carton Label, Factory Packing List.

### 5.4 Erve Packing List and Dispatch (Merchandiser)

1. Make one Erve Packing List per Store. Cartons for two different Stores are refused.
2. Finalize it and record the Dispatch.

Expect: Store V1 shows two Dispatch Orders and two Styles in one dispatch.

Screenshots 30, 31, 35. PDFs: Erve Packing List, Erve Dispatch.

### 5.5 Transporter and LR

1. Merchandiser picks the Transporter on **Transport & Delivery**.
2. Transporter signs in, sees only assigned dispatches, and enters vehicle and LR.

Expect: the Transporter cannot open the full dispatch.

Screenshots 32, 60.

### 5.6 QR delivery

Scan a carton QR (no sign-in) and confirm receipt of that carton. A second, different confirmation for the same carton is refused.

Expect: the scan page shows only the carton number and status. Dispatches 1, 2 and 5 show scanned cartons; 3 and 4 show **QR incomplete**.

Screenshot 32.

### 5.7 Distributor receipt

1. Distributor opens **Distributor Receipt** and enters what actually arrived.
2. A shortage needs a remark. More than shipped is refused.
3. After submitting, the receipt is final.

Expect:

- Dispatch 1: Style B size 9 shows 1 received of 2, with the remark. Total 11 for Style B.
- Dispatch 4 (as Distributor G): the receipt shows 17 and is final. The earlier confirmation of 18 is not overwritten.
- Dispatch 5: no receipt yet, so the entry form is still open. This is not a zero receipt.
- Another Distributor cannot submit for Dispatch 1.

Screenshots 33, 55, 56.

### 5.8 Reconciliation (Merchandiser, Accountant)

Open **Post-Dispatch Reconciliation**.

Expect:

- Dispatch 1: Distributor received 11, shortage 1, ledger in use 11.
- Dispatch 4: Distributor received 17, ledger in use 18 (confirmed earlier by the Merchandiser), difference of 1 on size 9, follow-up required. The ledger is not changed.
- Dispatch 5: awaiting receipt. Received and ledger show **Not recorded**, not 0. The 12 pieces count as awaiting.
- Merchandiser can record **Operational follow-up**; Accountant can record **Finance review**. Neither changes any quantity.

Screenshots 34, 40, 41.

### 5.9 Retail Store Inventory

Distributor opens **Retail Store Inventory**; Admin opens the same page.

Expect:

- A Distributor sees only its own Stores.
- Store V1, Style B: shipped 12, Distributor received 11, shortage 1, ledger in use 11.
- Store G1, Style B: shipped 18, Distributor received 17, shortage 1, ledger in use 18, one source flagged as a discrepancy.
- Store G2, Style B: shipped 12, **awaiting confirmation 12**, received and ledger **Not recorded**. Nothing is available to sell yet.
- Style B totals across Distributor G and Distributor V: attested 28, ledger 29. Style A: 42 and 42.
- Distributor B (Outright) shows shipment and receipt only, with no sale position.

Screenshots 50, 51, 57. If a Style image is blank, scroll it into view.

### 5.10 Report sold and Request return (Distributor)

Use Distributor V, Store V1, Style A, size 3 (3 pieces available).

1. **Sold**, quantity 2, today's date. Expect: allocated to the **older** dispatch first.
2. Try **Sold** 2 again. Expect: refused, only 1 left.
3. **Sold** 1. Expect: taken from the later dispatch.
4. On Style B size 10 choose **Return**, quantity 1, with a reason. Expect: a Return request is created.

Expect: Admin has no Sold or Return buttons. A future date is refused.

Screenshots 52, 53, 54.

### 5.11 Invoices (Accountant)

Open **Tax Invoices**. Drafts exist for Dispatch 1 (Sale-or-Return) and Dispatch 3 (Outright).

Expect: both are unnumbered drafts. **Finalize** is refused because the Style has no HSN.

Screenshots 70, 71, 72.

## 6. Permission checks

| Sign in as               | Try                                      | Expect              |
| ------------------------ | ---------------------------------------- | ------------------- |
| Distributor V            | Open a Distributor G dispatch            | Refused             |
| Distributor V            | Open Style images not received           | Refused             |
| Distributor G            | Sell from a Distributor V Store          | Refused             |
| Mass Knit Factory        | Open a Rahaa packing list                | Refused; list empty |
| Factory, QA              | Look for Distributor names               | None shown          |
| Distributor              | Look for the Factory name                | None shown          |
| Factory, QA, Transporter | Retail Store Inventory or Reconciliation | No access           |
| Senior Management        | Add a review                             | Refused (view only) |
| Not signed in            | Any screen                               | Sign-in page        |

## 7. Documents

Download from the screens above and check:

- **Carton Label**: Store, address with PIN, QR, contents by size.
- **Dispatch Order, Erve Packing List, Erve Dispatch**: addresses with PIN; sizes in columns.
- **Factory Packing List**: no Distributor.

Known issues D1 and D2 (section 8) are still open: the Factory Packing List leaves out the PIN, and long address words may split across lines. The Tax Invoice draft PDF was not verified.

## 8. Known limits and decisions needed

Open items. None of these was fixed or hidden by this run.

| Item                                                                                 | Status / what is needed                                                            |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Four Styles not loaded (MRP differs between Dashboard and invoice)                   | Business confirms the MRP                                                          |
| Two Retail Stores not loaded                                                         | City spelling needs checking before import                                         |
| Retail Stores for ten Distributors                                                   | Not in the supplied sources; only Distributor V and Distributor G have Store lists |
| Purchase Mode and prices used in the scenarios                                       | **TEST ONLY**; real values needed                                                  |
| **D3** Tax Invoice cannot be finalized: AW26 Styles have no HSN                      | Master-data dependency (HSN codes and GST rules), not a confirmed code defect      |
| Tax Invoice draft PDF                                                                | **Not verified**                                                                   |
| **D1** Factory Packing List PDF leaves out the Store postal code                     | Open, not fixed                                                                    |
| **D2** Carton Label and Erve Dispatch PDFs split some address words mid-word         | Open, not fixed                                                                    |
| **D4** Existing AW26 barcodes use the older format; the system generates the new one | Business decision                                                                  |

## 9. Reporting a problem

Give: your role, the screen, what you did, what you expected, what happened, and a screenshot.
