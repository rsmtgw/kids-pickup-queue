import requests

BASE = 'http://127.0.0.1:8000'

print('GET /api/dev/keys')
try:
    r = requests.get(BASE + '/api/dev/keys', timeout=5)
    print(r.status_code)
    print(r.json())
except Exception as e:
    print('GET failed', e)

print('\nPOST /api/dev/reseed')
try:
    r = requests.post(BASE + '/api/dev/reseed', timeout=10)
    print(r.status_code)
    try:
        print(r.json())
    except Exception:
        print(r.text)
except Exception as e:
    print('POST failed', e)
