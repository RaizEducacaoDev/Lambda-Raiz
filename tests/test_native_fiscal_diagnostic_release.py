import importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('release',Path(__file__).resolve().parents[1]/'scripts/release-native-fiscal-diagnostic.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def bundle():
    return b'\n'.join([('// '+s+'\nRM_INVALID_FISCAL_NATURE').encode() for s in m.r.SOURCES])+b'\n// src/functions/rm/post/solicitacaoDePagamentoSeguro.ts\nprimary_key_received .saveRecord(\n// src/end.ts\nend'
class ReleaseTests(unittest.TestCase):
    def test_reason_required_in_classifier_and_persistence_message(self):
        m.validate_candidate(bundle())
        for count in [1,2]:
            with self.assertRaises(AssertionError):m.validate_candidate(bundle().replace(b'RM_INVALID_FISCAL_NATURE',b'MISSING',count))
    def test_duplicate_guards_cannot_be_reintroduced(self):
        for query in [b'.consultarDocumento(',b'.consultarRetomada(',b'.buscarMovimentosPorTicket(']:
            with self.assertRaises(AssertionError):m.validate_candidate(bundle().replace(b'primary_key_received',query))
    def test_active_baseline_and_real_change_are_required(self):
        self.assertEqual(m.r.patch(b'before',b'before',bundle()),bundle())
        with self.assertRaises(AssertionError):m.r.patch(b'drift',b'before',bundle())
        with self.assertRaises(AssertionError):m.r.patch(bundle(),bundle(),bundle())
if __name__=='__main__':unittest.main()
