"""End-to-end CLI check using either engine and standard-library PPTX XML inspection."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile

repo = Path(__file__).resolve().parents[1]
engine = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('MARP_TEST_ENGINE', 'chrome')
browser_env = 'FIREFOX_PATH' if engine == 'firefox' else 'CHROME_PATH'
browser = os.environ.get(browser_env, '/usr/bin/firefox' if engine == 'firefox' else '/usr/bin/chromium')
root = Path(tempfile.mkdtemp(prefix='marp-cli-smoke-'))
source = root / 'project' / 'decks'
source.mkdir(parents=True)
shutil.copy(repo / 'src/native-pptx/test-fixtures/test-icon.png', source / 'icon.png')
(root / 'project/theme.css').write_text('''/* @theme cli-test */
@import 'default';
section { background: #123456; font-family: Arial; }
''')
config = root / 'project/.marprc.yml'
config.write_text('themeSet: ./theme.css\nhtml: false\n')
theme_directory = root / 'custom assets' / 'themes'
theme_directory.mkdir(parents=True)
(theme_directory / 'override.css').write_text('''/* @theme cli-test */
@import 'default';
section { background: #654321; font-family: Arial; }
''')
custom_engine = root / 'custom assets' / 'engine.cjs'
custom_engine.write_text('''module.exports = ({ marp }) => marp.use(md => {
  md.core.ruler.after('inline', 'cli-custom-marker', state => {
    for (const token of state.tokens) {
      for (const child of token.children || []) {
        if (child.type === 'text' && child.content.includes('Editable native text')) {
          child.content += ' CUSTOM-JS-MARKER';
        }
      }
    }
  });
});
''')
deck = source / 'sample.md'
deck.write_text('''---
marp: true
theme: cli-test
---
# CLI thử nghiệm

Editable native text

![width:80px](./icon.png)

<!-- Speaker note from CLI -->

---

## Second slide

- Alpha
- Beta

<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100">
<foreignObject width="320" height="100">
<div xmlns="http://www.w3.org/1999/xhtml" style="background: #ffaa00; color: black; font-size: 24px">SVG screenshot label</div>
</foreignObject>
</svg>

<img src="./icon.png" width="80" style="filter: grayscale(1)" />
''', encoding='utf-8')

def run(*args, success=True, env=None):
    result = subprocess.run(['node', str(repo / 'lib/cli.cjs'), '--engine', engine, *map(str, args)],
                            cwd=root, env=env, capture_output=True, text=True, timeout=120)
    assert (result.returncode == 0) == success, result.stdout + result.stderr
    return result

assert 'Usage:' in run('--help').stdout
run(success=False)
run('--unknown', success=False)
run(deck, '--engine', 'unsupported', success=False)
run(deck, '--html', '--no-html', success=False)
run(deck, '--browser', root / 'missing-browser', success=False)
run(deck, '--browser', browser, '--theme-dir', config, success=False)
run(deck, '--browser', browser, '--theme-dir', root / 'missing-themes', success=False)
run(deck, '--browser', browser, '--marp-engine', root / 'missing.js', success=False)
run(deck, '--browser', browser, '--marp-engine', config, success=False)
output = root / 'outputs/sample.pptx'
debug = root / 'outputs/sample.json'
run(deck, '--config', config, '--html', '--browser', browser,
    '--theme-dir', theme_directory, '--marp-engine', custom_engine,
    '-o', output, '--debug-json', debug)

ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'p': 'http://schemas.openxmlformats.org/presentationml/2006/main'}
with zipfile.ZipFile(output) as archive:
    slides = sorted(name for name in archive.namelist() if re.fullmatch(r'ppt/slides/slide\d+\.xml', name))
    assert len(slides) == 2, slides
    trees = [ET.fromstring(archive.read(name)) for name in slides]
    text = '\n'.join(node.text or '' for tree in trees for node in tree.findall('.//a:t', ns))
    assert 'CLI thử nghiệm' in text and 'Editable native text' in text and 'Second slide' in text
    assert 'CUSTOM-JS-MARKER' in text, 'Custom JavaScript engine was not applied'
    assert any(tree.findall('.//p:sp/p:txBody', ns) for tree in trees), 'No native text shapes'
    assert any(tree.findall('.//p:pic', ns) for tree in trees), 'No image objects'
    assert any(name.startswith('ppt/media/') for name in archive.namelist()), 'Local image not embedded'
    assert b'654321' in archive.read(slides[0]), 'CLI theme directory not applied'
    notes = [name for name in archive.namelist() if re.fullmatch(r'ppt/notesSlides/notesSlide\d+\.xml', name)]
    assert any(b'Speaker note from CLI' in archive.read(name) for name in notes), 'Notes missing'
data = json.loads(debug.read_text())
assert len(data) == 2
def images(elements):
    for element in elements:
        if element['type'] == 'image':
            yield element
        yield from images(element.get('children', []))
captures = [image for slide in data for image in images(slide['elements'])
            if image.get('src', '').startswith('data:image/png;base64,')]
assert len(captures) >= 2, 'SVG/filtered image screenshot capture failed'
assert not list(source.glob('.marp-editable-pptx-*')), 'Temporary HTML leaked'
assert not list(output.parent.glob('.marp-editable-pptx-*')), 'Temporary PPTX leaked'

# Config discovery and the engine's executable environment variable work from an unrelated cwd.
environment = dict(os.environ, **{browser_env: browser})
run(deck, '-o', root / 'discovered.pptx', env=environment)
assert (root / 'discovered.pptx').is_file()
with zipfile.ZipFile(root / 'discovered.pptx') as archive:
    assert b'123456' in archive.read('ppt/slides/slide1.xml'), 'Discovered config not applied'

# A rendering/config failure preserves a previous output and cleans temporary files.
original = output.read_bytes()
bad_config = root / 'invalid.yml'
bad_config.write_text('themeSet: [\n')
run(deck, '--config', bad_config, '--browser', browser, '-o', output, success=False)
assert output.read_bytes() == original, 'Failed conversion modified previous output'
assert not list(source.glob('.marp-editable-pptx-*')), 'Temporary HTML leaked after failure'
print(json.dumps({'status': 'passed', 'engine': engine, 'slides': 2, 'checks': [
    'help and invalid arguments', 'native Unicode text', 'relative embedded image',
    'CLI theme directory override', 'custom JavaScript engine', 'paths containing spaces',
    'config-relative custom theme', 'presenter notes', 'debug JSON',
    'config discovery', browser_env, 'SVG foreignObject screenshot',
    'CSS filtered image screenshot', 'HTML flag overrides config',
    'cleanup', 'preserved output on failure'],
    'artifacts': str(root)}, indent=2))
