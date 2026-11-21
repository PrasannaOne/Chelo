#!/usr/bin/env python3
"""Independently audit the Stage 3.7 paired-gauntlet JSON files and C36N SHA/header."""
from pathlib import Path
import collections, hashlib, json, math, struct
ROOT=Path(__file__).resolve().parents[1]
RESULTS=ROOT/'benchmarks'/'results'
T95_DF29=2.045229642

def audit(name):
    report=json.loads((RESULTS/name).read_text())
    games=report['games']; pairs=report['pairs']; result=report['result']
    assert len(games)==60 and len(pairs)==30
    assert len({g['openingFen'] for g in games})==30
    assert collections.Counter(g['candidateColor'] for g in games)=={'w':30,'b':30}
    assert all(g.get('moves') and g['plies']<=100 for g in games)
    w=sum(g['outcome']=='win' for g in games); l=sum(g['outcome']=='loss' for g in games); d=sum(g['outcome']=='draw' for g in games)
    assert (w,l,d)==(result['wins'],result['losses'],result['draws'])
    scores=[]
    for pair in pairs:
        rows=[g for g in games if g['pair']==pair['pair']]
        assert len(rows)==2 and {g['candidateColor'] for g in rows}=={'w','b'}
        assert len({g['openingFen'] for g in rows})==1
        s=sum(1 if g['outcome']=='win' else .5 if g['outcome']=='draw' else 0 for g in rows)/2
        assert abs(s-pair['pairScore'])<1e-12
        scores.append(s)
    score=(w+.5*d)/60
    mean=sum(scores)/30
    variance=sum((x-mean)**2 for x in scores)/29
    se=math.sqrt(variance/30)
    lo,hi=mean-T95_DF29*se,mean+T95_DF29*se
    elo=400*math.log10(score/(1-score))
    ci=[400*math.log10(lo/(1-lo)),400*math.log10(hi/(1-hi))]
    assert abs(elo-result['estimatedEloGain'])<1e-8
    assert max(abs(ci[i]-result['pairedOpening95PercentEloCI'][i]) for i in range(2))<1e-7
    return {'file':name,'WLD':[w,l,d],'scorePercentage':score*100,'estimatedEloGain':elo,'pairedOpening95PercentEloCI':ci,'openingPairs':30,'games':60,'colorBalance':'30 white / 30 black','capDraws':result['capDraws'],'lowerBoundPositive':ci[0]>0}

bin_data=(ROOT/'models'/'dual-nnue-v37.bin').read_bytes()
sha=hashlib.sha256(bin_data).hexdigest()
assert len(bin_data)==49368 and bin_data[:4]==b'C36N'
version,features,hidden,flags=struct.unpack_from('<HHHH',bin_data,4)
divisor,reserved=struct.unpack_from('<II',bin_data,12)
assert (version,features,hidden,flags,divisor,reserved)==(1,768,32,1,1048576,0)
assert sha=='f9ffe3f0dc641c93be26f871086182a82291411a4e4b59c073fcc7c8bfc4022e'
summary={'format':'Chelo Stage 3.7 result audit','binary':{'bytes':len(bin_data),'sha256':sha,'header':'C36N v1, 768 features, 32 hidden/perspective, flags=1, divisor=1048576'},'gauntlets':[audit('STAGE37-VS-STAGE34C-60-GAME-RESULTS.json'),audit('STAGE37-VS-STAGE36-60-GAME-RESULTS.json')]}
assert all(x['lowerBoundPositive'] for x in summary['gauntlets'])
print(json.dumps(summary,indent=2))
