"""Install reviewed scanner releases after checking pinned SHA-256 digests."""
import hashlib
from pathlib import Path
import sys
import tarfile
import urllib.request

root = Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
releases = [
    ("https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz", "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb", "gitleaks"),
    ("https://github.com/google/osv-scanner/releases/download/v2.7.1/osv-scanner_linux_amd64", "fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8", "osv-scanner"),
]
for url, checksum, name in releases:
    data = urllib.request.urlopen(url, timeout=90).read()
    if hashlib.sha256(data).hexdigest() != checksum:
        raise RuntimeError("Scanner checksum mismatch: " + name)
    if url.endswith(".tar.gz"):
        import io
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            with archive.extractfile("gitleaks") as binary:
                data = binary.read()
    target = root / name
    target.write_bytes(data)
    target.chmod(0o755)
    print("Verified scanner:", name)
