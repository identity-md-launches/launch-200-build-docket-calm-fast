"""Package the production export, without dependency/cache or repository metadata."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import os

root = Path(__file__).resolve().parent.parent
export = root / 'dist'
artifact = root / 'artifacts' / 'website.zip'
report = root / 'artifacts' / 'package-size.json'
assert (export / 'index.html').is_file()
files = sorted(p for p in export.rglob('*') if p.is_file())
assert not any('node_modules' in p.parts for p in files)
assert all(not p.is_symlink() for p in files)
with ZipFile(artifact, 'w', ZIP_DEFLATED, compresslevel=9) as archive:
    for file in files:
        archive.write(file, file.relative_to(export).as_posix())
with ZipFile(artifact) as archive:
    assert 'index.html' in archive.namelist()
    assert not any(name.startswith('dist/') for name in archive.namelist())
    assert archive.testzip() is None
    for file in files:
        assert archive.read(file.relative_to(export).as_posix()) == file.read_bytes()
# Do not traverse protected metadata or disposable inputs/scratch.
excluded = {'.git', '.github', '.imd', '.agents', '.codex', '.playwright-mcp', 'test'}
submission = []
for folder, directories, names in os.walk(root):
    directories[:] = [name for name in directories if name not in excluded]
    for name in names:
        if name.startswith('.env'):
            raise AssertionError('Environment files must not enter the submission')
        submission.append(Path(folder) / name)
assert not any('node_modules' in p.parts or p.name.endswith(('.tgz','.map')) for p in submission)
assert all(not p.is_symlink() for p in submission)
base_total = sum(p.stat().st_size for p in submission if p != report)
result = {'files_in_export':len(files), 'export_bytes':sum(p.stat().st_size for p in files),
          'zip_bytes':artifact.stat().st_size, 'submission_file_bytes':base_total,
          'limit_bytes':8388608}
for _ in range(5):
    content = json.dumps(result, indent=2) + '\n'
    result['submission_file_bytes'] = base_total + len(content.encode())
report.write_text(json.dumps(result, indent=2) + '\n')
assert result['submission_file_bytes'] <= result['limit_bytes'], result
print(report.read_text(), end='')
