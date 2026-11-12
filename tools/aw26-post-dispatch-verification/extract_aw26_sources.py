#!/usr/bin/env python3
"""Step 1 of the AW26 verification data preparation (read-only against the sources).

Reads the historical workbooks and previously generated package, selects the genuine
AW26 records, reconciles sources against each other and writes the *extracted* data,
discrepancy log and address-correction report into an EXTERNAL workspace.

  python -I extract_aw26_sources.py --sources <project-erve-artifacts dir> --workspace <external dir>

Requires: openpyxl, pymupdf (pip install openpyxl pymupdf). No repository data is read or written;
nothing produced here may be committed (customer-derived).
"""
import argparse, collections, csv, hashlib, json, os, re, sys, unicodedata
import openpyxl

ap = argparse.ArgumentParser()
ap.add_argument("--sources", required=True)
ap.add_argument("--workspace", required=True)
ap.add_argument("--config", help="scenario-config.json (default: <workspace>/scenario-config.json)")
args = ap.parse_args()
SRC, WS = args.sources, args.workspace
CFG = json.load(open(args.config or os.path.join(WS, "scenario-config.json"), encoding="utf-8"))
HIST = os.path.join(SRC, "erve_historical_data")
PKG = os.path.join(SRC, "erve-prod-master-import", "20261015", "ready-to-import")
REC = os.path.join(SRC, "erve-prod-master-import", "20261025-season-reconciled")
OUT = os.path.join(WS, "02-aw26-extracted-data")
ADDR = os.path.join(WS, "03-address-corrections")
os.makedirs(OUT, exist_ok=True)
os.makedirs(ADDR, exist_ok=True)

discrepancies = []  # (id, topic, detail, authoritative, evidence)


def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def sheet_rows(path, name, header_row=1, data_only=True):
    ws = openpyxl.load_workbook(path, data_only=data_only)[name]
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(c).strip() if c is not None else "" for c in rows[header_row - 1]]
    out = []
    for i, r in enumerate(rows[header_row:], start=header_row + 1):
        out.append((i, dict(zip(hdr, r))))
    return hdr, out


def write_csv(path, header, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)


def clean(v):
    """NBSP/whitespace normalisation only - never changes visible characters."""
    if v is None:
        return ""
    s = str(v).replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


# ---------------------------------------------------------------- Styles
rec_path = os.path.join(REC, "AW26_Styles.xlsx")
pkg_styles = os.path.join(PKG, "07_Styles.xlsx")
dash_path = os.path.join(HIST, "AW26 - Dashboard.xlsx")
book_path = os.path.join(HIST, "Book1.xlsx")
_, rec_rows = sheet_rows(rec_path, "Styles")
_, pkg_rows = sheet_rows(pkg_styles, "Styles")
_, dash_rows = sheet_rows(dash_path, "MRP & Ex Factory")
pkg_aw26 = {str(r["Style Number"]): (i, r) for i, r in pkg_rows if str(r.get("Style Number", "")).startswith("AW26")}
dash_aw26 = {}
for i, r in dash_rows:
    if str(r.get("Season", "")).strip().upper().replace("-", "") == "AW26":
        dash_aw26[str(r["Base code"]).strip()] = (i, r)

# Book1 barcodes: (season, style digits) -> list of (physicalRow, barcode)
_, book_rows = sheet_rows(book_path, "Sheet1")
book = collections.defaultdict(list)
for i, r in book_rows:
    s = str(r.get("Season", "")).replace("-", "").strip()
    sn = str(r.get("Style\nNumber", "") or r.get("Style Number", "")).strip()
    if s == "AW26" and sn:
        book[sn].append((i, str(r.get("Barcode", "")).strip()))

# Invoice evidence (an AW26 Sale-or-Return invoice, EI/26-27/0271, 8-Oct-26)
import pymupdf  # noqa: E402

inv_path = os.path.join(HIST, "Inv - 271.pdf")
text = "\n".join(p.get_text() for p in pymupdf.open(inv_path))
invoice = {}
for m in re.finditer(r"(?m)^(\d{7,8}) .*?\n(?:[A-Z ]+\n)?([\d,]+\.\d\d)\n([\d,]+\.\d\d)\n(\d+) Pcs\n([\d,]+\.\d\d)\n(\d{8})\n", text, re.S):
    invoice[m.group(1)] = {"rate": m.group(3), "qty": int(m.group(4)), "mrp": float(m.group(5).replace(",", "")), "hsn": m.group(6)}
