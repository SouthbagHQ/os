#!/usr/bin/env python3
"""Reconstruct the pinned product archive from public upstream plus our patch."""
import gzip,hashlib,io,pathlib,subprocess,sys,tarfile,tempfile
UPSTREAM='a87d1723f47a59e38d370e2f0c636d66d568b8f6'
REVISION='63ba280af6cb88310bda7c88975b087cc01b6e9d'
EXPECTED='28fc76302b6cb7f752d6a5f33fda33f04d81a3c7e880305b7d3dff4a493c22be'
patch=pathlib.Path(__file__).resolve().with_name('espanso-inject-only.patch')
out=pathlib.Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory() as d:
 def git(*args):return subprocess.check_output(['git','-C',d,*args])
 git('init','-q');git('fetch','--depth=1','https://github.com/espanso/espanso.git',UPSTREAM)
 git('checkout','--detach','FETCH_HEAD');git('apply',str(patch));git('add','.')
 tree=git('write-tree').decode().strip()
 raw=git('-c','tar.umask=0002','archive',tree)
 with out.open('wb') as f,gzip.GzipFile(filename='espanso-source-63ba280a.tar',fileobj=f,mode='wb',mtime=0) as gz,tarfile.open(fileobj=gz,mode='w|') as dst,tarfile.open(fileobj=io.BytesIO(raw)) as src:
  # Preserve the original archive's empty .cargo directory, not its local
  # cross-linker config. All file bytes come from upstream plus product patch.
  empty=tarfile.TarInfo('.cargo');empty.type=tarfile.DIRTYPE;empty.mode=0o775
  empty.uid=empty.gid=0;empty.uname=empty.gname='root';empty.mtime=1793964405;empty.pax_headers={'comment':REVISION};dst.addfile(empty)
  for m in src:
   if m.name.startswith('.claude'):continue
   m.mtime=1793964405;m.pax_headers={'comment':REVISION}
   dst.addfile(m,src.extractfile(m) if m.isfile() else None)
actual=hashlib.sha256(out.read_bytes()).hexdigest()
if actual!=EXPECTED:
 out.unlink();raise SystemExit('Reconstructed source digest mismatch: '+actual)
print(actual+'  '+str(out))
