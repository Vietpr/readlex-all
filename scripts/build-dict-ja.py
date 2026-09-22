#!/usr/bin/env python3
"""Build the offline Japanese dictionary used by the extension.

Sources
  JMdict (EDRDG, CC BY-SA 4.0) as JSON from https://github.com/scriptin/jmdict-simplified
  KANJIDIC2 (EDRDG, CC BY-SA 4.0) as JSON from the same project
  OVDP "Từ điển Nhật-Việt" StarDict (GPLv2) from https://github.com/dynamotn/stardict-vi (ja-vi/)

Output (extension/dict/ja/)
  idx/<b>.json.gz    { key: [entryId, ...] }  b = (cp(first char) * 31 + cp(second char)) % 512
  ent/<b>.json.gz    { id: [kanji[[text, common]], kana[[text, common]], senses[[pos[], gloss[], misc[]]], types, vi] }
                     b = id % 512, types = verb/adjective bitmask matching ja-deinflect.js
  kanji/<b>.json.gz  { literal: [meanings[], on[], kun[], jlpt, grade, freq, strokes] }  b = codepoint >> 6
  index.json         metadata + list of existing buckets

Usage: python3 scripts/build-dict-ja.py   (downloads ~55 MB once into .cache/ja/)
"""
import collections
import datetime
import glob
import gzip
import json
import os
import re
import struct
import sys
import tarfile
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, '.cache', 'ja')
OUT = os.path.join(ROOT, 'extension', 'dict', 'ja')
BUCKETS = 512
RELEASES = 'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest'
OVDP = 'https://raw.githubusercontent.com/dynamotn/stardict-vi/HEAD/ja-vi/'


def fetch(url, path):
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return
    print('downloading', url)
    req = urllib.request.Request(url, headers={'User-Agent': 'readlex-build'})
    with urllib.request.urlopen(req) as r, open(path, 'wb') as f:
        f.write(r.read())


def download():
    os.makedirs(CACHE, exist_ok=True)
    if not glob.glob(os.path.join(CACHE, 'jmdict-eng-*.json')) or not glob.glob(os.path.join(CACHE, 'kanjidic2-en-*.json')):
        rel = json.load(urllib.request.urlopen(urllib.request.Request(RELEASES, headers={'User-Agent': 'readlex-build'})))
        for asset in rel['assets']:
            name = asset['name']
            if (name.startswith('jmdict-eng-') and 'common' not in name and 'examples' not in name and name.endswith('.json.tgz')) \
                    or (name.startswith('kanjidic2-en-') and name.endswith('.json.tgz')):
                path = os.path.join(CACHE, name)
                fetch(asset['browser_download_url'], path)
                with tarfile.open(path) as tar:
                    tar.extractall(CACHE)
    for name in ('star_nhatviet.dict', 'star_nhatviet.idx', 'star_nhatviet.ifo'):
        fetch(OVDP + name, os.path.join(CACHE, name))


def load_ovdp():
    idx = open(os.path.join(CACHE, 'star_nhatviet.idx'), 'rb').read()
    data = open(os.path.join(CACHE, 'star_nhatviet.dict'), 'rb').read()
    out = {}
    i = 0
    while i < len(idx):
        j = idx.index(b'\0', i)
        word = idx[i:j].decode('utf-8', 'replace')
        off, size = struct.unpack('>II', idx[j + 1:j + 9])
        i = j + 9
        text = data[off:off + size].decode('utf-8', 'replace')
        vi = None
        for line in text.split('\n'):
            line = line.strip()
            if not line.startswith('-'):
                continue
            body = line[1:].strip()
            if body.startswith('{'):
                close = body.find('}')
                if close < 0:
                    continue
                rest = body[close + 1:].strip().lstrip(',').strip()
            else:
                rest = body
            if rest:
                vi = rest
                break
        if not vi:
            continue
        vi = vi.split(';')[0].strip()
        if len(vi) > 90:
            cut = vi[:90]
            vi = cut[:cut.rfind(',')] if ',' in cut else cut
        vi = vi.strip(' ,.')
        if vi and word not in out:
            out[word] = vi
    return out


def bucket_key(key):
    cps = [ord(c) for c in key[:2]]
    return (cps[0] * 31 + (cps[1] if len(cps) > 1 else 0)) % BUCKETS


def types_of(tags):
    t = 0
    for tag in tags:
        if tag in ('v1', 'v1-s'):
            t |= 1
        elif tag.startswith('v5') or tag in ('v4r', 'v4k'):
            t |= 2
        elif tag in ('vs', 'vs-i', 'vs-s', 'vs-c'):
            t |= 4
        elif tag == 'vk':
            t |= 8
        elif tag in ('adj-i', 'adj-ix'):
            t |= 16
    return t


