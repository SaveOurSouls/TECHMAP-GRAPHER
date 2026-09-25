"""Offline integrity verification; no third-party Python dependencies."""
from pathlib import Path
import hashlib
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent

def main():
    entries = json.loads((ROOT / 'catalog.json').read_text(encoding='utf-8'))
    sources = json.loads((ROOT / 'hatch_sources.json').read_text(encoding='utf-8'))
    inventory = (ROOT / 'inventory_127.txt').read_text(encoding='utf-8').splitlines()
    assert len(entries) == len(sources) == 48
    assert len(inventory) == len(set(inventory)) == 127
    assert len({entry['code'] for entry in entries}) == 48
    by_name = {source['name'].upper(): source for source in sources}
    for entry in entries:
        source = by_name[entry['name']]
        raw = source['text'].encode('utf-8')
        blob = b'blob ' + str(len(raw)).encode('ascii') + b'\0' + raw
        assert hashlib.sha1(blob).hexdigest() == source['sha'] == entry['source_sha']
        assert entry['source'] == source['url']
        ET.parse(ROOT / 'samples' / f"{entry['code']}_{source['name']}.svg")
    for svg in ROOT.glob('*.svg'):
        ET.parse(svg)
    html = (ROOT / 'catalog.html').read_text(encoding='utf-8')
    assert html.count('<article class="card"') == 48
    local_links = re.findall(r'href="(samples/[^"]+)"', html)
    assert len(local_links) == 48
    assert all((ROOT / link).is_file() for link in local_links)
    print('PASS: 48 entries, 48 source hashes, SVG parsing, local links and 127-name inventory.')

if __name__ == '__main__':
    main()
