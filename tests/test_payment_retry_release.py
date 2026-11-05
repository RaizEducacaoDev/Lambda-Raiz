"""Exercise the actual publication recovery block with a lost AWS acknowledgement."""
import ast
from pathlib import Path
import types
import unittest


class LostAcknowledgement(unittest.TestCase):
    def run_case(self, drift=False):
        tree = ast.parse(Path('scripts/deploy-pagamento-retomada.py').read_text())
        block = next(node for node in tree.body if isinstance(node, ast.Try) and
                     'update-function-code' in ast.unparse(node.body[0]))
        code = compile(ast.fix_missing_locations(ast.Module(body=[block], type_ignores=[])), '<publication-block>', 'exec')
        calls, written = [], {}
        state = {'CodeSha256': 'baseline', 'RevisionId': 'original', 'LastUpdateStatus': 'Successful'}

        def aws(*args):
            calls.append(args)
            if args[:2] == ('lambda', 'update-function-code'):
                if state['RevisionId'] == 'original':
                    state.update(CodeSha256='other' if drift else 'candidate', RevisionId='accepted', LastUpdateStatus='InProgress')
                    raise TimeoutError('response lost after AWS accepted the update')
                self.assertEqual(args[args.index('--revision-id') + 1], 'accepted')
                state.update(CodeSha256='baseline', RevisionId='restored', LastUpdateStatus='Successful')
                return {}
            self.assertEqual(args[:2], ('lambda', 'get-function-configuration'))
            return dict(state)

        def wait(*args, **kwargs):
            state['LastUpdateStatus'] = 'Successful'

        env = {'aws': aws, 'FUNCTION': 'one-payment-function', 'REVISION': 'original',
               'candidate': Path('candidate.zip'), 'backup': Path('backup.zip'),
               'candidate_sha': 'candidate', 'BASELINE': 'baseline', 'now': lambda: 'fixture',
               'subprocess': types.SimpleNamespace(run=wait), 'write': lambda name, data: written.update({name: dict(data)})}
        with self.assertRaises(RuntimeError):
            exec(code, env)
        failure = written['failed-release.json']
        updates = [call for call in calls if call[:2] == ('lambda', 'update-function-code')]
        self.assertEqual(len(updates), 1 if drift else 2)
        self.assertEqual(failure['rollbackAttempted'], not drift)
        if not drift:
            self.assertTrue(failure['rollbackConfirmed'])
        return state

    def test_accepted_update_with_lost_response_is_guardedly_rolled_back(self):
        self.assertEqual(self.run_case()['CodeSha256'], 'baseline')

    def test_intervening_operator_publication_is_preserved(self):
        self.assertEqual(self.run_case(drift=True)['CodeSha256'], 'other')


if __name__ == '__main__':
    unittest.main()
