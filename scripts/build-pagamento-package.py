"""Replace only the authorized entrypoint and preserve the production core."""
import argparse, base64, copy, hashlib, json, pathlib, zipfile

p=argparse.ArgumentParser()
p.add_argument('--baseline',required=True);p.add_argument('--bundle',required=True);p.add_argument('--output',required=True)
p.add_argument('--expected-baseline-sha',default='b67LvMkiNMdDwbxosvWUdLuROKDowQPGQkdqPf/pjfg=')
args=p.parse_args()
baseline=pathlib.Path(args.baseline);bundle=pathlib.Path(args.bundle);target=pathlib.Path(args.output)
target.parent.mkdir(parents=True,exist_ok=True)
entry='src/functions/rm/post/solicitacaoDePagamento.js'
core='src/functions/rm/post/solicitacaoDePagamento.core.cjs'
sha=lambda data:base64.b64encode(hashlib.sha256(data).digest()).decode()
assert sha(baseline.read_bytes())==args.expected_baseline_sha, 'Production baseline drift'
with zipfile.ZipFile(baseline) as old,zipfile.ZipFile(target,'w') as new:
    original={info.filename.replace('\\','/'):info for info in old.infolist()}
    assert len(original)==len(old.infolist()), 'Ambiguous ZIP paths'
    assert entry in original
    core_bytes=old.read(original[core]) if core in original else old.read(original[entry])
    assert hashlib.sha256(core_bytes).hexdigest()=='cf802a6ef20cd6047e94e0ebdfe45da7ea923a36aafd103dada801cde6bb352e'
    for name,info in original.items():
        cloned=copy.copy(info);cloned.filename=name;cloned.orig_filename=name
        new.writestr(cloned,bundle.read_bytes() if name==entry else old.read(info))
    if core not in original:
        info=zipfile.ZipInfo(core,date_time=(2026,10,29,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
        new.writestr(info,core_bytes)
with zipfile.ZipFile(baseline) as old,zipfile.ZipFile(target) as new:
    assert core_bytes==new.read(core)
    for name,info in original.items():
        if name!=entry:assert old.read(info)==new.read(name),name
    preview=target.parent/'package-preview'
    for info in new.infolist():
        path=(preview/info.filename).resolve()
        assert path.is_relative_to(preview.resolve()),'Unsafe ZIP path'
    new.extractall(preview)
manifest={'baselineCodeSha256':sha(baseline.read_bytes()),'candidateCodeSha256':sha(target.read_bytes()),
    'coreByteForBytePreserved':True,'otherEntriesPreserved':True,'handler':'src/functions/rm/post/solicitacaoDePagamento.handler'}
target.with_suffix('.manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps(manifest,indent=2))
