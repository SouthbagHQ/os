#!/usr/bin/env python3
"""Archive pinned product source without local diagnostic records."""
import sys,pathlib,subprocess,tarfile,io,gzip,hashlib
repo=pathlib.Path(sys.argv[1]);out=pathlib.Path(sys.argv[2])
raw=subprocess.check_output(['git','archive','63ba280a'],cwd=repo)
with tarfile.open(fileobj=io.BytesIO(raw),mode='r:') as src:
 with out.open('wb') as f:
  # Fixed original archive name and timestamp make repeated archives equal.
  with gzip.GzipFile(filename='espanso-source-63ba280a.tar',fileobj=f,mode='wb',mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode='w|') as dst:
    for item in src:
     if item.name in ['PROVENANCE.md','BUILD-STATE.md','.cargo/config.toml'] or item.name.startswith('.claude'):continue
     dst.addfile(item,src.extractfile(item) if item.isfile() else None)
print(hashlib.sha256(out.read_bytes()).hexdigest())
