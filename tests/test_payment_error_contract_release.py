import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('error_release',Path(__file__).resolve().parents[1]/'scripts/release-payment-error-contract.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def fixture():
    return b'header\n'+b''.join(('// '+name+'\noriginal\n').encode() for name in m.r.SOURCES[1:])+b'// src/frozen.ts\nimmutable\n'

class ErrorContractReleaseTests(unittest.TestCase):
    def test_new_policy_is_allowed_only_inside_reviewed_modules(self):
        before=fixture()
        after=before.replace(b'original',b'changed').replace(b'// src/frozen.ts',('// '+m.NEW_SOURCE+'\nnew policy\n// src/frozen.ts').encode())
        with patch.object(m.r,'BASE_BUNDLE_SHA',m.r.m.sha(before)),patch.object(m,'validate_candidate'):
            self.assertEqual(m.patch(before,before,after),after)
            with self.assertRaises(AssertionError):m.patch(before,before,after.replace(b'immutable',b'changed outside'))
            with self.assertRaises(AssertionError):m.patch(b'other active package',before,after)
            with self.assertRaises(AssertionError):m.patch(before,before,before)

    def test_publication_is_scoped_to_first_push_of_the_exact_branch(self):
        allowed={'GITHUB_EVENT_NAME':'push','GITHUB_REF':'refs/heads/fix/payment-error-contract-baseline-20261105','GITHUB_RUN_ATTEMPT':'1'}
        with patch.object(m.r,'release') as release:
            for key,value in [('GITHUB_EVENT_NAME','workflow_dispatch'),('GITHUB_REF','refs/heads/main'),('GITHUB_RUN_ATTEMPT','2')]:
                with patch.dict(m.os.environ,{**allowed,key:value},clear=True):
                    with self.assertRaises(AssertionError):m.release()
            release.assert_not_called()
            with patch.dict(m.os.environ,allowed,clear=True):m.release()
            release.assert_called_once()

if __name__=='__main__':unittest.main()
