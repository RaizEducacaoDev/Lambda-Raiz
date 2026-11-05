import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
spec=importlib.util.spec_from_file_location('release',Path(__file__).resolve().parents[1]/'scripts/release-native-errors-restored.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class NativeDiagnosticReleaseTests(unittest.TestCase):
    def test_new_helper_is_permitted_only_inside_reviewed_modules(self):
        before=b'header\n'+b''.join(('// '+s+'\nold\n').encode() for s in m.r.SOURCES if s!=m.NEW_SOURCE)+b'// src/frozen.ts\nfrozen\n'
        after=before.replace(b'old',b'new').replace(b'// src/frozen.ts',('// '+m.NEW_SOURCE+'\nnative helper\n// src/frozen.ts').encode())
        with patch.object(m.r,'BASE_BUNDLE_SHA',m.r.m.sha(before)),patch.object(m,'validate_candidate'):
            self.assertEqual(m.patch(before,before,after),after)
            for active,base,candidate in [(b'drift',before,after),(before,before,before),(before,before,after.replace(b'frozen\n',b'changed\n'))]:
                with self.assertRaises(AssertionError):m.patch(active,base,candidate)

    def test_publication_requires_first_push_of_exact_branch(self):
        env={'GITHUB_EVENT_NAME':'push','GITHUB_REF':m.BRANCH,'GITHUB_RUN_ATTEMPT':'1'}
        with patch.object(m.r,'release') as publish:
            for key,value in [('GITHUB_EVENT_NAME','workflow_dispatch'),('GITHUB_REF','refs/heads/main'),('GITHUB_RUN_ATTEMPT','2')]:
                with patch.dict(m.os.environ,{**env,key:value},clear=True):
                    with self.assertRaises(AssertionError):m.release()
            publish.assert_not_called()
            with patch.dict(m.os.environ,env,clear=True):m.release()
            publish.assert_called_once_with(expected_ref=m.BRANCH)

if __name__=='__main__':unittest.main()