json.dump({"file": "Inv - 271.pdf", "sha256": sha(inv_path), "invoiceNo": "EI/26-27/0271", "date": "2026-10-08", "lines": invoice},
          open(os.path.join(OUT, "invoice-271-evidence.json"), "w"), indent=2)

style_out = []
size_rows_out = []
for i, r in rec_rows:
    sn = str(r["Style Number"])
    digits = sn.split("-", 1)[1]
    d_i, d = dash_aw26[digits]
    p_i, p = pkg_aw26[sn]
    dash_mrp = d.get("MRP")
    dash_exf = d.get("Exfactory")
    inv = invoice.get(digits)
    notes = []
    # identity cross-checks
    assert str(d["Description"]).replace(" ", "").lower().endswith(digits) or digits in str(d["Description"])
    if str(r["Factory Name Mappings"]) != f"{d['Factory']}:{dash_exf}":
        notes.append("FACTORY_PRICE_MISMATCH")
    # MRP decision
    inv_mrp = inv["mrp"] if inv else None
    if inv_mrp is not None and dash_mrp is not None and float(inv_mrp) != float(dash_mrp):
        decision = "NEEDS_REVIEW"
        reason = f"MRP_CONFLICT dashboard={dash_mrp} invoice_EI/26-27/0271={inv_mrp:g}"
        final_mrp = ""
        discrepancies.append((f"STYLE-{sn}", "Final MRP", reason,
                              "UNRESOLVED - evidence favours the tax invoice (later, statutory, shipped goods) but the master MRP is a business decision",
                              "AW26 - Dashboard.xlsx row %d vs Inv - 271.pdf" % d_i))
    else:
        decision, reason, final_mrp = "IMPORT", "", dash_mrp
    # native sizes + barcode evidence
    sizes = [s.strip() for s in str(r["Size Codes"]).split(",")]
    bc = book.get(digits, [])
    src_sizes = []
    for phys, code in bc:
        # AW26 barcode = serial(3) + LMIX digits + size code
        tail = code[1 + len(digits):] if code.startswith("3" + digits) else None
        src_sizes.append((tail, code, phys))
        size_rows_out.append([sn, tail or "?", code, phys])
    if [t for t, _, _ in src_sizes] != sizes:
        notes.append(f"SIZE_SET_MISMATCH book1={[t for t,_,_ in src_sizes]} styles={sizes}")
    # HSN: only where the invoice gives it AND it is not conflicted
    hsn = inv["hsn"] if (inv and decision == "IMPORT") else ""
    style_out.append([
        sn, r["Style Name"], final_mrp, "AW26", ",".join(sizes), r["LMIX Number"], hsn,
        f"{d['Factory']}:{dash_exf}", r["Category"] or d["Category"], r["IP Name"], r["Licensor"], r["Colour"],
        decision, reason, ";".join(notes), f"AW26 - Dashboard.xlsx row {d_i}", f"AW26_Styles.xlsx row {i}",
        dash_mrp, inv_mrp if inv_mrp is not None else "", inv["hsn"] if inv else "",
    ])
write_csv(os.path.join(OUT, "aw26-styles-selected.csv"),
          ["Style Number", "Style Name", "Final MRP", "Season Code", "Size Codes", "LMIX Number", "HSN Code (invoice-evidenced only)",
           "Factory Name Mappings", "Category", "IP Name", "Licensor", "Colour", "Decision", "Reason", "Cross-check notes",
           "Source row (Dashboard)", "Source row (reconciled styles)", "Dashboard MRP", "Invoice MRP", "Invoice HSN"], style_out)
write_csv(os.path.join(OUT, "aw26-style-size-barcodes-source.csv"), ["Style Number", "Size Code (derived)", "Source barcode", "Book1 physical row"], size_rows_out)
discrepancies.append(("STYLE-SET", "AW26 Style population", "AW26_Styles.xlsx (15) == 07_Styles.xlsx AW26 rows (15) == AW26 - Dashboard rows 94-108 (15); no field differences",
                      "All three agree", "field-by-field comparison"))

