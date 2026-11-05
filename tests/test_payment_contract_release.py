"""Offline checks for scope, drift, duplicate boundaries and publication gates."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('contract_release', Path(__file__).resolve().parents[1] / 'scripts/release-payment-contract-incident.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


def fixture():
    return b'header\n' + b''.join((('// ' + name + '\n').encode() + b'original\n') * m.MODULE_COUNTS[name] for name in m.SOURCES) + b'// src/frozen.ts\nimmutable\n'


class ScopedPublicationTests(unittest.TestCase):
    def test_rejects_active_drift_and_unchanged_candidate(self):
        old = fixture()
        new = old.replace(b'original', b'changed')
        with patch.object(m, 'BASE_BUNDLE_SHA', m.m.sha(old)), patch.object(m, 'validate_candidate'):
            self.assertEqual(m.patch(old, old, new), new)
            with self.assertRaises(AssertionError):
                m.patch(b'other active package', old, new)
            with self.assertRaises(AssertionError):
                m.patch(old, old, old)
        with self.assertRaises(AssertionError):
            m.patch(old, old, new)

    def test_rejects_unreviewed_module_or_preamble_changes(self):
        old = fixture()
        with patch.object(m, 'BASE_BUNDLE_SHA', m.m.sha(old)), patch.object(m, 'validate_candidate'):
            for new in [old.replace(b'immutable', b'changed'), old.replace(b'header', b'changed')]:
                with self.assertRaises(AssertionError):
                    m.patch(old, old, new)

    def test_rejects_missing_and_ambiguous_module_boundaries(self):
        old = fixture()
        with self.assertRaises(AssertionError):
            m.chunks(old.replace(m.SOURCES[0].encode(), b'src/other.ts'))
        with self.assertRaises(AssertionError):
            m.chunks(old + ('// ' + m.SOURCES[0] + '\nagain\n').encode())

    def test_configuration_ownership_includes_environment_and_role(self):
        cfg = {'Environment': {'Variables': {'SECRET': 'not printed'}}, 'Role': 'role1'}
        original = m.configuration_hash(cfg)
        self.assertNotEqual(original, m.configuration_hash({**cfg, 'Role': 'role2'}))
        self.assertNotEqual(original, m.configuration_hash({**cfg, 'Environment': {'Variables': {}}}))
        self.assertEqual(original, m.configuration_hash({**cfg, 'RevisionId': 'changed only code revision'}))

    def test_publication_requires_exact_branch_first_push_attempt(self):
        allowed = {'GITHUB_EVENT_NAME': 'push',
                   'GITHUB_REF': 'refs/heads/fix/payment-contract-incident-20261105',
                   'GITHUB_RUN_ATTEMPT': '1'}
        with patch.object(m.m, 'active', side_effect=RuntimeError('reached read-only inspection')) as active:
            for key, value in [('GITHUB_EVENT_NAME', 'workflow_dispatch'), ('GITHUB_REF', 'refs/heads/main'), ('GITHUB_RUN_ATTEMPT', '2')]:
                with patch.dict(m.os.environ, {**allowed, key: value}, clear=True):
                    with self.assertRaises(AssertionError):
                        m.release()
            active.assert_not_called()
            with patch.dict(m.os.environ, allowed, clear=True):
                with self.assertRaisesRegex(RuntimeError, 'read-only inspection'):
                    m.release()
            active.assert_called_once()


if __name__ == '__main__':
    unittest.main()
