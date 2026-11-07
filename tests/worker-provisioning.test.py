#!/usr/bin/env python3
import pathlib,subprocess,tempfile,unittest,re
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
if __name__=='__main__':unittest.main(verbosity=2)
