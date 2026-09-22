#!/usr/bin/env python3
"""Build the offline English-Vietnamese dictionary shards used by the extension.

Source: OVDP (Open Vietnamese Dictionary Project) StarDict "Từ điển Anh-Việt" (star_anhviet),
mirrored at https://github.com/dynamotn/stardict-vi (folder en-vi/). The general dictionary
part is Hồ Ngọc Đức's Free Vietnamese Dictionary Project (GPL).

Output (all inside extension/dict/en-vi/):
  w/<xx>.json.gz   single-word headwords, keyed by lowercase headword
  p/<xx>.json.gz   2-3 word headwords (phrasal verbs, collocations, terms)
  index.json       list of shard prefixes + metadata
Each shard is a gzip'd JSON object { "headword": "raw entry text" }.
<xx> = first two characters of the lowercase headword, non [a-z0-9] replaced by "_".

Usage:  python3 scripts/build-dict.py        (downloads ~18 MB once into .cache/stardict/)
"""
import collections
import datetime
import gzip
import json
import os
import re
import struct
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'stardict')
OUT = os.path.join(ROOT, 'extension', 'dict', 'en-vi')
BASE_URL = 'https://raw.githubusercontent.com/dynamotn/stardict-vi/HEAD/en-vi/'
FILES = ['star_anhviet.dict.dz', 'star_anhviet.idx', 'star_anhviet.ifo']


def download():
    os.makedirs(CACHE, exist_ok=True)
    for name in FILES:
        path = os.path.join(CACHE, name)
        if os.path.exists(path) and os.path.getsize(path) > 0:
            continue
        print('downloading', name)
        urllib.request.urlretrieve(BASE_URL + name, path)


def read_entries():
    idx = open(os.path.join(CACHE, 'star_anhviet.idx'), 'rb').read()
    data = gzip.open(os.path.join(CACHE, 'star_anhviet.dict.dz'), 'rb').read()
    i = 0
    while i < len(idx):
        j = idx.index(b'\0', i)
        word = idx[i:j].decode('utf-8', 'replace')
        off, size = struct.unpack('>II', idx[j + 1:j + 9])
        i = j + 9
        yield word, data[off:off + size].decode('utf-8', 'replace')


def prefix(key):
    p = re.sub(r'[^a-z0-9]', '_', key[:2])
    return (p + '__')[:2]


def clean(text):
    text = text.replace('\r', '').replace('﻿', '')
    return '\n'.join(line.rstrip() for line in text.split('\n') if line.strip())


def main():
    download()
    words = collections.defaultdict(dict)
    phrases = collections.defaultdict(dict)
    counts = {'words': 0, 'phrases': 0, 'skipped': 0}
    for word, text in read_entries():
        key = ' '.join(word.lower().split())
        if not key or len(key) > 60:
            counts['skipped'] += 1
            continue
        n = len(key.split())
        if n == 1:
            target, kind = words, 'words'
        elif n <= 3 and '(' not in key:
            target, kind = phrases, 'phrases'
        else:
            counts['skipped'] += 1
            continue
        bucket = target[prefix(key)]
        cleaned = clean(text)
        if key in bucket:
            bucket[key] = bucket[key] + '\n' + cleaned
        else:
            bucket[key] = cleaned
            counts[kind] += 1

    total_bytes = 0
    for kind, shards in (('w', words), ('p', phrases)):
        folder = os.path.join(OUT, kind)
        os.makedirs(folder, exist_ok=True)
        for old in os.listdir(folder):
            os.remove(os.path.join(folder, old))
        for p, bucket in shards.items():
            raw = json.dumps(bucket, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
            blob = gzip.compress(raw, compresslevel=9, mtime=0)
            with open(os.path.join(folder, p + '.json.gz'), 'wb') as f:
                f.write(blob)
            total_bytes += len(blob)

    index = {
        'name': 'Từ điển Anh-Việt (OVDP star_anhviet)',
        'source': 'https://github.com/dynamotn/stardict-vi (en-vi/star_anhviet)',
        'license': 'GPL - Free Vietnamese Dictionary Project (Hồ Ngọc Đức) / OVDP',
        'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'words': counts['words'],
        'phrases': counts['phrases'],
        'shards': {'w': sorted(words), 'p': sorted(phrases)},
    }
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)
    print(f"words {counts['words']}, phrases {counts['phrases']}, skipped {counts['skipped']}, "
          f"shards {len(words)}+{len(phrases)}, {total_bytes / 1e6:.1f} MB gz -> {OUT}")


if __name__ == '__main__':
    sys.exit(main())
