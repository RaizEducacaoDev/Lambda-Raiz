import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('native_release',Path(__file__).resolve().parents[1]/'scripts/release-native-duplication.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def bundle(service=b'.saveRecord( primary_key_received .corrigirReserva( resumirMensagemNegocioRm(retorno)',evidence=b'native message'):
    bodies=[b'sanitized summary',evidence,b'reservation history',service]
    return b'prefix\n'+b'\n'.join(('// '+name+'\n').encode()+body for name,body in zip(m.SOURCES,bodies))+b'\n// src/entry.ts\nentry'


class NativeReleaseTests(unittest.TestCase):
    def test_full_active_baseline_required(self):
        before=b'old reviewed wrapper'
        self.assertEqual(m.patch(before,before,bundle()),bundle())
        with self.assertRaises(AssertionError):m.patch(b'unreviewed active wrapper',before,bundle())

    def test_duplicate_queries_cannot_return_to_service(self):
        for query in [b'.consultarDocumento(',b'.consultarRetomada(',b'.buscarMovimentosPorTicket(']:
            with self.assertRaises(AssertionError):m.validate_candidate(bundle(service=query))

    def test_primary_key_confirmation_and_sanitizer_remain_required(self):
        good=b'.saveRecord( primary_key_received .corrigirReserva( resumirMensagemNegocioRm(retorno)'
        for required in [b'.saveRecord(',b'primary_key_received',b'.corrigirReserva(',b'resumirMensagemNegocioRm(retorno)']:
            with self.assertRaises(AssertionError):m.validate_candidate(bundle(service=good.replace(required,b'')))

    def test_outdated_prohibition_message_cannot_return(self):
        with self.assertRaises(AssertionError):m.validate_candidate(bundle(evidence=b'nao autoriza uma nova criacao'))

    def test_module_parser_includes_split_imports_and_body(self):
        marker=('// '+m.SOURCES[0]+'\n').encode()
        data=marker+b'imports\n// src/other.ts\nother\n'+marker+b'body\n// src/end.ts\nend'
        result=m.module(data,m.SOURCES[0])
        self.assertIn(b'imports',result);self.assertIn(b'body',result);self.assertNotIn(b'other.ts',result)

    def test_unchanged_candidate_and_missing_boundaries_are_rejected(self):
        with self.assertRaises(AssertionError):m.patch(bundle(),bundle(),bundle())
        with self.assertRaises(AssertionError):m.validate_candidate(b'invalid')


if __name__=='__main__':unittest.main()
