"""Independent read-only verification of the one authorized legacy reservation repair."""
import argparse
import importlib.util
import json
from pathlib import Path

spec = importlib.util.spec_from_file_location('legacy226374_readback', Path(__file__).with_name('reconcile-legacy-226374.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def verify(evidence, live):
    m.require(evidence.get('mode') == 'apply' and evidence.get('applied') is True and
              evidence.get('outcome') == 'NEW_ATTEMPT_RESERVED', 'No confirmed applied recovery')
    manifest = evidence['manifest']
    m.require(manifest.get('root') == m.PK and manifest.get('ticket') == 226374, 'Evidence target mismatch')
    m.validate_root(manifest['originalSnapshot'])
    m.require(manifest['originalSnapshotSha256'] == m.sha(manifest['originalSnapshot']), 'Original snapshot hash mismatch')
    key = m.PK + '#ADJUDICATION#' + m.sha(manifest)
    m.require(evidence['evidenceKey'] == key, 'Evidence key mismatch')
    revision = live.bootstrap()
    expected = evidence['after']
    m.require(expected.get('state') == {'S': 'RESERVED'} and expected.get('protocolVersion') == {'N': '2'} and
              expected.get('digest') == {'S': manifest['newDigest']} and
              expected.get('reconciliationEvidenceKey') == {'S': key} and 'pg' not in expected,
              'Unexpected repaired reservation')
    m.require(live.get(m.PK) == expected, 'Reservation progressed/changed; inspect without retry')
    archive = {'pk': {'S': key}, 'manifestJson': {'S': m.canon(manifest)}, 'manifestSha256': {'S': m.sha(manifest)}}
    m.require(live.get(key) == archive, 'Immutable original history mismatch')
    current = live.observe()
    m.require(current == manifest['observations'] and current['revisionId'] == revision, 'Current observation changed')
    m.require(live.get(m.PK) == expected, 'Reservation changed during independent readback')
    return {'observedUtc': m.utc(), 'ticket': 226374, 'verified': True, 'state': 'RESERVED',
            'protocolVersion': 2, 'invoice': '1141', 'series': '1', 'idPgto': 3, 'codColPgto': 9,
            'ticketMovements': 0, 'ticketLaunches': 0, 'originalHistoryVerified': True,
            'codeSha256': current['codeSha256'], 'revisionId': revision,
            'financialWrites': False, 'zeevWrites': False, 'lambdaInvoked': False}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text(encoding='utf-8'))
    sha = evidence['manifest']['observations']['codeSha256']
    result = verify(evidence, m.Live(False, sha))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))

if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'verified': False, 'errorType': type(error).__name__,
                          'gate': str(error) if isinstance(error, m.GateError) else 'Read/validation failed'}))
        raise SystemExit(2)
