"""Build clean, matching Windows and updater ZIPs from an exact Git commit.

Only committed source and a previously published, SHA-256-pinned Windows runtime
are used. Local settings, credentials, databases and development dependencies are
never inputs. Requires Python 3 and Node 24; no Python packages.
"""
import hashlib
import io
import json
import os
import pathlib
import shutil
import subprocess
import urllib.request
import zipfile

REPO = pathlib.Path(__file__).resolve().parent.parent
VERSION = '1.6.11'
RUNTIME_URL = 'https://github.com/Mericsdc/lrx-torn-tracker/releases/download/v1.6.9/LRX-Torn-Tracker-win32-x64-1.6.9.zip'
RUNTIME_SHA = '84aca86b641190673c539045a8d746d11dff5ee2ef75a6cccd81e91af720714e'
COMMIT = os.environ.get('RELEASE_COMMIT', 'HEAD')
STAGE = pathlib.Path(os.environ.get('RELEASE_STAGE', str(REPO / 'stage'))).resolve()
STAGE.mkdir(exist_ok=False)
source_dir = STAGE / 'source'
source_dir.mkdir()
source = subprocess.check_output(['git', 'archive', '--format=zip', COMMIT], cwd=REPO)

def safe_path(name):
    path = pathlib.PurePosixPath(name)
    assert not path.is_absolute() and '..' not in path.parts and '\\' not in name, name
    return path

with zipfile.ZipFile(io.BytesIO(source)) as archive:
    for name in archive.namelist():
        safe_path(name)
    archive.extractall(source_dir)

package = json.loads((source_dir / 'package.json').read_text(encoding='utf-8'))
assert package['version'] == VERSION
allowed = json.loads(subprocess.check_output([
    'node', '-e', 'process.stdout.write(JSON.stringify(require("./tools/make-update").listFiles(process.cwd())))'
], cwd=source_dir))
portable = STAGE / 'TornTracker-win32-x64'
app = portable / 'resources' / 'app'
app.mkdir(parents=True)
for name in allowed:
    safe_path(name)
    target = app / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source_dir / name, target)
for item in json.loads((app / 'userscripts' / 'sources.json').read_text(encoding='utf-8')):
    assert hashlib.sha256((app / 'userscripts' / item['file']).read_bytes()).hexdigest() == item['sha256']

request = urllib.request.Request(RUNTIME_URL, headers={'User-Agent': 'TornTracker-Release'})
with urllib.request.urlopen(request, timeout=120) as response:
    runtime = response.read()
assert hashlib.sha256(runtime).hexdigest() == RUNTIME_SHA
with zipfile.ZipFile(io.BytesIO(runtime)) as archive:
    executables = [safe_path(n) for n in archive.namelist() if safe_path(n).name == 'TornTracker.exe']
    assert len(executables) == 1
    root = executables[0].parent
    for item in archive.infolist():
        path = safe_path(item.filename)
        if item.is_dir():
            continue
        try:
            relative = path.relative_to(root)
        except ValueError:
            continue
        if not (len(relative.parts) == 1 or relative.parts[0] == 'locales'):
            continue
        if relative.name.endswith('.log') or relative.name.startswith('.'):
            continue
        target = portable.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(item))
assert (portable / 'TornTracker.exe').is_file()
assert (portable / 'locales' / 'en-US.pak').is_file()

notes = (app / ('RELEASE-NOTES-' + VERSION + '.md')).read_text(encoding='utf-8')
(STAGE / 'notes.md').write_text(notes, encoding='utf-8')
subprocess.run(['node', 'tools/make-update.js', notes], cwd=app, check=True)
output = STAGE / 'updates'
full = output / ('LRX-Torn-Tracker-win32-x64-' + VERSION + '.zip')
with zipfile.ZipFile(full, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(portable.rglob('*')):
        if path.is_file():
            archive.write(path, path.relative_to(STAGE).as_posix())
update = output / ('torntracker-app-' + VERSION + '.zip')
manifest = json.loads((output / 'latest.json').read_text(encoding='utf-8'))
assert manifest['version'] == VERSION
assert manifest['url'] == 'https://github.com/Mericsdc/lrx-torn-tracker/releases/download/v' + VERSION + '/' + update.name
assert hashlib.sha256(update.read_bytes()).hexdigest() == manifest['sha256']
with zipfile.ZipFile(update) as small, zipfile.ZipFile(full) as large:
    assert small.testzip() is None and large.testzip() is None
    assert set(small.namelist()) == set(allowed)
    for name in allowed:
        assert small.read(name) == (app / name).read_bytes() == large.read('TornTracker-win32-x64/resources/app/' + name)
    for name in large.namelist():
        parts = safe_path(name).parts
        assert not any(p in {'.git', '.fallow', '.hallmark', '.sites-state', '.openai', 'data', 'node_modules', 'backups', 'app-backup'} or p.startswith('qa-') for p in parts), name
        assert not name.endswith(('.log', '.sqlite', '.db'))
        assert not any(p.startswith('.env') or p.endswith('.env') and p != 'config.example.env' for p in parts)
stable = output / 'LRX-Torn-Tracker-Windows-x64.zip'
shutil.copyfile(full, stable)
checksums = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in [update, full, stable, output / 'latest.json']}
(output / 'SHA256SUMS.txt').write_text(''.join(digest + '  ' + name + '\n' for name, digest in checksums.items()), encoding='utf-8')
print(json.dumps({'version': VERSION, 'source': COMMIT, 'files': len(allowed), 'checksums': checksums}))
