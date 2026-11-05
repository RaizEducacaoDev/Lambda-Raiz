"""Build a compact proof from a complete sanitized read-only AWS audit."""
import argparse,hashlib,json
from pathlib import Path

p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--run-id',required=True);args=p.parse_args()
data=json.loads(args.source.read_text(encoding='utf-8'))
original=data['originalInvocation'];after=data['afterOriginal']
assert original['requestId']=='4efffdfd-b6d7-4a87-857f-fe99421654d3'
proof={'originalRequestId':original['requestId'],
 'endSeen':any(e.get('kind')=='lambda_end' for e in original['events']),
 'reportSeen':any(e.get('kind')=='lambda_report' for e in original['events']),
 'logCoverageComplete':original['coverage']['complete'] and after['coverage']['complete'],
 'creationCallsAfterOriginal':after['creationCallsAfterOriginal'],'observedUtc':data['observedUtc'],
 'auditRunId':args.run_id,'sourceSha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),
 'activeCodeSha256':data['function']['CodeSha256']}
assert proof['endSeen'] and proof['reportSeen'] and proof['logCoverageComplete'] and proof['creationCallsAfterOriginal']==0
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(proof,indent=2),encoding='utf-8')
print(json.dumps({'closureComplete':True,'creationCallsAfterOriginal':0,'sourceSha256':proof['sourceSha256']}))
