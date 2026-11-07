#!/usr/bin/env python3
import pathlib
import subprocess
import sys
import unittest

RUNNER = pathlib.Path(__file__).resolve().parents[1] / 'scripts/test-child-cleanup.py'


class FixtureCleanup(unittest.TestCase):
    def run_fixture(self, body):
        return subprocess.run([sys.executable, str(RUNNER), sys.executable, '-c', body],
                              capture_output=True, text=True, timeout=15)

    def test_exit_code_is_preserved(self):
        result = self.run_fixture('raise SystemExit(7)')
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertIn('remaining=0', result.stdout)

    def test_detached_descendant_is_cleaned_and_reaped(self):
        result = self.run_fixture('''import os,subprocess,sys
if os.fork() == 0:
 os.setsid()
 subprocess.Popen(['sleep','60'])
 os._exit(0)
''')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('remaining=0', result.stdout)
        self.assertRegex(result.stdout, r'live_killed=[1-9]')

    def test_no_descendants_needs_no_kill(self):
        result = self.run_fixture('pass')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('live_killed=0 remaining=0', result.stdout)


if __name__ == '__main__':
    unittest.main(verbosity=2)