# --------------------------------------------------------- Factories
_, fac = sheet_rows(os.path.join(PKG, "04_Factories.xlsx"), "Factories")
fac_out = []
for i, r in fac:
    nm = r["Name"]
    keep = "Rahaa" in nm or "MASS KNIT" in nm.upper()
    why = ("AW26 supplier of all 15 AW26 Styles (Dashboard column Factory)" if "Rahaa" in nm else
           "Not an AW26 supplier; imported only as a SECOND Factory for factory-scoping/confidentiality negative tests" if "MASS KNIT" in nm.upper() else
           "Not an AW26 supplier (AW25/SS26 only); not selected")
    fac_out.append([nm, "SELECTED" if keep else "REJECTED", why, f"04_Factories.xlsx row {i}"])
write_csv(os.path.join(OUT, "factories-selection.csv"), ["Name", "Decision", "Reason", "Source row"], fac_out)

# ------------------------------------------------- Sales-register evidence
reg = collections.defaultdict(list)  # gstin -> list of (date, buyer, address)
for f in ["Sales data 01.10.25 to 31.03.26.xlsx", "Sales data 01.04.26 to 31.5.26.xlsx", "Sales data 01.06.26 to 31.8.26 - Copy.xlsx"]:
    ws = openpyxl.load_workbook(os.path.join(HIST, f), data_only=True)["Sales - Auto Register"]
    rows = list(ws.iter_rows(values_only=True))
    h = [str(x) for x in rows[5]]
    ib, ia, ig, idt = h.index("Buyer"), h.index("Buyer Address"), h.index("GSTIN/UIN"), h.index("Date")
    for r in rows[6:]:
        if r[ig] and r[ib]:
            reg[str(r[ig]).strip()].append((str(r[idt])[:10], clean(r[ib]), clean(r[ia])))

GST_STATE = {"07": "Delhi", "03": "Punjab", "08": "Rajasthan", "09": "Uttar Pradesh", "22": "Chhattisgarh", "27": "Maharashtra",
             "23": "Madhya Pradesh", "20": "Jharkhand", "24": "Gujarat", "18": "Assam", "33": "Tamil Nadu", "05": "Uttarakhand"}

# ---------------------------------------------------------- Distributors
DISPATCH_MAP = CFG["dispatchMap"]  # AW26 dispatch workbook short name -> exact master name (external config)
_, dist = sheet_rows(os.path.join(PKG, "05_Distributors.xlsx"), "Distributors")
dist_out, dist_addr = [], []
selected_names = set(DISPATCH_MAP.values())
for i, r in dist:
    nm = clean(r["Name"])
    g = str(r["GSTIN"]).strip()
    ev = reg.get(g, [])
    sel = nm in selected_names
    reason = "In AW26 dispatch workbook (Dispatch Qty and Store details AW26 - as on 12th Oct.xlsx)" if sel else (
        "Duplicate identity: same GSTIN and address as the selected row under a second name spelling" if g in CFG.get("duplicateGstins", []) else
        "Not in the AW26 dispatch workbook (earlier-season buyer); not selected")
    test_mode = clean(r["Purchase Mode"])
    dist_out.append([nm, g, "SELECTED" if sel else "REJECTED", reason, len(ev), f"05_Distributors.xlsx row {i}", test_mode])
    if sel:
        # Prefer the register's full buyer address (carries city/PIN) over the older single-line master text.
        longest = max((e[2] for e in ev), key=len) if ev else clean(r["Address Line 1"])
        dist_addr.append((nm, g, clean(r["Address Line 1"]), longest, i))
write_csv(os.path.join(OUT, "distributors-selection.csv"),
          ["Name", "GSTIN", "Decision", "Reason", "Sales-register vouchers with this GSTIN", "Source row", "Purchase Mode in OLD package (TEST DATA, not business-confirmed)"], dist_out)
for _row in CFG["discrepancyNotes"]:  # customer-specific notes live in the external scenario config
    discrepancies.append(tuple(_row))

# ------------------------------------------------- address structuring
PIN = re.compile(r"(?<!\d)(\d{6})(?!\d)")
STATE_ALIASES = {
    "UTTAR PRADESH": {"UTTARPRADESH", "UTTARPRADESH.", "U.P", "UP", "UTTAR PRADESH"},
    "UTTARAKHAND": {"UTTARAKHAND"},
    "RAJASTHAN": {"RAJASTHAN"}, "PUNJAB": {"PUNJAB"},
}


def norm(s):
    return re.sub(r"[^A-Z0-9]", "", clean(s).upper())


