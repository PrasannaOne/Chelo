#!/usr/bin/env python3
import json, re, statistics
from pathlib import Path
trace = Path('benchmarks/results/STAGE38-V8-PROFILE-TRACE.txt')
lines = trace.read_text(errors='replace').splitlines()
rows = []
for i, line in enumerate(lines):
    match = re.search(r'CHELO_PROFILE_BEGIN_(\d+)', line)
    if not match:
        continue
    isolate = int(match.group(1))
    end = next((j for j in range(i + 1, len(lines)) if f'CHELO_PROFILE_END_{isolate} ' in lines[j]), None)
    if end is None:
        raise SystemExit(f'Missing end marker for isolate {isolate}')
    window = lines[i + 1:end]
    result = json.loads(lines[end].split(' ', 1)[1])
    rows.append({
        **result,
        'isolate': isolate,
        'inWindowScavenges': sum('Scavenge' in item for item in window),
        'inWindowOtherGC': sum('Mark-Compact' in item or 'Minor GC' in item for item in window),
        'inWindowDeopts': sum('bailout' in item.lower() or 'deopt' in item.lower() for item in window),
    })
if len(rows) != 5 or any(row['nodes'] != 30000 for row in rows):
    raise SystemExit('Expected five isolates with 30,000 nodes each')
summary = {
    'format': 'Chelo Stage 3.8 warmed V8 profile',
    'runtime': 'Node.js V8 on Linux container; not Android hardware',
    'warmupSearchesPerIsolate': 12,
    'measuredNodesPerIsolate': 30000,
    'isolates': rows,
    'medianNps': statistics.median(row['nps'] for row in rows),
    'meanNps': round(statistics.mean(row['nps'] for row in rows)),
    'inWindowScavenges': sum(row['inWindowScavenges'] for row in rows),
    'inWindowOtherGC': sum(row['inWindowOtherGC'] for row in rows),
    'inWindowDeopts': sum(row['inWindowDeopts'] for row in rows),
    'scope': 'Five isolated Node V8 isolates; warmed search window only. No claim about all startup events or Android Chromium.',
}
Path('benchmarks/results/STAGE38-V8-PROFILE.json').write_text(json.dumps(summary, indent=2) + '\n')
print(json.dumps({key: value for key, value in summary.items() if key not in ('isolates', 'scope')}, indent=2))
