# Standalone CLI proof of concept

The CLI uses the existing DOM extraction and native PPTX builder without loading
VS Code. It currently needs Node.js 22 or newer and installed Chrome/Chromium or Firefox.
It is a source-checkout PoC, not a self-contained executable or published npm package.

```bash
npm ci
npm run build:cli
npm run cli -- docs/theme-demo/deck.md \
  --theme-set docs/theme-demo/custom-demo.css \
  --browser /usr/bin/chromium \
  --output /tmp/custom-demo.pptx \
  --debug-json /tmp/custom-demo.json
```

Chrome is the default engine. To select Firefox:

```bash
npm run cli -- docs/theme-demo/deck.md \
  --engine firefox --browser /usr/bin/firefox \
  --theme-set docs/theme-demo/custom-demo.css \
  --output /tmp/firefox-demo.pptx
```

Firefox uses Puppeteer's WebDriver BiDi protocol and receives no Chromium flags.
`--browser` supplies a path, while `--engine` selects how to launch it.
`CHROME_PATH` / `FIREFOX_PATH` override discovery for the selected engine.
Firefox discovery checks PATH and common installation locations; explicit paths are
recommended for unusual installations. CLI arguments resolve against the current directory.
`--theme-set` accepts local CSS files or theme directories and can be repeated.
`--theme-dir` explicitly accepts directories and can also be repeated. Marp CLI
handles CSS discovery in these directories. Select a registered theme by its
`theme:` name in Markdown front matter.

## Custom themes and JavaScript engines

```bash
npm run cli -- deck.md \
  --engine firefox \
  --theme-dir /local/ericsson_deck_skill/assets/themes \
  --marp-engine /local/ericsson_deck_skill/assets/engine.js \
  --output deck.pptx
```

`--engine` selects the browser renderer (`chrome` or `firefox`). `--marp-engine`
selects the JavaScript module Marp uses to process Markdown, supporting functional
engines such as `module.exports = ({ marp }) => marp.use(plugin)` and Marpit-based
engines. The module runs in Node.js and follows Marp's module-loading behavior;
it is not a script injected into slide HTML. Its dependencies resolve from the
module's own location. CLI paths resolve against the current directory and may
contain spaces. A CLI custom engine overrides the project's `engine` setting.
The engine file is executed as code, so use a module you trust. Marp embeds theme
CSS into HTML saved beside the Markdown deck; relative font and image URLs in
that CSS must resolve from the deck's location. When using the supplied Endava
themes, keep the expected `assets/fonts` layout alongside the deck.

## Configuration

The service discovers project config upward from the Markdown directory, then
passes its path to Marp CLI. Use `--config path/to/.marprc.yml`
to select an explicit config. Theme paths inside a config retain Marp's own path
resolution. Explicit CLI flags override corresponding config values; theme-set
merging follows Marp CLI behavior. VS Code settings are not read.
JavaScript config files may execute code, just as when invoking Marp CLI directly.
Use rendering/theme configs; configs that select PDF, image or notes output are
outside this PoC's supported scope.
`--html` / `--no-html` control HTML support in Markdown.

Temporary HTML is created beside the source deck so relative images keep working;
the source directory must be writable. Output is written to a temporary PPTX and
renamed after conversion succeeds. Existing output is replaced on success. Temporary
files are removed on ordinary success/failure; a forcibly terminated process can
leave temporary files. Output directories are created automatically.

## Architecture and scope

- `src/cli.ts`: command arguments, help, progress and error exit status.
- `src/core/export-markdown.ts`: Markdown-to-HTML-to-PPTX orchestration.
- `src/native-pptx/`: existing browser extraction and PPTX construction.
- `scripts/build-cli.js`: bundles local code, leaving npm runtime packages external.

`npm run build:cli` regenerates the DOM walker before bundling. Leaving Marp CLI
external preserves its runtime asset lookup and avoids loading the VS Code entry
point. The existing extension still uses its original export orchestration; adopting
the shared service there is a subsequent refactor.

Offline export requires local assets/fonts/scripts. Fonts and PPTX rendering retain
the original engine's limitations. This PoC does not bundle browsers, add a desktop
UI, implement cancellation, or provide arbitrary HTML-to-PPTX conversion.

## Validation

Run `npm run compile`, `npm test -- --runInBand`, then the example above.
Run `python3 scripts/test-cli-smoke.py chrome` or
`python3 scripts/test-cli-smoke.py firefox` with Python 3 and the corresponding browser.
The checks include clipped screenshots of SVG foreignObject and CSS-filtered images,
HTML flags, and config discovery from a directory unrelated to the deck.
End-to-end acceptance should inspect slide count, native text objects, theme colors,
embedded local images, presenter notes and temporary-file cleanup. Structural checks
do not establish pixel-perfect rendering in PowerPoint.