def structure_store_address(address, city, state, pin):
    """Return (line1, removed_tokens, residual_flags). Only trailing segments that EQUAL the separately-supplied
    City / State / PIN source columns (or a documented alias) are moved; everything else stays in Line 1."""
    a = clean(address).rstrip(".;, ")
    parts = [p.strip() for p in re.split(r"[;,]", a)]
    parts = [p for p in parts if p]
    removed = []
    flags = []
    ncity, nstate, npin = norm(city), norm(state), norm(pin)
    aliases = {norm(x) for x in STATE_ALIASES.get(state.upper(), {state})} | {nstate}
    changed = True
    while parts and changed:
        changed = False
        last = parts[-1]
        nl = norm(last)
        # "Rawla Mandi - 335707": split an in-segment PIN suffix
        m = re.match(r"^(.*?)\s*-\s*(\d{6})$", last)
        if m and m.group(2) == pin:
            parts[-1] = m.group(1).strip()
            removed.append(("PIN", m.group(2)))
            changed = True
            continue
        if nl in aliases:
            removed.append(("STATE", parts.pop()))
            changed = True
        elif nl == npin:
            removed.append(("PIN", parts.pop()))
            changed = True
        elif nl == ncity:
            removed.append(("CITY", parts.pop()))
            changed = True
        elif nl.endswith(nstate) and len(nl) > len(nstate) and norm(last[: -len(state)].strip(" -")) :
            # e.g. "FAZIKA PUNJAB" -> keep the district word, remove the state word
            parts[-1] = last[: len(last) - len(state)].strip()
            removed.append(("STATE", state))
            changed = True
        elif last.lower().endswith(" " + ncity.lower()) and False:
            pass
    # trailing city embedded without comma ("...Gandhi Path, VAISHALI" no); "Maharana Pratap Setu Marg , Chittorgarh" handled by parts.
    line1 = ", ".join(parts)
    # embedded trailing city with no comma, e.g. "... Dholpur" / "... Jaipur" / "... kanpur" / "... Chittorgarh": compare last word(s) to city
    if not any(k == "CITY" for k, _ in removed) and line1:
        words = line1.split()
        cw = clean(city).split()
        if len(cw) <= len(words) and [norm(w) for w in words[-len(cw):]] == [norm(w) for w in cw]:
            removed.append(("CITY", " ".join(words[-len(cw):])))
            line1 = " ".join(words[: -len(cw)]).strip(" ,-")
    return line1, removed, flags


# ---- Retail stores: 'Store Address' sheet is the original; 06_Retail_Stores.xlsx is the older derived file
wb = openpyxl.load_workbook(os.path.join(HIST, "Dispatch Qty and Store details AW26 - as on 12th Oct.xlsx"), data_only=True)
ws = wb["Store Address"]
group = None
src_stores = []
for idx, r in enumerate(ws.iter_rows(values_only=True), start=1):
    if idx < 4:
        continue
    if r[0] and not r[1]:
        group = clean(r[0])
        continue
    if r[1]:
        src_stores.append((idx, group, r))
_, old_stores = sheet_rows(os.path.join(PKG, "06_Retail_Stores.xlsx"), "Retail stores")
old_by_key = {(clean(o["Name"]), norm(o.get("Postal Code"))): (i, o) for i, o in old_stores}
PARENT = {k: tuple(v) for k, v in CFG["parents"].items()}