MISC_KEEP = {'uk', 'col', 'hon', 'hum', 'pol', 'arch', 'sl', 'vulg', 'derog', 'abbr', 'obs', 'fam', 'male', 'fem', 'chn', 'rare'}


def write_shards(folder, shards):
    os.makedirs(folder, exist_ok=True)
    for old in os.listdir(folder):
        os.remove(os.path.join(folder, old))
    total = 0
    for b, obj in shards.items():
        raw = json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
        blob = gzip.compress(raw, compresslevel=9, mtime=0)
        with open(os.path.join(folder, f'{b}.json.gz'), 'wb') as f:
            f.write(blob)
        total += len(blob)
    return total


def main():
    download()
    ovdp = load_ovdp()
    print('OVDP Vietnamese glosses:', len(ovdp))
    jm = json.load(open(glob.glob(os.path.join(CACHE, 'jmdict-eng-*.json'))[0], encoding='utf-8'))
    kd = json.load(open(glob.glob(os.path.join(CACHE, 'kanjidic2-en-*.json'))[0], encoding='utf-8'))

    idx = collections.defaultdict(lambda: collections.defaultdict(list))
    ent = collections.defaultdict(dict)
    n_keys = 0
    n_vi = 0
    for w in jm['words']:
        wid = int(w['id'])
        kanji = [[k['text'], 1 if k.get('common') else 0] for k in w['kanji']]
        kana = [[k['text'], 1 if k.get('common') else 0] for k in w['kana']]
        senses = []
        types = 0
        has_vs = False
        for s in w['sense']:
            pos = s['partOfSpeech']
            types |= types_of(pos)
            if 'vs' in pos:
                has_vs = True
            gloss = [g['text'] for g in s['gloss'] if g.get('lang') == 'eng'][:4]
            if not gloss:
                continue
            misc = [m for m in s.get('misc', []) if m in MISC_KEEP]
            senses.append([pos, gloss, misc])
            if len(senses) >= 6:
                break
        if not senses:
            continue
        vi = ''
        for k, _ in kanji:
            if k in ovdp:
                vi = ovdp[k]
                break
        if not vi:
            for k, _ in kana:
                if k in ovdp:
                    vi = ovdp[k]
                    break
        if vi:
            n_vi += 1
        ent[wid % BUCKETS][str(wid)] = [kanji, kana, senses, types, vi]
        keys = {k for k, _ in kanji} | {k for k, _ in kana}
        for key in keys:
            idx[bucket_key(key)][key].append(wid)
            n_keys += 1
            if has_vs:
                idx[bucket_key(key)][key + 'する'].append(wid)
                n_keys += 1

    kanji_shards = collections.defaultdict(dict)
    for c in kd['characters']:
        lit = c['literal']
        rm = c.get('readingMeaning') or {}
        groups = rm.get('groups') or []
        meanings, on, kun = [], [], []
        for g in groups:
            meanings += [m['value'] for m in g.get('meanings', []) if m.get('lang') == 'en']
            on += [r['value'] for r in g.get('readings', []) if r.get('type') == 'ja_on']
            kun += [r['value'] for r in g.get('readings', []) if r.get('type') == 'ja_kun']
        misc = c.get('misc') or {}
        strokes = (misc.get('strokeCounts') or [None])[0]
        kanji_shards[ord(lit) >> 6][lit] = [meanings[:6], on[:4], kun[:5], misc.get('jlptLevel'), misc.get('grade'), misc.get('frequency'), strokes]

    size = write_shards(os.path.join(OUT, 'idx'), idx)
    size += write_shards(os.path.join(OUT, 'ent'), ent)
    size += write_shards(os.path.join(OUT, 'kanji'), kanji_shards)
    index = {
        'name': 'JMdict + KANJIDIC2 + Từ điển Nhật-Việt (OVDP)',
        'sources': ['https://github.com/scriptin/jmdict-simplified (JMdict, KANJIDIC2 - EDRDG CC BY-SA 4.0)',
                    'https://github.com/dynamotn/stardict-vi ja-vi/star_nhatviet (OVDP, GPLv2)'],
        'jmdictVersion': jm.get('version'), 'jmdictDate': jm.get('dictDate'),
        'builtAt': datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds'),
        'entries': sum(len(v) for v in ent.values()), 'keys': n_keys, 'withVietnamese': n_vi,
        'kanji': sum(len(v) for v in kanji_shards.values()), 'buckets': BUCKETS,
        'shards': {'idx': sorted(idx), 'ent': sorted(ent), 'kanji': sorted(kanji_shards)},
    }
    with open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8') as f:
        json.dump(index, f, ensure_ascii=False)
    print(f"entries {index['entries']}, keys {n_keys}, with Vietnamese {n_vi}, kanji {index['kanji']}, {size / 1e6:.1f} MB gz -> {OUT}")


if __name__ == '__main__':
    sys.exit(main())
