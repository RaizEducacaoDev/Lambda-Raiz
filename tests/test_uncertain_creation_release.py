import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('removal', Path(__file__).resolve().parents[1] / 'scripts/release-uncertain-creation-removal.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def bundle(values=(b'old_a', b'old_b'), unrelated=b'active_dependency'):
    return unrelated + b'\n' + b'\n'.join(
        m.MARKERS[source] + value for source, value in zip(m.SOURCES, values)
    ) + b'\n// src/entry.ts\nuntouched_entry'


class ReleaseTests(unittest.TestCase):
    def test_only_reviewed_modules_change_in_active_package(self):
        before, after = bundle(), bundle((b'new_a', b'new_b'))
        active = bundle(unrelated=b'different_production_dependency')
        self.assertEqual(m.patch(active, before, after), bundle((b'new_a', b'new_b'), b'different_production_dependency'))

    def test_active_module_drift_blocks_publication(self):
        with self.assertRaises(AssertionError):
            m.patch(bundle((b'unreviewed_a', b'old_b')), bundle(), bundle((b'new_a', b'new_b')))

    def test_unrelated_source_build_drift_blocks_publication(self):
        with self.assertRaises(AssertionError):
            m.patch(bundle(), bundle(), bundle((b'new_a', b'new_b'), b'changed_dependency'))

    def test_duplicate_module_boundary_blocks_publication(self):
        with self.assertRaises(AssertionError):
            m.patch(bundle() + bundle(), bundle(), bundle((b'new_a', b'new_b')))

    def test_missing_module_boundary_blocks_publication(self):
        with self.assertRaises(AssertionError):
            m.patch(b'invalid_active_bundle', bundle(), bundle((b'new_a', b'new_b')))


if __name__ == '__main__':
    unittest.main()