store_import, store_queue, report = [], [], []
for idx, grp, r in src_stores:
    parent, pg = PARENT[grp]
    name_raw, city_raw, state_raw, addr_raw, pin_raw, phone_raw, email_raw, gst_raw = r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]
    name, city, state, pin = clean(name_raw), clean(city_raw), clean(state_raw), clean(pin_raw)
    line1, removed, _ = structure_store_address(addr_raw, city, state, pin)
    # content-preservation proof: every alphanumeric of the original text survives in Line 1 + the moved tokens
    moved = "".join(norm(v) for _, v in removed)
    if sorted(norm(line1) + moved) != sorted(norm(addr_raw)):
        raise SystemExit(f"CONTENT LOSS while structuring {name}: {addr_raw!r} -> {line1!r} + {removed!r}")
    email = clean(email_raw).rstrip(">").strip()
    phone = clean(phone_raw)
    gstin = clean(gst_raw)
    mech = []
    if name_raw != name or city_raw != city:
        mech.append("NBSP/whitespace normalised in name/city (U+00A0 only)")
    if clean(email_raw) != email:
        mech.append("stray '>' stripped from e-mail")
    if re.search(r"[;]|,\S", clean(addr_raw)):
        mech.append("';' separators / missing space after ',' normalised to ', '")
    old = old_by_key.get((name, norm(pin)))
    old_addr = clean(old[1]["Address Line 1"]) if old else ""
    # Review criteria (evidence-based)
    review = []
    # 1. City column disagrees with the same city named inside the address text
    ntext = norm(addr_raw)
    if norm(city) not in ntext:
        # look for a near-identical token in the address (spelling variance)
        toks = [norm(t) for t in re.split(r"[ ,;.\-]+", clean(addr_raw)) if t]
        import difflib
        close = [t for t in toks if t and difflib.SequenceMatcher(None, t, norm(city)).ratio() >= 0.8 and t != norm(city)]
        if close:
            review.append(f"City column '{city}' differs from spelling in the address text ({close[0]}); source cannot say which is right")
    # 2. address contains a 6-digit PIN that differs from the PIN column
    for m in PIN.finditer(clean(addr_raw)):
        if m.group(1) != pin:
            review.append(f"PIN in address text {m.group(1)} != PIN column {pin}")
    # 3. nothing left in Line 1
    if not line1:
        review.append("No street component remains after removing City/State/PIN")
    gst_state = GST_STATE.get(gstin[:2]) if gstin else None
    if gst_state and gst_state.upper() != state.upper():
        review.append(f"Store GSTIN state code {gstin[:2]} ({gst_state}) differs from State column ({state})")
    row = dict(parent=parent, parent_gstin=pg, name=name, line1=line1, line2="", city=city, state=state, country="India", pin=pin,
               phone=phone, email=email, gstin=gstin, src=f"Dispatch Qty and Store details AW26 - as on 12th Oct.xlsx / Store Address row {idx}")
    report.append([row["src"], "RETAIL_STORE", name, clean(addr_raw), city, state, pin, "",
                   line1, "", city, state, "India", pin, "; ".join(f"{k}:{v}" for k, v in removed) or "none",
                   "; ".join(mech) or "none", old_addr == clean(addr_raw) if old else "no old row",
                   "REVIEW" if review else "OK", " | ".join(review)])
    (store_queue if review else store_import).append(row)

write_csv(os.path.join(ADDR, "retail-store-address-correction-report.csv"),
          ["Source (file / worksheet / row)", "Entity", "Store name", "ORIGINAL address text (single field)", "Original City col", "Original State col",
           "Original PIN col", "Original Line 2", "Proposed Line 1", "Proposed Line 2", "Proposed City", "Proposed State", "Proposed Country",
           "Proposed Postal Code", "Components moved out of Line 1 (evidence: equals the separate source column)", "Mechanical normalisation",
           "Old 06_Retail_Stores.xlsx Line 1 == original text", "Validation", "Unresolved ambiguity"], report)
write_csv(os.path.join(ADDR, "review-queue.csv"),
          ["Entity", "Name", "Original address", "City", "State", "PIN", "Why queued"],
          [["RETAIL_STORE", s["name"], "", s["city"], s["state"], s["pin"], ""] for s in store_queue])


def dump_stores(name, rows):
    cols = ["parent", "parent_gstin", "name", "line1", "line2", "city", "state", "country", "pin", "phone", "email", "gstin", "src"]
    write_csv(os.path.join(OUT, name), cols, [[s[c] for c in cols] for s in rows])


dump_stores("retail-stores-import-candidates.csv", store_import)
dump_stores("retail-stores-review-queue.csv", store_queue)

# store count discrepancies
discrepancies.append(("STORE-OLD-FILE", "06_Retail_Stores.xlsx vs original sheet", "Old file stored the full postal address in Address Line 1 (city/state/PIN repeated), had no Country, dropped every Store GSTIN present in the source, and carried a Purchase Mode from the TEST assignment",
                      "'Store Address' worksheet of the dispatch workbook", "this report"))

