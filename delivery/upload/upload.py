import sys, json, os, urllib.request, urllib.parse
BASE = 'http://127.0.0.1:8799'
PART = 64 * 1024 * 1024
def call(op, params, data=None):
    q = urllib.parse.urlencode(params)
    r = urllib.request.Request(f'{BASE}/{op}?{q}', data=data, method='POST')
    return json.load(urllib.request.urlopen(r, timeout=600))
path, key, ct = sys.argv[1:4]
up = call('create', {'key': key, 'ct': ct})['uploadId']
parts, n = [], 1
try:
    with open(path, 'rb') as f:
        while chunk := f.read(PART):
            for attempt in range(3):
                try:
                    parts.append(call('part', {'key': key, 'uploadId': up, 'n': n}, chunk)); break
                except Exception as e:
                    if attempt == 2: raise
            n += 1
    print(key, call('complete', {'key': key, 'uploadId': up}, json.dumps(parts).encode()))
except Exception:
    call('abort', {'key': key, 'uploadId': up}); raise
