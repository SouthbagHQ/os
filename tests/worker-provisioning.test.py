#!/usr/bin/env python3
import pathlib,subprocess,tempfile,unittest,re,os,json
ROOT=pathlib.Path(__file__).resolve().parents[1]
class DarkProvisioning(unittest.TestCase):
 def test_unit_is_canonical_and_hard_denied(self):
  s=(ROOT/'image/config/includes.chroot/etc/systemd/system/southbag-espanso.service').read_text()
  for line in ['User=southbag-inject','Group=southbag-inject','ExecCondition=/bin/false','Restart=no','DevicePolicy=closed','KillMode=control-group','CapabilityBoundingSet=','AmbientCapabilities=','Environment=ESPANSO_RUNTIME_DIR=/var/lib/southbag-inject','Environment=ESPANSO_PACKAGE_DIR=/etc/southbag/espanso/packages','UnsetEnvironment=WAYLAND_DISPLAY DISPLAY DBUS_SESSION_BUS_ADDRESS XDG_RUNTIME_DIR']:
   self.assertIn(line,s.splitlines())
  self.assertNotIn('DeviceAllow=',s)
  self.assertNotIn('[Install]',[x for x in s.splitlines() if not x.startswith('#')]);self.assertNotIn('SupplementaryGroups=',s)
  self.assertNotIn('southbag-inject.service',(ROOT/'image/config/includes.chroot/usr/local/sbin/southbag-input-broker').read_text())
  self.assertIn('southbag-espanso.service',(ROOT/'image/config/includes.chroot/usr/local/sbin/southbag-input-broker').read_text())
 def test_identity_has_no_device_or_enable_grant(self):
  p=ROOT/'image/config/hooks/normal/0012-inject-user.hook.chroot';s=p.read_text()
  code='\n'.join(x for x in s.splitlines() if not x.startswith('#'))
  self.assertIn('--shell /usr/sbin/nologin',code)
  for bad in ['chmod','chgrp','setfacl','usermod','systemctl','modprobe']:
   self.assertNotIn(bad,code)
  self.assertIn('id -Gn southbag-inject',code)
 def test_empty_rules_and_no_image_worker_activation(self):
  self.assertIn('matches: []',(ROOT/'image/config/includes.chroot/etc/southbag/espanso/match/base.yml').read_text())
  for p in (ROOT/'image/config/hooks').rglob('*'):
   if p.is_file():
    s=p.read_text()
    for bad in ['enable southbag-espanso','start southbag-espanso','enable southbag-inject','start southbag-inject']:
     self.assertNotIn(bad,s,str(p))
 def test_unknown_binary_fails_before_package(self):
  with tempfile.TemporaryDirectory() as d:
   p=pathlib.Path(d);(p/'bad').write_text('not a worker')
   r=subprocess.run(['bash',str(ROOT/'packaging/build-inject-deb.sh'),str(p/'bad'),str(p/'bad'),str(p/'out')],capture_output=True)
   self.assertNotEqual(r.returncode,0);self.assertFalse((p/'out').exists())
 def test_source_and_binary_gates_stay_independent(self):
  package=(ROOT/'packaging/build-inject-deb.sh').read_text()
  native=(ROOT/'packaging/build-inject-source.sh').read_text()
  reconstruct=(ROOT/'packaging/reconstruct-inject-source.py').read_text()
  source_hash='28fc76302b6cb7f752d6a5f33fda33f04d81a3c7e880305b7d3dff4a493c22be'
  for text in [package,native,reconstruct]:self.assertIn(source_hash,text)
  self.assertIn('96da5411cc1b20a3b46fe7de277aa3b047d182694b006720f358a341db11aeef',package)
  patch=(ROOT/'packaging/espanso-inject-only.patch').read_text()
  self.assertNotIn('diff --git a/.cargo/',patch)
  for path in ['/tmp/gccwrap','/tmp/sysroot','BUILD-STATE.md','PROVENANCE.md']:
   self.assertNotIn(path,patch)
  workflow=(ROOT/'.github/workflows/inject-candidate.yml').read_text()
  self.assertIn('contents: read',workflow)
  for bad in ['systemctl start','systemctl enable','espanso worker','build-repo.sh','secrets.']:
   self.assertNotIn(bad,workflow)
 def test_existing_identity_posture_adversaries(self):
  # Run the actual hook with inert NSS/identity adapters. No real account,
  # file ownership or device changes occur in this host test.
  good={'uid':101,'gid':102,'customer_uid':1000,'customer_gid':1000,
        'home':'/var/lib/southbag-inject','shell':'/usr/sbin/nologin',
        'groups':'southbag-inject'}
  fixtures=[('valid',{},True),('root_uid',{'uid':0},False),
    ('customer_uid',{'uid':1000},False),('shared_low_uid',{'customer_uid':101},False),('ordinary_uid',{'uid':2000},False),
    ('root_gid',{'gid':0},False),('ordinary_gid',{'gid':2000},False),
    ('customer_gid',{'customer_gid':102},False),
    ('interactive_shell',{'shell':'/bin/bash'},False),
    ('customer_home',{'home':'/home/customer'},False),
    ('input_group',{'groups':'southbag-inject input'},False),
    ('seat_group',{'groups':'southbag-inject seat'},False),
    ('missing_customer',{'missing_customer':True},False)]
  adapter=r"""#!/usr/bin/env python3
import os,sys,json,pathlib
f=json.loads(os.environ['IDENTITY_FIXTURE']);name=pathlib.Path(sys.argv[0]).name
if name=='getent':
 print('southbag-inject:x:%d:%d::%s:%s'%(f['uid'],f['gid'],f['home'],f['shell']))
elif name=='id':
 if f.get('missing_customer') and sys.argv[-1]=='customer':raise SystemExit(1)
 key={'-u':'uid','-g':'gid','-Gn':'groups'}[sys.argv[1]]
 if sys.argv[-1]=='customer':key='customer_'+key
 print(f[key])
elif name=='install':
 pathlib.Path(os.environ['MARKER']).write_text('would stage root-owned package dir')
elif name=='adduser':
 raise SystemExit('unexpected account creation for an existing identity')
"""
  with tempfile.TemporaryDirectory() as d:
   path=pathlib.Path(d)
   for name in ['getent','id','install','adduser']:
    f=path/name;f.write_text(adapter);f.chmod(0o755)
   for name,overrides,ok in fixtures:
    with self.subTest(name=name):
     marker=path/'staged';marker.unlink(missing_ok=True)
     env=dict(os.environ,PATH=str(path)+':'+os.environ['PATH'],
       IDENTITY_FIXTURE=json.dumps(good|overrides),MARKER=str(marker))
     r=subprocess.run(['/bin/sh',str(ROOT/'image/config/hooks/normal/0012-inject-user.hook.chroot')],env=env,capture_output=True)
     self.assertEqual(r.returncode==0,ok,r.stderr.decode())
     self.assertEqual(marker.exists(),ok)
     marker.unlink(missing_ok=True)
     r=subprocess.run(['/bin/sh',str(ROOT/'image/config/hooks/normal/0012-inject-user.hook.chroot'),'install'],env=env,capture_output=True)
     self.assertEqual(r.returncode==0,ok,r.stderr.decode())
     self.assertFalse(marker.exists())
 def test_optional_staging_rejects_unknown_and_clears_stale(self):
  import shutil
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'packaging').mkdir()
   shutil.copy(ROOT/'packaging/stage-inject-image.sh',root/'packaging')
   staged=root/'image/config/includes.chroot/tmp/southbag-inject-candidate.deb'
   staged.parent.mkdir(parents=True);staged.write_text('stale')
   r=subprocess.run(['bash',str(root/'packaging/stage-inject-image.sh')],capture_output=True)
   self.assertEqual(r.returncode,0);self.assertFalse(staged.exists())
   bad=root/'bad';bad.write_text('unreviewed')
   r=subprocess.run(['bash',str(root/'packaging/stage-inject-image.sh'),str(bad),str(bad)],capture_output=True)
   self.assertNotEqual(r.returncode,0);self.assertFalse(staged.exists())
  hook=(ROOT/'image/config/hooks/normal/0013-inject-package.hook.chroot').read_text()
  self.assertIn('57354fa506d2d1d5319bb43384049f32f20127d7cc2ecc6508442fe5a53a4d21',hook)
  code='\n'.join(x for x in hook.splitlines() if not x.startswith('#'))
  for bad in ['systemctl','modprobe','chmod','chgrp','setfacl']:
   self.assertNotIn(bad,code)
if __name__=='__main__':unittest.main(verbosity=2)