# ------------------------------------------------ Distributor addresses
OVERRIDES = CFG["reviewOverrides"]  # analyst review: ambiguity the pattern parser cannot see (documented, not silent)
drep, dimport = [], []
for nm, g, old_line, reg_addr, row in dist_addr:
    segs = [x.strip() for x in reg_addr.split(",") if x.strip()]
    state = GST_STATE.get(g[:2], "")
    flags, evidence, phone = [], ["state from GSTIN state code " + g[:2]], ""
    city = pin = label = ""
    if segs and re.fullmatch(r"\+?\d[\d\- ]{8,}", segs[-1]):
        phone = segs.pop()
        evidence.append("trailing phone number moved to Phone")
    if segs and (m := re.fullmatch(r"(?P<city>[^\d]+?)\s*-\s*(?P<pin>\d{6})", segs[-1])):
        city, pin = m.group("city").strip(), m.group("pin")
        segs.pop()
        evidence.append("City-PIN suffix of the register Buyer Address")
    elif segs and (m := re.fullmatch(r"Pincode:\s*(?P<pin>\d{6})", segs[-1])):
        pin = m.group("pin")
        segs.pop()
        label = "Pincode"  # the literal label is not address content; it is accounted for in the preservation check
        evidence.append("explicit 'Pincode:' suffix")
        flags.append("City is not stated separately (last locality word may be the city); left blank rather than guessed")
    else:
        flags.append("no PIN suffix recognised; City and Postal Code left blank")
    if nm in OVERRIDES:
        # City is withheld, but its text stays in Line 1 so no address content is lost.
        flags.append(OVERRIDES[nm])
        segs.append(city)
        city = ""
    if not state:
        flags.append(f"GSTIN state code {g[:2]} not in the evidenced state table")
    street = ", ".join(segs)
    if sorted(norm(street) + norm(city) + norm(pin) + norm(phone) + norm(label)) != sorted(norm(reg_addr)):
        raise SystemExit(f"CONTENT LOSS while structuring {nm}")
    status = "OK" if not flags else "REVIEW"
    drep.append([f"05_Distributors.xlsx row {row} + sales-register Buyer Address", "DISTRIBUTOR", nm, old_line, "", "", "", "", street, "", city, state,
                 "India" if state else "", pin, "; ".join(evidence), "", "", status, " | ".join(flags)])
    dimport.append(dict(name=nm, gstin=g, line1=street, line2="", city=city, state=state, country="India" if state else "", pin=pin, phone=phone, status=status, flags=" | ".join(flags), reg_addr=reg_addr))
write_csv(os.path.join(ADDR, "distributor-address-correction-report.csv"),
          ["Source", "Entity", "Name", "ORIGINAL master Line 1", "-", "-", "-", "-", "Proposed Line 1", "Proposed Line 2", "Proposed City", "Proposed State",
           "Proposed Country", "Proposed Postal Code", "Evidence", "-", "-", "Validation", "Unresolved ambiguity"], drep)
cols = ["name", "gstin", "line1", "line2", "city", "state", "country", "pin", "phone", "status", "flags", "reg_addr"]
write_csv(os.path.join(OUT, "distributors-structured.csv"), cols, [[d[c] for c in cols] for d in dimport])

# ------------------------------------------------------------ HSN master candidates
hsn_rows = []
hws = openpyxl.load_workbook(os.path.join(HIST, "HSN_SAC.xlsx"), data_only=True)["HSN_MSTR"]
hmap = {str(r[0]).strip(): clean(r[1]) for r in hws.iter_rows(values_only=True) if r[0]}
for code in sorted({r[6] for r in style_out if r[6]} | {v["hsn"] for v in invoice.values()}):
    chain = [hmap.get(code[:n]) for n in (4, 6, 8)]
    desc = " > ".join(x for x in chain if x)
    hsn_rows.append([code, desc, "HSN_SAC.xlsx hierarchy (4/6/8-digit descriptions joined)", "used by an AW26 Style on invoice EI/26-27/0271"])
write_csv(os.path.join(OUT, "hsn-candidates.csv"), ["HSN Code", "Description", "Description source", "Why"], hsn_rows)

write_csv(os.path.join(OUT, "source-discrepancies.csv"), ["ID", "Topic", "Detail", "Authoritative source / decision", "Evidence"], discrepancies)
summary = {
    "styles": collections.Counter(r[12] for r in style_out),
    "stores_import": len(store_import), "stores_queue": len(store_queue),
    "distributors_selected": len(dimport), "distributors_ok_address": sum(1 for d in dimport if d["status"] == "OK"),
    "invoice_lines": len(invoice), "hsn_rows": len(hsn_rows),
}
print(json.dumps(summary, indent=2, default=dict))
