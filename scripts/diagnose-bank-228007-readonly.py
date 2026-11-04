"""AWS metadata, native schema and ReadRecord only. Never retries a bank write."""
import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
FUNCTION = 'lambda-raiz-prod-solicitacaoDePagamento'
CODE = 'U8MIHNjNZ2iEeyt02SWx4q5TztrmrcpehRqBlf86OY8='
REVISION = 'd6c03245-d62e-4ef2-834b-22dbada25c1b'
HOST = 'https://raizeducacao160286.rm.cloudtotvs.com.br:8051'
OUT = Path('.bank-228007-readonly-diagnosis')
XS = '{http://www.w3.org/2001/XMLSchema}'
spec = importlib.util.spec_from_file_location('bank_context_readonly', ROOT / 'scripts/deploy-payment-systemic.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def soap(operation, values, auth):
    assert operation in ['GetSchema', 'ReadRecord']
    envelope = ET.Element('{http://schemas.xmlsoap.org/soap/envelope/}Envelope')
    body = ET.SubElement(envelope, '{http://schemas.xmlsoap.org/soap/envelope/}Body')
    op = ET.SubElement(body, operation, xmlns='http://www.totvs.com/')
    for key, value in values.items():
        ET.SubElement(op, key).text = value
    request = urllib.request.Request(HOST + '/wsDataServer/IwsDataServer', data=ET.tostring(envelope), headers={
        'Authorization': auth, 'Content-Type': 'text/xml;charset=UTF-8', 'SOAPAction': 'http://www.totvs.com/IwsDataServer/' + operation})
    with urllib.request.urlopen(request, timeout=15) as response:
        raw = response.read(8000000)
    root = ET.fromstring(raw)
    assert not any(n.tag.endswith('Fault') for n in root.iter()), 'SOAP_FAULT'
    result = root.find('.//{http://www.totvs.com/}' + operation + 'Result')
    assert result is not None and result.text, 'SOAP_RESULT_MISSING'
    return result.text


def schema_summary(raw):
    root = ET.fromstring(raw)
    fields = []
    for table in root.iter(XS + 'element'):
        if table.get('name') != 'FLAN':
            continue
        sequence = table.find(XS + 'complexType/' + XS + 'sequence')
        if sequence is None:
            continue
        for col in sequence.findall(XS + 'element'):
            restrictions = col.findall('.//' + XS + 'maxLength')
            fields.append({'name': col.get('name'), 'type': col.get('type'), 'minOccurs': col.get('minOccurs', '1'),
                'maxLength': restrictions[0].get('value') if restrictions else None,
                'metadata': {k.rsplit('}', 1)[-1]: v for k, v in col.attrib.items() if k.rsplit('}', 1)[-1] in ['AllowDBNull', 'ReadOnly', 'AutoIncrement']}})
    return {'schemaSha256': hashlib.sha256(raw.encode()).hexdigest(), 'fieldCount': len(fields),
            'requiredByXsdMinOccurs': [f['name'] for f in fields if f['minOccurs'] != '0'],
            'bankAndIdentityFields': [f for f in fields if f['name'] in ['CODCOLIGADA', 'IDLAN', 'CODCOLPGTO', 'IDPGTO',
                'CODCOLCFO', 'CODCFO', 'CODFILIAL', 'NUMERODOCUMENTO', 'VALORORIGINAL', 'DATAVENCIMENTO']],
            'note': 'XSD occurrence alone does not prove which fields SaveRecord requires for an update.'}


def record_summary(raw, company, lan):
    root = ET.fromstring(raw)
    rows = [n for n in root if n.tag.rsplit('}', 1)[-1] == 'FLAN']
    assert len(rows) == 1
    row = {n.tag.rsplit('}', 1)[-1]: n.text or '' for n in rows[0]}
    assert row['CODCOLIGADA'] == str(company) and row['IDLAN'] == str(lan)
    fields = ['CODCOLIGADA', 'IDLAN', 'IDMOV', 'CODCOLCFO', 'CODCFO', 'CODFILIAL', 'IDPGTO', 'CODCOLPGTO', 'STATUSLAN']
    return {'company': company, 'idlan': lan, 'dataset': root.tag, 'projectedRecordSha256': hashlib.sha256(m.canonical({k: row.get(k) for k in fields}).encode()).hexdigest(),
            'presentFields': {k: bool(row.get(k)) for k in fields}, 'status': row.get('STATUSLAN'),
            'paymentIdPresent': row.get('IDPGTO', '') not in ['', '0'], 'paymentCompanyPresent': row.get('CODCOLPGTO', '') not in ['', '0'],
            'rawRecordSha256': hashlib.sha256(raw.encode()).hexdigest()}


def main():
    assert m.aws('sts', 'get-caller-identity')['Account'] == m.ACCOUNT
    cfg = m.aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
    assert cfg['CodeSha256'] == CODE and cfg['RevisionId'] == REVISION and cfg['State'] == 'Active' and cfg['LastUpdateStatus'] == 'Successful'
    env = cfg['Environment']['Variables']
    assert env['STAGE'] == 'prod' and env['RM_PROD'].rstrip('/') == HOST.replace(':8051', '')
    username = env['USERNAME_TOTVS']
    auth = 'Basic ' + base64.b64encode((username + ':' + env['PASSWORD_TOTVS']).encode()).decode()
    result = {'readOnly': True, 'codeSha256': CODE, 'revisionId': REVISION,
              'usernameExactlyEqualsRuntimeBusinessUser': username == 'p_heflo',
              'usernameCaseInsensitiveEqualsRuntimeBusinessUser': username.casefold() == 'p_heflo',
              'contextKeyValuesIdentical': username == 'p_heflo', 'writePermissionNotTested': True,
              'schemas': [], 'records': [], 'financialWrites': False, 'dynamoWrites': False, 'lambdaInvoked': False}
    print(json.dumps({k: result[k] for k in ['usernameExactlyEqualsRuntimeBusinessUser', 'usernameCaseInsensitiveEqualsRuntimeBusinessUser', 'contextKeyValuesIdentical']}), flush=True)
    contexts = [('runtime', 'p_heflo')]
    if username != 'p_heflo':
        contexts.append(('operator', username))
    for label, user in contexts:
        try:
            raw = soap('GetSchema', {'DataServerName': 'FinLanDataBR', 'Contexto': f'CODSISTEMA=F;CODCOLIGADA=5;CODUSUARIO={user}'}, auth)
            result['schemas'].append({'context': label, 'readAccepted': True, **schema_summary(raw)})
        except Exception as error:
            result['schemas'].append({'context': label, 'readAccepted': False, 'errorType': type(error).__name__, 'httpStatus': error.code if isinstance(error, urllib.error.HTTPError) else None})
        for company, lan in [(5, 634500), (31, 468)]:
            try:
                raw = soap('ReadRecord', {'DataServerName': 'FinLanDataBR', 'PrimaryKey': f'{company};{lan}',
                    'Contexto': f'CODSISTEMA=F;CODCOLIGADA={company};CODUSUARIO={user}'}, auth)
                result['records'].append({'context': label, 'readAccepted': True, **record_summary(raw, company, lan)})
            except Exception as error:
                result['records'].append({'context': label, 'company': company, 'idlan': lan, 'readAccepted': False, 'errorType': type(error).__name__})
    bank_source = (ROOT / 'src/functions/rm/post/solicitacaoDePagamentoBancario.ts').read_text()
    fragment = bank_source.split('export const montarCamposDadoPagamento', 1)[1].split('];', 1)[0]
    runtime_fields = ['CODCOLIGADA', 'IDLAN'] + re.findall(r"\['([A-Z0-9]+)'", fragment)
    spec_op = importlib.util.spec_from_file_location('readonly_bank_shape', ROOT / 'scripts/repair-payment-bank-backlog.py')
    op = importlib.util.module_from_spec(spec_op)
    sys.modules[spec_op.name] = op
    spec_op.loader.exec_module(op)
    xml = ET.fromstring(op.xml_for(228007, {'IDPGTO': '1', 'CODCOLPGTO': '5'}))
    operator_fields = [n.tag for n in xml.find('FLAN')]
    result['xmlComparison'] = {'dataset': xml.tag, 'runtimeFieldsFromReviewedSource': runtime_fields, 'operatorFields': operator_fields,
                              'missingFromOperator': sorted(set(runtime_fields) - set(operator_fields)), 'noXmlSubmitted': True}
    final = m.aws('lambda', 'get-function-configuration', '--function-name', FUNCTION)
    assert final['CodeSha256'] == CODE and final['RevisionId'] == REVISION
    OUT.mkdir(exist_ok=True)
    (OUT / 'diagnosis.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        OUT.mkdir(exist_ok=True)
        (OUT / 'failure.json').write_text(json.dumps({'readOnly': True, 'errorType': type(error).__name__}), encoding='utf-8')
        raise SystemExit('Read-only bank diagnosis stopped; inspect sanitized evidence') from None
