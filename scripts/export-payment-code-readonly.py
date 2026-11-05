"""Read the active payment code; export encrypted code, never config or credentials.

AWS operations are explicitly limited to STS GetCallerIdentity and Lambda
GetFunction. This script does not invoke a Lambda or write any AWS resource.
"""
import base64
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import urllib.parse
import urllib.request
import zipfile

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
REGION = 'sa-east-1'
ACCOUNT = '757843862365'
ENTRY = 'src/functions/rm/post/solicitacaoDePagamento.js'
CORE = 'src/functions/rm/post/solicitacaoDePagamento.core.cjs'
SOURCE_REF = 'c21a97afcffa0ee0298677d7fa435e55a427c6be'
AAD = b'lambda-payment-code-export-v1'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def sha64(data):
    return base64.b64encode(hashlib.sha256(data).digest()).decode()


def aws(service, operation, *args):
    assert (service, operation) in {('sts', 'get-caller-identity'), ('lambda', 'get-function')}
    r = subprocess.run(['aws', service, operation, *args, '--region', REGION,
                        '--output', 'json', '--no-cli-pager'], capture_output=True)
    if r.returncode:
        raise RuntimeError('Read-only AWS operation failed: ' + service + '/' + operation)
    return json.loads(r.stdout)


def active():
    response = aws('lambda', 'get-function', '--function-name', FUNCTION)
    cfg = response['Configuration']
    assert cfg['FunctionArn'] == f'arn:aws:lambda:{REGION}:{ACCOUNT}:function:{FUNCTION}'
    assert cfg['State'] == 'Active' and cfg['LastUpdateStatus'] == 'Successful'
    assert cfg['Handler'] == 'src/functions/rm/post/solicitacaoDePagamento.handler'
    assert cfg['Runtime'] == 'nodejs22.x' and cfg['Architectures'] == ['arm64']
    return response


def main():
    assert aws('sts', 'get-caller-identity')['Account'] == ACCOUNT
    # Config remains in memory: its environment may contain credentials.
    before = active()
    cfg = before['Configuration']
    location = before['Code']['Location']
    url = urllib.parse.urlparse(location)
    assert url.scheme == 'https' and url.hostname.endswith('.amazonaws.com')
    with urllib.request.urlopen(location, timeout=60) as response:
        package = response.read(64 * 1024 * 1024 + 1)
    assert len(package) <= 64 * 1024 * 1024
    assert sha64(package) == cfg['CodeSha256'], 'Downloaded package hash mismatch'
    selected = {}
    with zipfile.ZipFile(io.BytesIO(package)) as z:
        assert len(z.namelist()) == len(set(z.namelist()))
        for name in [ENTRY, CORE, 'package.json']:
            selected['02-Codigo-publicado-AWS/' + name] = z.read(name)
        omitted = [i.filename for i in z.infolist() if not i.is_dir() and i.filename not in [ENTRY, CORE, 'package.json']]
    compiled = Path('.build/solicitacaoDePagamento.cjs').read_bytes()
    assert compiled == selected['02-Codigo-publicado-AWS/' + ENTRY], 'Sources do not reproduce the active AWS entrypoint'
    # Export only first-party files actually used by the verified bundle.
    meta = json.loads(Path('.build/payment-export-metafile.json').read_text())
    sources = sorted(p for p in meta['inputs'] if p.startswith('src/'))
    assert 'src/functions/rm/post/solicitacaoDePagamento.ts' in sources
    assert sources and all('..' not in Path(p).parts and Path(p).suffix in {'.ts', '.js', '.json'} for p in sources)
    for name in sources + ['package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.pagamento.json']:
        assert subprocess.check_output(['git', 'show', SOURCE_REF + ':' + name]) == Path(name).read_bytes(), 'Source differs from pinned commit'
        selected['01-Fontes-TypeScript/' + name] = Path(name).read_bytes()
    after = active()['Configuration']
    assert cfg['CodeSha256'] == after['CodeSha256'] and cfg['RevisionId'] == after['RevisionId'], 'AWS function changed during export'
    # Never serialize cfg or the presigned download URL.
    manifest = {
        'exportedAtUtc': datetime.now(timezone.utc).isoformat(),
        'functionName': FUNCTION, 'region': REGION,
        'handler': cfg['Handler'], 'runtime': cfg['Runtime'], 'architectures': cfg['Architectures'],
        'lastModified': cfg['LastModified'], 'revisionId': cfg['RevisionId'],
        'awsOriginalPackageCodeSha256Base64': cfg['CodeSha256'],
        'sourceCommit': SOURCE_REF, 'sourceRepository': 'RaizEducacaoDev/Lambda-Raiz',
        'compiledSourceMatchesActiveEntrypointByteForByte': True,
        'unchangedDuringReadback': True,
        'awsWrites': False, 'lambdaInvocations': False, 'exportedEnvironmentVariables': False,
        'omittedAwsFiles': omitted,
        'note': 'Selected code files are exact copies. Original ZIP metadata and the old source map are not part of this export. The TypeScript reproduces the entrypoint; the legacy core is supplied as its exact published binary text, without reconstructed TypeScript.',
        'files': [{'path': p, 'bytes': len(data), 'sha256Hex': sha(data)} for p, data in sorted(selected.items())],
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in selected.items():
            z.writestr(name, data)
        z.writestr('manifesto-verificacao.json', json.dumps(manifest, indent=2, ensure_ascii=False))
    key = AESGCM.generate_key(bit_length=256)
    nonce = os.urandom(12)
    public = serialization.load_pem_public_key(Path('.github/payment-export-public.pem').read_bytes())
    wrapped = public.encrypt(key, padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None))
    encrypted = AESGCM(key).encrypt(nonce, buf.getvalue(), AAD)
    out = Path('.payment-code-export')
    out.mkdir(exist_ok=False)
    (out / 'codigo.aesgcm').write_bytes(encrypted)
    envelope = {'version': 1, 'algorithm': 'RSA-OAEP-SHA256+A256GCM',
                'wrappedKeyBase64': base64.b64encode(wrapped).decode(),
                'nonceBase64': base64.b64encode(nonce).decode(),
                'encryptedSha256Hex': sha(encrypted)}
    (out / 'envelope.json').write_text(json.dumps(envelope, indent=2), encoding='utf-8')
    print(json.dumps({'exported': True, 'sourceMatchesActiveCode': True,
                      'awsPackageCodeSha256': cfg['CodeSha256'], 'codeFileCount': len(selected),
                      'encryptedArtifactOnly': True, 'awsWrites': False, 'lambdaInvocations': False}))


if __name__ == '__main__':
    main()
