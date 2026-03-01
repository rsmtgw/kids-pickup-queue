"""Concurrent confirmation test to verify race condition fix."""
import urllib.request, json
from concurrent.futures import ThreadPoolExecutor, as_completed

BASE = 'http://localhost:8000'

def api(method, path, body=None):
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(f'{BASE}{path}', data=data, method=method)
    if data:
        req.add_header('Content-Type', 'application/json')
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# Reset scans
urllib.request.urlopen(urllib.request.Request(f'{BASE}/api/scan', method='DELETE'))

# Get first 15 kids
kids = api('GET', '/api/kids')[:15]
print(f'Scanning {len(kids)} kids...')
for k in kids:
    api('POST', '/api/scan', {'kid_id': k['id'], 'name': k['name']})

# Start pickup (promotes first 5 to pickup)
result = api('POST', '/api/queue/start')
pickup_seqs = sorted([s['seq'] for s in result['pickup']])
print(f'After start: pickup seqs={pickup_seqs}')
assert pickup_seqs == [1, 2, 3, 4, 5], f'FAIL: expected [1,2,3,4,5] got {pickup_seqs}'
print('Batch 1 start: PASS')

# Concurrently confirm all 5 pickup kids
pickup_kids = [s['kid_id'] for s in result['pickup']]
print(f'Confirming batch 1 concurrently: kid_ids={pickup_kids}')

def confirm(kid_id):
    return api('POST', f'/api/scan/{kid_id}/pickup')

with ThreadPoolExecutor(max_workers=5) as ex:
    futures = [ex.submit(confirm, kid_id) for kid_id in pickup_kids]
    for f in as_completed(futures):
        r = f.result()
        print(f"  Confirmed seq={r['seq']} kid_id={r['kid_id']} -> {r['queue_status']}")

# Check batch 2
pickup2 = api('GET', '/api/queue/pickup')
seqs2 = sorted([s['seq'] for s in pickup2])
print(f'After batch 1 confirm: pickup seqs={seqs2}')
if seqs2 == [6, 7, 8, 9, 10]:
    print('Batch 2 promotion: PASS')
else:
    print(f'Batch 2 promotion: FAIL (expected [6,7,8,9,10])')

# Concurrently confirm batch 2
pickup2_kids = [s['kid_id'] for s in pickup2]
print(f'Confirming batch 2 concurrently: kid_ids={pickup2_kids}')
with ThreadPoolExecutor(max_workers=5) as ex:
    futures = [ex.submit(confirm, kid_id) for kid_id in pickup2_kids]
    for f in as_completed(futures):
        r = f.result()
        print(f"  Confirmed seq={r['seq']} kid_id={r['kid_id']} -> {r['queue_status']}")

# Check batch 3
pickup3 = api('GET', '/api/queue/pickup')
seqs3 = sorted([s['seq'] for s in pickup3])
print(f'After batch 2 confirm: pickup seqs={seqs3}')
if seqs3 == [11, 12, 13, 14, 15]:
    print('Batch 3 promotion: PASS')
else:
    print(f'Batch 3 promotion: FAIL (expected [11,12,13,14,15])')

# Final status
status = api('GET', '/api/queue/status')
print(f'Final status: {status}')
if seqs2 == [6, 7, 8, 9, 10] and seqs3 == [11, 12, 13, 14, 15]:
    print('ALL TESTS PASSED!')
else:
    print('SOME TESTS FAILED')
