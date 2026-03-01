import os
import json
from dotenv import load_dotenv
import httpx

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
key = os.environ.get('GOOGLE_GEMINI_API_KEY')
if not key:
    print('ERROR: GOOGLE_GEMINI_API_KEY not found in environment or .env')
    raise SystemExit(1)

url = 'https://generativelanguage.googleapis.com/v1beta/models'
params = {'key': key}

print('Calling ListModels...')
with httpx.Client(timeout=30) as client:
    resp = client.get(url, params=params)
    print('HTTP', resp.status_code)
    try:
        data = resp.json()
    except Exception:
        print('Non-JSON response:')
        print(resp.text)
        raise

if resp.status_code != 200:
    print('Error response:')
    print(json.dumps(data, indent=2))
else:
    models = data.get('models') or []
    if not models:
        print('No models returned. Full response:')
        print(json.dumps(data, indent=2))
    else:
        print(f'Found {len(models)} models:')
        for m in models:
            name = m.get('name')
            desc = m.get('description') or ''
            supported = m.get('supported_methods') or m.get('support') or []
            print('-', name, '|', desc)
            if supported:
                print('   supported_methods:', supported)
