import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('bank_continuation_release', Path(__file__).resolve().parents[1] / 'scripts/release-payment-bank-continuation.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def bundle():
    methods = b'confirmarCriacaoPropria( selarBaseline( avancarParcelaPropria( conferirEnvioProprio('
    calls = b'.confirmarCriacaoPropria( .selarBaseline( .avancarParcelaPropria( .conferirEnvioProprio('
    return b'\n'.join([
        b'// src/functions/rm/post/pagamentoContinuacao.ts\nfunction validarContinuacao( function baselineParcela(',
        b'// src/functions/rm/post/pagamentoV2Idempotencia.ts\n' + methods,
        b'// src/functions/rm/post/solicitacaoDePagamentoSeguro.ts\n' + calls + b' .saveRecord( validarFilialBancaria(dado, filial) primary_key_received .corrigirReserva(',
        b'// src/functions/rm/post/pagamentoDiagnosticoSeguro.ts\nRM_INVALID_FISCAL_NATURE',
        b'// src/functions/rm/post/pagamentoEvidencia.ts\nRM_INVALID_FISCAL_NATURE',
        b'// src/end.ts\nend'])


class ReleaseTests(unittest.TestCase):
    def test_production_handler_must_use_all_durable_checkpoints(self):
        m.validate_candidate(bundle())
        for token in [b'.confirmarCriacaoPropria(', b'.selarBaseline(', b'.avancarParcelaPropria(', b'.conferirEnvioProprio(']:
            with self.assertRaises(AssertionError):
                m.validate_candidate(bundle().replace(token, b'.MISSING('))
        with self.assertRaises(AssertionError):
            m.validate_candidate(bundle().replace(b'.conferirEnvioProprio( .saveRecord(', b'.saveRecord( .conferirEnvioProprio('))

    def test_branch_preflight_and_prior_native_decisions_preserved(self):
        with self.assertRaises(AssertionError):
            m.validate_candidate(bundle().replace(b'validarFilialBancaria(dado, filial)', b'MISSING'))
        for token in [b'.consultarDocumento(', b'.consultarRetomada(', b'.buscarMovimentosPorTicket(']:
            with self.assertRaises(AssertionError):
                m.validate_candidate(bundle().replace(b'primary_key_received', token))
        with self.assertRaises(AssertionError):
            m.validate_candidate(bundle().replace(b'RM_INVALID_FISCAL_NATURE', b'MISSING'))

    def test_active_drift_or_no_change_cannot_publish(self):
        self.assertEqual(m.r.patch(b'old', b'old', bundle()), bundle())
        with self.assertRaises(AssertionError):
            m.r.patch(b'drift', b'old', bundle())
        with self.assertRaises(AssertionError):
            m.r.patch(bundle(), bundle(), bundle())


if __name__ == '__main__':
    unittest.main()
