import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('existing_release', Path(__file__).resolve().parents[1] / 'scripts/release-existing-payment.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def bundle():
    return b'\n'.join([
        b'// src/functions/rm/post/pagamentoExistente.ts\nfunction consultarPagamentoExistente( .consultarRetomada( .readReacord(',
        b'// src/functions/rm/post/solicitacaoDePagamentoSeguro.ts\nawait consultarPagamentoExistente( if (existente?.completo) existing_payment_confirmed_readonly if (existente) pgEntrada = existente.pg await repo.concluida( const antesDoEnvio = await rm.consultarRetomada( "creating_checkpoint_started" .confirmarCriacaoPropria( .selarBaseline( .avancarParcelaPropria( .conferirEnvioProprio( .saveRecord( validarFilialBancaria(dado, filial)',
        b'// src/functions/rm/post/pagamentoDiagnosticoSeguro.ts\nRM_INVALID_FISCAL_NATURE',
        b'// src/end.ts\nend'])


class ReleaseTests(unittest.TestCase):
    def test_acknowledgement_must_precede_reservation_and_remain_readonly(self):
        m.validate_candidate(bundle())
        for token in [b'function consultarPagamentoExistente(', b'.readReacord(', b'if (existente?.completo)', b'existing_payment_confirmed_readonly', b'if (existente) pgEntrada = existente.pg']:
            with self.assertRaises((AssertionError, ValueError)):
                m.validate_candidate(bundle().replace(token, b'MISSING'))
        with self.assertRaises(AssertionError):
            m.validate_candidate(bundle().replace(b'function consultarPagamentoExistente(', b'.saveRecord( function consultarPagamentoExistente('))

    def test_preserves_durable_bank_guards_and_rejects_document_adoption(self):
        for token in [b'.confirmarCriacaoPropria(', b'.selarBaseline(', b'.avancarParcelaPropria(', b'.conferirEnvioProprio(', b'validarFilialBancaria(dado, filial)']:
            with self.assertRaises((AssertionError, ValueError)):
                m.validate_candidate(bundle().replace(token, b'MISSING'))
        for token in [b'.consultarDocumento(', b'.buscarMovimentosPorTicket(']:
            with self.assertRaises(AssertionError):
                m.validate_candidate(bundle().replace(b'existing_payment_confirmed_readonly', b'existing_payment_confirmed_readonly ' + token))

    def test_drift_and_unchanged_candidate_cannot_publish(self):
        self.assertEqual(m.r.patch(b'old', b'old', bundle()), bundle())
        with self.assertRaises(AssertionError):
            m.r.patch(b'drift', b'old', bundle())
        with self.assertRaises(AssertionError):
            m.r.patch(bundle(), bundle(), bundle())


if __name__ == '__main__':
    unittest.main()
