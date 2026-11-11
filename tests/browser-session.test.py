"""Private OS-to-Browser session export, including live SQLite WAL reads."""
import importlib.machinery
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import time
import unittest

helper = importlib.machinery.SourceFileLoader('browser_session', str(Path(__file__).resolve().parents[1] / 'image/config/includes.chroot/usr/local/bin/southbag-browser-session')).load_module()

class SessionExport(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name)
        self.root = self.state / 'device-session'
        self.root.mkdir(mode=0o700)
        (self.state / 'account').write_text('sub-1\tuser@example.invalid\n')
        self.private('generation', 'era-1')
        self.session = dict(generation='era-1',subject='sub-1',accessToken='token-value-1234567890',expiresAt=time.time()*1000+3600000)
        self.private('browser-session.json',json.dumps(self.session))
        self.db = sqlite3.connect(self.root / 'identity-cookies.sqlite')
        os.chmod(self.root / 'identity-cookies.sqlite', 0o600)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE moz_cookies (name TEXT,value TEXT,host TEXT,path TEXT,expiry INTEGER,isSecure INTEGER,isHttpOnly INTEGER)')
        self.add_cookie('__Secure-better-auth.session_token','secret','.southbag.cc')
    def tearDown(self):
        self.db.close()
        self.temp.cleanup()
    def private(self,name,text):
        (self.root / name).write_text(text)
        (self.root / name).chmod(0o600)
    def add_cookie(self,name,value,host):
        self.db.execute('INSERT INTO moz_cookies VALUES (?,?,?,?,?,?,?)',(name,value,host,'/',int(time.time()+3600),1,1));self.db.commit()
    def test_exports_only_identity_session_cookie_and_private_generation(self):
        self.add_cookie('unrelated','no','.southbag.cc')
        self.add_cookie('__Secure-better-auth.session_token','no','.example.com')
        helper.prepare(self.root)
        file=self.root/'browser-handoff.json'
        value=json.loads(file.read_text())
        self.assertEqual(value['generation'],'era-1')
        self.assertEqual([c['value'] for c in value['cookies']],['secret'])
        self.assertEqual(file.stat().st_mode & 0o777,0o600)
    def test_rejects_retired_generation_subject_and_expiry(self):
        for patch in [dict(generation='old'),dict(subject='other'),dict(expiresAt=0)]:
            self.private('browser-session.json',json.dumps({**self.session,**patch}))
            with self.assertRaises(ValueError):helper.prepare(self.root)
            self.assertFalse((self.root/'browser-handoff.json').exists())
    def test_rejects_public_or_symlink_credentials(self):
        file=self.root/'browser-session.json';file.chmod(0o644)
        with self.assertRaises(ValueError):helper.prepare(self.root)
        file.rename(self.root/'other');file.symlink_to('other')
        with self.assertRaises(OSError):helper.prepare(self.root)
    def test_requires_identity_cookie(self):
        self.db.execute('DELETE FROM moz_cookies');self.db.commit()
        with self.assertRaisesRegex(ValueError,'cookie unavailable'):helper.prepare(self.root)

if __name__=='__main__':unittest.main()
