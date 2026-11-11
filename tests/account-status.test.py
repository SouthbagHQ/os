import importlib.machinery
import json
import os
from pathlib import Path
import tempfile
import subprocess
import shutil
import threading
import time
import unittest
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

helper = importlib.machinery.SourceFileLoader('status',str(Path(__file__).resolve().parents[1]/'image/config/includes.chroot/usr/local/bin/southbag-account-status')).load_module()
class Handler(BaseHTTPRequestHandler):
    data = {'sub':'owner','frozen':False}
    code = 200
    seen = []
    agents = []
    def do_GET(self):
        self.seen.append((self.path,self.headers.get('Authorization')))
        self.agents.append(self.headers.get('User-Agent'))
        self.send_response(self.code)
        if self.code == 302:self.send_header('Location','http://127.0.0.1:1/stolen')
        self.end_headers()
        self.wfile.write(json.dumps(self.data).encode())
    def log_message(self,*args):pass
class Check(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start()
        os.environ['SOUTHBAG_IDENTITY_ORIGIN']='http://127.0.0.1:'+str(cls.server.server_port)
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.state=Path(self.temp.name);self.root=self.state/'device-session';self.root.mkdir(mode=0o700)
        self.session={'subject':'owner','generation':'one','accessToken':'qualification.token-only-12345','expiresAt':int((time.time()+300)*1000)}
        self.put(self.root/'generation','one');self.put(self.state/'account','owner\temail\n');self.save()
        Handler.data={'sub':'owner','frozen':False};Handler.code=200;Handler.seen=[];Handler.agents=[]
    def tearDown(self):self.temp.cleanup()
    def put(self,p,s):p.write_text(s);p.chmod(0o600)
    def save(self):self.put(self.root/'browser-session.json',json.dumps(self.session))
    def test_active_and_fresh_freeze(self):
        helper.check(self.root);Handler.data['frozen']=True
        with self.assertRaises(Exception):helper.check(self.root)
        Handler.data['frozen']=False;helper.check(self.root)
        self.assertEqual(Handler.seen,[('/api/account/status','Bearer qualification.token-only-12345')]*3)
        self.assertEqual(Handler.agents,['SouthbagOS/1.0 account-status']*3)
    def test_response_fail_closed(self):
        for data in [{},{'sub':'other','frozen':False},{'sub':'owner','frozen':0},{'sub':'owner','frozen':'false'},{'sub':'owner','frozen':None}]:
            Handler.data=data
            with self.assertRaises(Exception):helper.check(self.root)
        for code in [401,403,500,302]:
            Handler.code=code
            with self.assertRaises(Exception):helper.check(self.root)
    def test_expired_mismatched_or_unsafe_private_state(self):
        for change in [{'expiresAt':0},{'generation':'retired'},{'subject':'other'},{'accessToken':'bad\r\nInjected: yes'},{'expiresAt':True}]:
            original=self.session.copy();self.session.update(change);self.save()
            with self.assertRaises(Exception):helper.check(self.root)
            self.session=original
        self.save();p=self.root/'browser-session.json';p.chmod(0o644)
        with self.assertRaises(Exception):helper.check(self.root)
        p.unlink();p.symlink_to(self.state/'account')
        with self.assertRaises(Exception):helper.check(self.root)
        self.assertEqual(Handler.seen,[])
    def test_real_status_helper_drives_managed_session_reset(self):
        repo=Path(__file__).resolve().parents[1]
        base=self.state/'fixture';base.mkdir();systemd=base/'systemd';systemd.mkdir();cg=base/'cgroup';cg.mkdir()
        for name in ['systemctl','systemd-run']:
            shutil.copy(repo/'tests/fixtures/bin'/name,base/name);(base/name).chmod(0o755)
        env={**os.environ,'SOUTHBAG_STATE_DIR':str(self.state),'SOUTHBAG_ACCOUNT_STATUS_BIN':helper.__file__,
             'SOUTHBAG_DEVICE_SYSTEMD_RUN':str(base/'systemd-run'),'SOUTHBAG_DEVICE_SYSTEMCTL':str(base/'systemctl'),
             'SOUTHBAG_DEVICE_CGROUP_ROOT':str(cg),'FAKE_SYSTEMD_STATE':str(systemd),
             'SOUTHBAG_DEVICE_DENIAL_LOCK':'/bin/true','SOUTHBAG_DEVICE_SEAT_STOP':'/bin/true','SOUTHBAG_DEVICE_LOCK_STOP':'/bin/true'}
        manager=repo/'image/config/includes.chroot/usr/local/bin/southbag-device-session'
        def run(*args):
            return subprocess.run(['sh',str(manager),*args],env=env,capture_output=True,timeout=20)
        profile=self.root/'browser';profile.mkdir();(profile/'cookie').write_text('synthetic')
        try:
            self.assertEqual(run('launch','settings','sleep','30').returncode,0)
            Handler.data['frozen']=True
            self.assertNotEqual(run('launch','settings','sleep','30').returncode,0)
            result=run('check');self.assertEqual(result.returncode,0,result.stderr)
            for path in [self.state/'account',self.root/'generation',self.root/'browser-session.json',profile]:self.assertFalse(path.exists(),str(path))
            self.assertTrue((self.state/'access-notice').exists())
        finally:
            # Always retire any synthetic scope if an assertion failed before teardown.
            run('reset','one')
if __name__=='__main__':unittest.main()
