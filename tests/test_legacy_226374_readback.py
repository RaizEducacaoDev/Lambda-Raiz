"""Independent readback checks with local fakes only."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

fixtures = load('legacy_fixtures', ROOT / 'tests/test_legacy_226374_recovery.py')
readback = load('legacy_readback', ROOT / 'scripts/readback-legacy-226374.py')

class ReadbackTests(unittest.TestCase):
    def prepared(self):
        fake = fixtures.Fake()
        evidence = fixtures.run(fake, apply=True, authorized=True)
        fake.writes.clear()
        return fake, evidence

    def test_confirms_native_and_archive_without_any_write(self):
        fake, evidence = self.prepared()
        result = readback.verify(evidence, fake)
        self.assertTrue(result['verified'])
        self.assertEqual(result['state'], 'RESERVED')
        self.assertEqual(fake.writes, [])

    def test_progressed_reservation_never_claims_ready(self):
        fake, evidence = self.prepared()
        fake.items[fixtures.m.PK]['state'] = {'S': 'CREATING'}
        with self.assertRaises(readback.m.GateError):
            readback.verify(evidence, fake)
        self.assertEqual(fake.writes, [])

    def test_missing_history_or_different_native_evidence_blocks_confirmation(self):
        for kind in ('archive', 'native'):
            with self.subTest(kind=kind):
                fake, evidence = self.prepared()
                if kind == 'archive':
                    fake.items[evidence['evidenceKey']]['manifestJson'] = {'S': 'different'}
                else:
                    original = fake.observe
                    def changed():
                        value = original()
                        value['bank']['IDPGTO'] = '4'
                        return value
                    fake.observe = changed
                with self.assertRaises(readback.m.GateError):
                    readback.verify(evidence, fake)
                self.assertEqual(fake.writes, [])

if __name__ == '__main__':
    unittest.main()
