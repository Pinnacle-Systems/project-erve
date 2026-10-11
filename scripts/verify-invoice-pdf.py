"""Inspect synthetic native downloads; never calculate invoice pricing/tax/rounding."""
import hashlib
import json
import re
import sys
from pathlib import Path

import pymupdf

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.artifacts/native-browser-evidence')
proof = {}


def money(value):
    whole, _, fraction = str(value).partition('.')
    negative = whole.startswith('-')
    whole = whole.lstrip('-')
    tail = whole[-3:]
    prefix = whole[:-3]
    groups = []
    while prefix:
        groups.insert(0, prefix[-2:])
        prefix = prefix[:-2]
    return ('-' if negative else '') + ','.join(groups + [tail]) + '.' + fraction.ljust(2, '0')


def photo_fingerprints(document):
    result = []
    for page in document:
        for image in page.get_images(full=True):
            xref, mask, width, height = image[:4]
            if (width, height) == (192, 320):
                result.append((hashlib.sha256(document.extract_image(xref)['image']).hexdigest(), mask > 0))
    return result


for name in ['rounded', 'rounded-admin', 'multi', 'legacy']:
    expected = json.loads((root / f'{name}-expected.json').read_text())
    document = pymupdf.open(root / f'{name}.pdf')
    text = '\n'.join(page.get_text() for page in document)
    flat = re.sub(r'\s+', ' ', text)
    compact = re.sub(r'\s+', '', text)
    assert expected['invoiceNumber'] in flat, (name, 'issued identity')
    for key in ['subtotal', 'totalCgst', 'totalSgst', 'totalIgst', 'totalGst', 'grandTotal']:
        assert money(expected[key]) in flat, (name, key, expected[key])
    assert money(expected['payableTotal'] or expected['grandTotal']) in flat
    assert flat.count('Amount chargeable (in words):') == 1
    assert 'Whether GST is payable under RCM: No' in flat
    assert 'Authorised Signatory' in flat and 'system-generated invoice' in flat
    assert 'EDITED-AFTER-ISSUE' not in flat
    snapshot = expected['documentSnapshot']
    if snapshot:
        for line in snapshot['lines']:
            assert re.sub(r'\s+', '', line['style']['styleNumber']) in compact, (name, line['style']['styleNumber'])
        for order in snapshot['dispatchOrders']:
            assert re.sub(r'\s+', '', order['number']) in compact, (name, order['number'])
        adjustment = money(expected['roundOffAdjustment'])
        assert ('-INR ' + adjustment[1:] if adjustment.startswith('-') else 'INR ' + adjustment) in flat
    else:
        assert 'Original issued total' in flat
        assert 'Round-off adjustment Unavailable' in flat
        assert 'Dispatch Orders: Unavailable' in flat
        assert 'Not recorded' in flat
    for key in ['bankName', 'bankAccountNumber', 'bankIfsc']:
        assert expected['seller'][key] in flat, (name, key)
    if expected['financialYear']:
        assert expected['financialYear']['code'] in flat
    bold_no = False
    render_dir = root / 'pdf-rendered'
    render_dir.mkdir(exist_ok=True)
    for index, page in enumerate(document):
        assert abs(page.rect.width - 595.28) < .1 and abs(page.rect.height - 841.89) < .1
        for word in page.get_text('words'):
            assert word[0] >= 0 and word[1] >= 0 and word[2] <= page.rect.width + .1 and word[3] <= page.rect.height + .1, (name, 'clipped text', word)
            if word[4].startswith('UAT-'):
                assert word[2] < 79, (name, 'Style identifier overlaps description column', word)
        for image in page.get_image_info():
            box = pymupdf.Rect(image['bbox'])
            assert abs(box.width / box.height - image['width'] / image['height']) < .03, (name, 'distorted image')
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                for span in line['spans']:
                    bold_no |= span['text'].strip() == 'No' and 'Bold' in span['font']
        page.get_pixmap(matrix=pymupdf.Matrix(1.5, 1.5)).save(render_dir / f'{name}-{index + 1}.png')
    assert bold_no, (name, 'RCM No must be bold')
    if name.startswith('rounded'):
        assert len(document) == 1
        assert '+INR 0.40' in flat and '44,050.00' in flat
        assert 'Forty Four Thousand Fifty Only.' in flat
        photos = photo_fingerprints(document)
        assert photos and all(alpha for _, alpha in photos), 'Archived PNG transparency lost'
        proof[name] = {'pages': len(document), 'photos': photos}
    else:
        if name == 'multi':
            assert len(document) > 1, 'Multi-page fixture must exercise pagination'
        proof[name] = {'pages': len(document)}

assert proof['rounded']['photos'] == proof['rounded-admin']['photos'], 'Archived image changed between authorized reads'
(root / 'pdf-proof.json').write_text(json.dumps(proof, indent=2))
print('Synthetic native PDFs: frozen totals, references, legacy honesty, A4 bounds, image aspect/alpha and authorized repeat reads passed')
