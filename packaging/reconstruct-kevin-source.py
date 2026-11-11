#!/usr/bin/env python3
"""Build exact corresponding worker source from the pinned baseline and patch."""
import gzip, hashlib, io, pathlib, subprocess, sys, tarfile, tempfile
BASE='28fc76302b6cb7f752d6a5f33fda33f04d81a3c7e880305b7d3dff4a493c22be'
PATCH='36b4f9fa2cbef3503aac269577f94b8271015e094d6c7c3d410c77c4a7249c60'
EXPECTED='9d00e6cd1b2917c63022664426c8f25e174644711882c1671894a60bb5e4d0d9'
source=pathlib.Path(sys.argv[1]).resolve();out=pathlib.Path(sys.argv[2]).resolve()
patch=pathlib.Path(__file__).with_name('kevin-worker.patch')
assert hashlib.sha256(source.read_bytes()).hexdigest()==BASE, 'baseline mismatch'
assert hashlib.sha256(patch.read_bytes()).hexdigest()==PATCH, 'patch mismatch'
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d)
 with tarfile.open(source,'r:gz') as src:
  members=src.getmembers()
  assert all(not m.name.startswith('/') and '..' not in pathlib.PurePosixPath(m.name).parts and not m.issym() and not m.islnk() for m in members), 'unsafe baseline member'
  modes={m.name:m.mode for m in members if m.isfile()}
  src.extractall(root)
 subprocess.run(['patch','-p1','--batch','-i',str(patch)],cwd=root,check=True)
 out.parent.mkdir(parents=True,exist_ok=True)
 with out.open('wb') as f,gzip.GzipFile(filename='',fileobj=f,mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w|',format=tarfile.GNU_FORMAT) as dst:
  for p in sorted(root.rglob('*')):
   if not p.is_file():continue
   name=p.relative_to(root).as_posix();b=p.read_bytes()
   m=tarfile.TarInfo(name);m.size=len(b);m.mode=modes.get(name,0o644);m.uid=m.gid=0;m.mtime=0
   dst.addfile(m,io.BytesIO(b))
actual=hashlib.sha256(out.read_bytes()).hexdigest()
if actual!=EXPECTED:
 out.unlink();raise SystemExit('corresponding source mismatch: '+actual)
print(actual+'  '+str(out))
