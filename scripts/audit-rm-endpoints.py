"""Read only configured endpoint hostnames; never export environment secrets."""
import json,pathlib,subprocess,re,datetime
from urllib.parse import urlsplit
FUNCTION='lambda-raiz-prod-solicitacaoDePagamento'
def aws(*args):
 r=subprocess.run(['aws',*args,'--output','json'],capture_output=True,text=True)
 if r.returncode:
  match=re.search(r'An error occurred \(([^)]+)\)',r.stderr)
  raise RuntimeError('AWS read failed: '+(match.group(1) if match else 'CLI_ERROR'))
 return json.loads(r.stdout or '{}')
assert aws('sts','get-caller-identity')['Account']=='757843862365'
cfg=aws('lambda','get-function-configuration','--function-name',FUNCTION)
env=cfg.get('Environment',{}).get('Variables',{})
out={'observedUtc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'businessWrites':False,
 'function':FUNCTION,'codeSha256':cfg.get('CodeSha256'),'revisionId':cfg.get('RevisionId'),'endpoints':{}}
for key in ['RM_PROD','RM_DEV']:
 raw=str(env.get(key) or '').strip()
 parsed=urlsplit(raw if '://' in raw else 'http://'+raw)
 out['endpoints'][key]={'configured':bool(raw),'hostname':parsed.hostname if raw else None,
  'scheme':parsed.scheme if raw else None,'port':parsed.port if raw else None,
  'containsUserInfo':bool(parsed.username or parsed.password)}
out['sameConfiguredHost']=bool(out['endpoints']['RM_PROD']['hostname']) and out['endpoints']['RM_PROD']['hostname']==out['endpoints']['RM_DEV']['hostname']
out['developmentEnvironmentVerified']=False
p=pathlib.Path('.rm-endpoints');p.mkdir(exist_ok=True)
(p/'readback.json').write_text(json.dumps(out,indent=2),encoding='utf-8')
print(json.dumps(out,indent=2))
