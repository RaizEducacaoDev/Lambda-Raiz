import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('bank_branch_release', Path(__file__).resolve().parents[1] / 'scripts/release-payment-bank-branch.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def bundle():
    return b'\n'.join([
        b'// src/functions/rm/post/pagamentoIdentidade.ts\nfunction validarFilialBancaria( dado.CODFILIAL Number(cadastrada) > 0 Number(cadastrada) !== Number(filial)',
        b'// src/functions/rm/post/solicitacaoDePagamentoSeguro.ts\nvalidarFilialBancaria(dado, filial) .reservar( primary_key_received .saveRecord(',
        b'// src/functions/rm/post/pagamentoDiagnosticoSeguro.ts\nRM_INVALID_FISCAL_NATURE',
        b'// src/functions/rm/post/pagamentoEvidencia.ts\nRM_INVALID_FISCAL_NATURE',
        b'// src/end.ts\nend'])


class ReleaseTests(unittest.TestCase):
    def test_branch_guard_and_call_before_reservation_required(self):
        m.validate_candidate(bundle())
        for token in [b'function validarFilialBancaria(', b'dado.CODFILIAL',
                      b'Number(cadastrada) > 0', b'Number(cadastrada) !== Number(filial)',
                      b'validarFilialBancaria(dado, filial)']:
            with self.assertRaises(AssertionError):
                m.validate_candidate(bundle().replace(token, b'MISSING'))
        with self.assertRaises(AssertionError):
            m.validate_candidate(bundle().replace(b'validarFilialBancaria(dado, filial) .reservar(',
                                                b'.reservar( validarFilialBancaria(dado, filial)'))

    def test_prior_runtime_decisions_and_fiscal_reason_preserved(self):
        for token in [b'.consultarDocumento(', b'.consultarRetomada(', b'.buscarMovimentosPorTicket(']:
            with self.assertRaises(AssertionError):
                m.validate_candidate(bundle().replace(b'primary_key_received', token))
        for count in [1, 2]:
            with self.assertRaises(AssertionError):
                m.validate_candidate(bundle().replace(b'RM_INVALID_FISCAL_NATURE', b'MISSING', count))

    def test_active_drift_or_no_change_cannot_publish(self):
        self.assertEqual(m.r.patch(b'old', b'old', bundle()), bundle())
        with self.assertRaises(AssertionError):
            m.r.patch(b'drift', b'old', bundle())
        with self.assertRaises(AssertionError):
            m.r.patch(bundle(), bundle(), bundle())


if __name__ == '__main__':
    unittest.main()
