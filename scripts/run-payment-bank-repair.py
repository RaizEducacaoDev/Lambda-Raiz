"""Prepare eight bank-only plans; apply only a pinned, explicitly approved run.

No document creation, Lambda invocation or Zeev write. Leases are acquired one
target at a time and restored only after the native operator verified success.
An unknown outcome leaves the lease to expire and stops the batch without retry.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'RaizEducacaoDev/Lambda-Raiz'
BRANCH = 'fix/idpgto-vinculo-obrigatorio'
WORKFLOW = '.github/workflows/payment-bank-repair.yml'
CONFIG = ROOT / '.github/payment-bank-repair.json'
AUDIT_RUN = '41892943724'
AUDIT = Path('.payment-bulk-readonly/readback.json')
OUT = Path('.payment-bank-repair')
APPROVED = Path('.approved-payment-bank-repair')
CANARY = Path('.verified-payment-bank-canary')


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


operator = load('bank_runner_operator', ROOT / 'scripts/repair-payment-bank-backlog.py')
claim_gate = load('bank_runner_claim_gate', ROOT / 'scripts/payment_bank_claim_gate.py')
lease = operator.lease_module
TARGETS = dict(operator.TARGETS)


def require(ok, code):
    operator.require(ok, code)


def file_sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    operator.write_json(path, value, exclusive=True)


def context(env=None):
    env = os.environ if env is None else env
    require(env.get('GITHUB_ACTIONS') == 'true' and env.get('GITHUB_EVENT_NAME') == 'push' and
            env.get('GITHUB_REF') == 'refs/heads/' + BRANCH and env.get('GITHUB_RUN_ATTEMPT') == '1' and
            env.get('GITHUB_REPOSITORY') == REPOSITORY, 'WORKFLOW_CONTEXT_OR_RETRY_REJECTED')
    require(re.fullmatch(r'[1-9]\d*', env.get('GITHUB_RUN_ID', '')) and
            re.fullmatch(r'[a-f0-9]{40}', env.get('GITHUB_SHA', '')), 'WORKFLOW_IDENTITY_INVALID')
    return {'repository': REPOSITORY, 'branch': BRANCH, 'workflow': WORKFLOW,
            'runId': env['GITHUB_RUN_ID'], 'commit': env['GITHUB_SHA']}


def validate_config(c):
    keys = {'version', 'mode', 'tickets', 'authorizedBankRepair', 'approvedPrepareRunId',
            'approvedManifestSha256', 'verifiedCanaryRunId', 'verifiedCanarySummarySha256'}
    require(isinstance(c, dict) and set(c) == keys and type(c['version']) is int and c['version'] == 1, 'CONFIG_SCHEMA_INVALID')
    require(c['mode'] in ('prepare', 'apply') and type(c['authorizedBankRepair']) is bool, 'CONFIG_MODE_INVALID')
    tickets = c['tickets']
    require(isinstance(tickets, list) and tickets and all(type(t) is int and t in TARGETS for t in tickets) and
            len(set(tickets)) == len(tickets), 'TICKET_SCOPE_INVALID')
    for key in ['approvedPrepareRunId', 'approvedManifestSha256', 'verifiedCanaryRunId', 'verifiedCanarySummarySha256']:
        require(isinstance(c[key], str), 'APPROVAL_FORMAT_INVALID')
    if c['mode'] == 'prepare':
        require(c['authorizedBankRepair'] is False and c['approvedPrepareRunId'] == c['verifiedCanaryRunId'] == '0' and
                c['approvedManifestSha256'] == c['verifiedCanarySummarySha256'] == '', 'PREPARE_MUST_NOT_AUTHORIZE_WRITE')
    else:
        require(c['authorizedBankRepair'] is True and re.fullmatch(r'[1-9]\d*', c['approvedPrepareRunId']) and
                re.fullmatch(r'[a-f0-9]{64}', c['approvedManifestSha256']), 'EXPLICIT_REVIEWED_APPROVAL_REQUIRED')
        if c['verifiedCanaryRunId'] == '0':
            require(tickets == [228007] and c['verifiedCanarySummarySha256'] == '', 'FIRST_APPLY_MUST_BE_ONLY_CANARY')
        else:
            require(re.fullmatch(r'[1-9]\d*', c['verifiedCanaryRunId']) and
                    re.fullmatch(r'[a-f0-9]{64}', c['verifiedCanarySummarySha256']) and 228007 not in tickets,
                    'VERIFIED_CANARY_REQUIRED_FOR_REMAINING_TARGETS')
    return c


def code_hashes():
    paths = [Path('scripts/run-payment-bank-repair.py'), Path('scripts/repair-payment-bank-backlog.py'),
             Path('scripts/lease-payment-bank-backlog.py'), Path('scripts/observe-payment-backlog.py'),
             Path('scripts/reconcile-payment-backlog.py'), Path('scripts/audit-payment-conflict-20261103-0609.py'),
             Path('scripts/payment-backlog-template.txt'), Path('tests/load-ts.cjs'), Path('package.json'),
             Path('package-lock.json'), Path(WORKFLOW), Path('tests/test_payment_bank_repair_runner.py'),
             Path('tests/test_payment_bank_repair.py'), Path('tests/test_payment_bank_lease.py')]
    paths += [Path('scripts/payment_bank_claim_gate.py'), Path('scripts/adjudicate-payment-bank-no-effect.py'),
              Path('scripts/payment_bank_diagnostic_contract.py'), Path('tests/test_payment_bank_claim_gate.py')]
    paths += [p.relative_to(ROOT) for pattern in ['src/**/*.ts', 'sql/*.sql', 'tsconfig*.json'] for p in ROOT.glob(pattern)]
    return {p.as_posix(): file_sha(ROOT / p) for p in sorted(set(paths))}


def verify_run(run_id, ctx):
    require(run_id != ctx['runId'], 'APPROVAL_CANNOT_REFERENCE_CURRENT_RUN')
    token = os.environ.get('GH_TOKEN')
    require(bool(token), 'GITHUB_READ_TOKEN_MISSING')
    request = urllib.request.Request(f'https://api.github.com/repos/{REPOSITORY}/actions/runs/{run_id}', headers={
        'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.build_opener(operator.observer.NoRedirect()).open(request, timeout=15) as response:
            run = json.load(response)
    except (urllib.error.URLError, TimeoutError):
        raise operator.GuardError('APPROVED_WORKFLOW_READ_FAILED') from None
    require(str(run.get('id')) == run_id and run.get('repository', {}).get('full_name') == REPOSITORY and
            run.get('path') == WORKFLOW and run.get('head_branch') == BRANCH and run.get('event') == 'push' and
            run.get('run_attempt') == 1 and run.get('status') == 'completed' and run.get('conclusion') == 'success',
            'APPROVED_WORKFLOW_NOT_SUCCESSFUL')
    return run


def validate_plan(plan, ticket):
    company, mov, lan, *_ = TARGETS[ticket]
    require(plan.get('version') == 1 and (plan.get('ticket'), plan.get('company'), plan.get('idmov'), plan.get('idlan')) ==
            (ticket, company, mov, lan), 'EXACT_PLAN_TARGET_CHANGED')
    runtime = plan.get('baseline', {}).get('remoteSources', {}).get('runtime', {})
    require(set(runtime) == {'codeSha256', 'revisionId'} and
            re.fullmatch(r'[A-Za-z0-9+/]{43}=', runtime.get('codeSha256', '')) and
            re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', runtime.get('revisionId', '')),
            'EXACT_RUNTIME_IDENTITY_MISSING')
    require(plan.get('writeFields') and set(plan['writeFields']) <= operator.WRITABLE and
            {'IDPGTO', 'CODCOLPGTO'} <= set(plan['writeFields']), 'PLAN_WRITE_SCOPE_INVALID')
    if ticket == 228007:
        require(set(plan['writeFields']) == {'IDPGTO', 'CODCOLPGTO'}, 'CANARY_FIELDS_NOT_MINIMAL')
    return runtime


def approved_plans(c, ctx):
    manifest_path = APPROVED / 'manifest.json'
    require(file_sha(manifest_path) == c['approvedManifestSha256'], 'APPROVED_MANIFEST_SHA_MISMATCH')
    manifest = read(manifest_path)
    require(manifest.get('version') == 1 and manifest.get('mode') == 'prepare' and manifest.get('allPrepared') is True and
            manifest.get('bankWrites') is False and manifest.get('zeevWrites') is False and manifest.get('lambdaInvoked') is False,
            'APPROVED_MANIFEST_NOT_READONLY_PREPARE')
    source = manifest.get('workflow', {})
    run = verify_run(c['approvedPrepareRunId'], ctx)
    require(source == {**ctx, 'runId': c['approvedPrepareRunId'], 'commit': run.get('head_sha')}, 'APPROVED_SOURCE_PROVENANCE_CHANGED')
    require(manifest.get('codeSha256') == code_hashes(), 'REVIEWED_SOURCE_CHANGED')
    require(manifest.get('audit') == {'runId': AUDIT_RUN, 'sha256': file_sha(AUDIT)}, 'AUDIT_ARTIFACT_CHANGED')
    tickets = manifest.get('requestedTickets')
    require(isinstance(tickets, list) and tickets and all(type(t) is int and t in TARGETS for t in tickets) and
            len(set(tickets)) == len(tickets) and set(c['tickets']) <= set(tickets), 'APPROVED_SCOPE_INVALID')
    inventory = manifest.get('files', {})
    require(set(inventory) == {f'{kind}-{t}.json' for t in tickets for kind in ['plan', 'prepare']}, 'APPROVED_FILE_INVENTORY_INVALID')
    for name, expected in inventory.items():
        require(file_sha(APPROVED / name) == expected, 'APPROVED_FILE_CHANGED')
    plans = {}
    for ticket in c['tickets']:
        plan = read(APPROVED / f'plan-{ticket}.json')
        runtime = validate_plan(plan, ticket)
        prepared = read(APPROVED / f'prepare-{ticket}.json')
        require(prepared.get('ticket') == ticket and prepared.get('mode') == 'READ_ONLY' and prepared.get('bankWrites') is False and
                prepared.get('planSha256') == operator.digest(plan) and prepared.get('runtime') == runtime == manifest.get('runtime'),
                'APPROVED_PLAN_OR_RUNTIME_CHANGED')
        plans[ticket] = plan
    return plans


def verified_canary(c, ctx, expected_runtime):
    if c['verifiedCanaryRunId'] == '0':
        return
    path = CANARY / 'summary.json'
    require(file_sha(path) == c['verifiedCanarySummarySha256'], 'CANARY_SUMMARY_SHA_MISMATCH')
    summary = read(path)
    run = verify_run(c['verifiedCanaryRunId'], ctx)
    require(summary.get('workflow') == {**ctx, 'runId': c['verifiedCanaryRunId'], 'commit': run.get('head_sha')} and
            summary.get('version') == 1 and summary.get('mode') == 'apply' and summary.get('requestedTickets') == [228007] and
            summary.get('allVerified') is True and summary.get('codeSha256') == code_hashes() and summary.get('runtime') == expected_runtime and
            summary.get('zeevWrites') is False and summary.get('lambdaInvoked') is False, 'CANARY_PROVENANCE_OR_CODE_INVALID')
    rows = summary.get('results', [])
    require(len(rows) == 1 and rows[0].get('ticket') == 228007 and rows[0].get('state') == 'VERIFIED' and
            rows[0].get('bankVerified') is True and rows[0].get('leaseReleased') is True, 'CANARY_NOT_FULLY_VERIFIED')


def apply_one(ticket, plan, audit, ctx):
    company, *_ = TARGETS[ticket]
    require(lease.aws('sts', 'get-caller-identity', {})['Account'] == lease.ACCOUNT, 'AWS_ACCOUNT_MISMATCH')
    claim = lease.get(claim_gate.attempt_key(company, ticket))
    require(type(claim) is dict and claim == {}, 'DURABLE_BANK_ATTEMPT_ALREADY_EXISTS_NO_RETRY')
    claim_gate.assert_ready(lease.get, company, ticket)
    lease.OUT.mkdir(exist_ok=True)
    lease.acquire({'ticket': ticket}, audit)
    proof_path = lease.OUT / f'lease-{ticket}.json'
    proof = read(proof_path)
    proof_sha = file_sha(proof_path)
    require(operator.validate_lease(proof_path, proof_sha, ticket) == proof, 'LEASE_FILE_CHANGED')
    operator.checked_remote_proof(proof, ticket)
    target_out = OUT / f'ticket-{ticket}'
    adapter = operator.RemoteLiveAdapter(ticket, proof)
    result = operator.execute(adapter, ticket, plan, operator.digest(plan), target_out,
        f'https://github.com/{REPOSITORY}/actions/runs/{ctx["runId"]}', proof_path, proof_sha)
    require(result.get('state') == 'VERIFIED' and result.get('sameSessionAndIndependentReadback') is True and
            result.get('retryAllowed') is False and result.get('ticket') == ticket, 'BANK_OUTCOME_NOT_FULLY_VERIFIED_NO_RETRY')
    restored = lease.release(proof)
    require(restored.get('released') is True and restored.get('originalRootExactlyRestored') is True, 'LEASE_RELEASE_NOT_VERIFIED')
    return {'ticket': ticket, 'state': 'VERIFIED', 'bankVerified': True, 'leaseReleased': True, 'automaticRetry': False}


def execute(c, ctx):
    c = validate_config(c)
    OUT.mkdir(exist_ok=False)
    audit = read(AUDIT)
    require(audit.get('coverageComplete') is True, 'AUDIT_INCOMPLETE')
    plans = approved_plans(c, ctx) if c['mode'] == 'apply' else None
    runtime = validate_plan(plans[c['tickets'][0]], c['tickets'][0]) if plans is not None else None
    if plans is not None:
        verified_canary(c, ctx, runtime)
    rows, files = [], {}
    for ticket in c['tickets']:
        try:
            if c['mode'] == 'prepare':
                snapshot = operator.RemoteLiveAdapter(ticket).read(ticket)
                plan = operator.review(snapshot, ticket)
                current = validate_plan(plan, ticket)
                require(runtime is None or runtime == current, 'RUNTIME_CHANGED_DURING_PREPARE')
                runtime = current
                prepared = {'ticket': ticket, 'mode': 'READ_ONLY', 'bankWrites': False, 'planSha256': operator.digest(plan), 'runtime': current}
                for kind, value in [('plan', plan), ('prepare', prepared)]:
                    path = OUT / f'{kind}-{ticket}.json'
                    write(path, value)
                    files[path.name] = file_sha(path)
                row = {'ticket': ticket, 'state': 'PREPARED', 'bankVerified': False, 'leaseReleased': False}
            else:
                row = apply_one(ticket, plans[ticket], audit, ctx)
        except Exception as error:
            message = str(error)
            safe = isinstance(error, (operator.GuardError, RuntimeError)) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,100}', message)
            row = {'ticket': ticket, 'state': 'STOPPED_NO_AUTOMATIC_RETRY', 'automaticRetry': False,
                   'errorType': type(error).__name__, 'gate': message if safe else 'READ_OR_EXECUTION_FAILED',
                   'leaseMayRemainUntilExpiry': c['mode'] == 'apply'}
            write(OUT / f'failure-{ticket}.json', row)
        rows.append(row)
        print(json.dumps(row), flush=True)
        if c['mode'] == 'apply' and row['state'] != 'VERIFIED':
            break
    ok = len(rows) == len(c['tickets']) and all(r['state'] == ('PREPARED' if c['mode'] == 'prepare' else 'VERIFIED') for r in rows)
    summary = {'version': 1, 'mode': c['mode'], 'workflow': ctx, 'requestedTickets': c['tickets'], 'results': rows,
               'allVerified': ok and c['mode'] == 'apply', 'allPrepared': ok and c['mode'] == 'prepare',
               'codeSha256': code_hashes(), 'runtime': runtime, 'zeevWrites': False, 'lambdaInvoked': False,
               'approvedPrepareRunId': c['approvedPrepareRunId'], 'approvedManifestSha256': c['approvedManifestSha256'],
               'financialDocumentCreations': False, 'automaticRetry': False}
    write(OUT / 'summary.json', summary)
    if c['mode'] == 'prepare':
        manifest = {'version': 1, 'mode': 'prepare', 'workflow': ctx, 'requestedTickets': c['tickets'], 'allPrepared': ok,
                    'codeSha256': code_hashes(), 'runtime': runtime, 'audit': {'runId': AUDIT_RUN, 'sha256': file_sha(AUDIT)},
                    'files': files, 'bankWrites': False, 'zeevWrites': False, 'lambdaInvoked': False}
        write(OUT / 'manifest.json', manifest)
        print(json.dumps({'mode': 'prepare', 'runId': ctx['runId'], 'manifestSha256': file_sha(OUT / 'manifest.json'), 'automaticApply': False}), flush=True)
    return 0 if ok else 2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--emit-workflow-config', action='store_true')
    args = parser.parse_args()
    ctx, config = context(), validate_config(read(CONFIG))
    if args.emit_workflow_config:
        with open(os.environ['GITHUB_OUTPUT'], 'a', encoding='utf-8') as handle:
            handle.write('mode=' + config['mode'] + '\napproved_run=' + config['approvedPrepareRunId'] + '\ncanary_run=' + config['verifiedCanaryRunId'] + '\n')
        return 0
    return execute(config, ctx)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'state': 'STOPPED_NO_AUTOMATIC_RETRY', 'errorType': type(error).__name__}))
        raise SystemExit(2)
