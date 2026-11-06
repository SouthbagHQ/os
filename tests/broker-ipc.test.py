#!/usr/bin/env python3
"""Host protocol/adversarial tests; real root/customer boundary is guest-only."""
import os,pathlib,socket,subprocess,tempfile,threading,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
SRC=ROOT/'image/config/includes.chroot/opt/southbag-broker-src/southbag-input-client.c'
class IPC(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory();cls.d=pathlib.Path(cls.tmp.name)
  cls.path=str(cls.d/'broker.sock');cls.fixture=cls.d/'broker'
  cls.bin=cls.d/'client';cls.real=cls.d/'real-client'
  for binary,flags in [(cls.bin,['-DSB_TEST']),(cls.real,[])]:
   subprocess.run(['gcc','-Wall','-Wextra','-Werror','-O2',*flags,'-DSOCKET_PATH="'+cls.path+'"','-DBROKER_PATH="'+str(cls.fixture)+'"',str(SRC),'-o',str(binary)],check=True)
  cls.listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);cls.listener.bind(cls.path);cls.listener.listen(8)
  cls.stop=False;cls.children=[]
  def loop():
   while not cls.stop:
    try:c,_=cls.listener.accept()
    except OSError:return
    if cls.stop:c.close();return
    cls.children.append(subprocess.Popen([str(cls.bin),'--serve'],stdin=c,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL));c.close()
  cls.t=threading.Thread(target=loop,daemon=True);cls.t.start()
 @classmethod
 def tearDownClass(cls):
  cls.stop=True;s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.connect(cls.path);s.close();cls.t.join(2);cls.listener.close()
  for p in cls.children:p.wait(timeout=45)
  cls.tmp.cleanup()
 def setUp(self):
  self.fixture.write_text('#!/bin/sh\ncase "$1" in current) echo "generation=7 state=inhibited";; inhibit) [ "$2" = 7 ];; *) exit 1;; esac\n')
 def call(self,*args,binary=None,env=None):
  return subprocess.run([str(binary or self.bin),*args],capture_output=True,timeout=55,env=env)
 def raw(self,b):
  s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(10);s.connect(self.path);s.sendall(b);s.shutdown(socket.SHUT_WR)
  try:return s.recv(1000)
  except ConnectionResetError:return b''
  finally:s.close()
 def test_roundtrip(self):
  r=self.call('current');self.assertEqual(r.returncode,0);self.assertEqual(r.stdout,b'generation=7 state=inhibited\n')
  self.assertEqual(self.call('inhibit','7').returncode,0)
  self.assertNotEqual(self.call('inhibit','8').returncode,0)
 def test_bad_protocol(self):
  for b in [b'',b'current',b'current\nextra',b'current\n\n',b'current\x00\n',b'x'*1000,b'begin-generation\n',b'start\n',b'inhibit 0\n',b'inhibit -1\n',b'inhibit 01\n',b'inhibit 7;id\n',b'inhibit 9999999999999999999\n']:
   with self.subTest(b=b[:50]):self.assertEqual(self.raw(b),b'')
 def test_client_refuses_authority_verbs(self):
  for a in [('begin-generation',),('start',),('authorize-unlock','7'),('inhibit','0'),('inhibit','7\ncurrent')]:
   self.assertEqual(self.call(*a).returncode,2)
 def test_bad_backend_reply(self):
  for body in ['echo "generation=7 state=active"','echo "generation=7 state=inhibited"; echo extra','printf "generation=7 state=inhibited"','echo "generation=007 state=inhibited"','exit 1','yes a | head -c 1000','printf "generation=7 state=inhibited\\n\\0"']:
   self.fixture.write_text('#!/bin/sh\n'+body+'\n');self.assertNotEqual(self.call('current').returncode,0)
  self.fixture.write_text('#!/bin/sh\necho unexpected\n');self.assertNotEqual(self.call('inhibit','7').returncode,0)
 def test_environment_not_forwarded(self):
  self.fixture.write_text('#!/bin/sh\n[ -z "${SOUTHBAG_BROKER_ALLOW_NONROOT+x}" ] && [ -z "${SOUTHBAG_BROKER_SYSTEMCTL+x}" ] || exit 1\necho "generation=7 state=inhibited"\n')
  env={**os.environ,'SOUTHBAG_BROKER_ALLOW_NONROOT':'1','SOUTHBAG_BROKER_SYSTEMCTL':'/evil'}
  self.assertEqual(self.call('current',env=env).returncode,0)
 def test_real_build_rejects_nonroot_server(self):
  if os.getuid()==0:self.skipTest('host test needs nonroot')
  self.assertNotEqual(self.call('current',binary=self.real).returncode,0)
  self.assertNotEqual(self.call('--serve',binary=self.real).returncode,0)
 def test_missing_backend(self):
  self.fixture.unlink();self.assertNotEqual(self.call('current').returncode,0)
 def test_slow_incomplete_client(self):
  s=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);s.settimeout(11);s.connect(self.path);s.sendall(b'current')
  try:self.assertEqual(s.recv(10),b'')
  except ConnectionResetError:pass
  finally:s.close()
if __name__=='__main__':unittest.main(verbosity=2)
