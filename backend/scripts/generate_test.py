import os
import json
from dotenv import load_dotenv
import httpx

load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))
key = os.environ.get('GOOGLE_GEMINI_API_KEY')
model = os.environ.get('GOOGLE_GEMINI_MODEL', 'models/gemini-2.5-pro')
if not key:
    print('ERROR: GOOGLE_GEMINI_API_KEY not found')
    raise SystemExit(1)

url = f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent'
headers = {'Content-Type': 'application/json'}
payload = {
    'contents': [{'parts': [{'text': 'Write a concise JSON: {"hello": "world"}'}]}]
}
params = {'key': key}

with httpx.Client(timeout=30) as client:
    resp = client.post(url, headers=headers, params=params, json=payload)
    print('HTTP', resp.status_code)
    try:
        print(json.dumps(resp.json(), indent=2))
    except Exception:
        print(resp.text)
