import { parseArgs } from 'node:util'
import { exportMarkdown } from './core/export-markdown'

const HELP = `Usage: marp-editable <deck.md> [options]

Convert Marp Markdown to editable PPTX without VS Code.

  -o, --output <file.pptx>  Output (default: beside input)
      --engine <name>       chrome (default) or firefox
      --browser <path>      Executable (or CHROME_PATH / FIREFOX_PATH)
  -c, --config <path>       Marp config (default: discover from deck directory)
      --theme-set <path>    Theme CSS file or directory; may be repeated
      --theme-dir <path>    Theme directory; may be repeated
      --marp-engine <path>  Custom Marp JavaScript engine (.js/.cjs/.mjs)
      --html                Enable HTML in Markdown
      --no-html             Disable HTML in Markdown
      --debug-json <path>   Save extracted slide data
  -h, --help                Show this help

Paths supplied on the command line resolve against the current directory.
Existing output is replaced only after successful conversion.
`

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      output: { type: 'string', short: 'o' },
      browser: { type: 'string' },
      engine: { type: 'string' },
      config: { type: 'string', short: 'c' },
      'theme-set': { type: 'string', multiple: true },
      'theme-dir': { type: 'string', multiple: true },
      'marp-engine': { type: 'string' },
      html: { type: 'boolean' },
      'no-html': { type: 'boolean' },
      'debug-json': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) { console.log(HELP); return }
  if (positionals.length !== 1) throw new Error('Provide exactly one Markdown file. Use --help for usage.')
  if (values.html && values['no-html']) throw new Error('Choose either --html or --no-html.')
  if (values.engine !== undefined && values.engine !== 'chrome' && values.engine !== 'firefox') {
    throw new Error('Engine must be chrome or firefox.')
  }
  await exportMarkdown({
    inputPath: positionals[0], outputPath: values.output, browserPath: values.browser, engine: values.engine,
    configPath: values.config, themePaths: values['theme-set'],
    themeDirectories: values['theme-dir'], marpEnginePath: values['marp-engine'],
    html: values.html ? true : values['no-html'] ? false : undefined,
    debugJsonPath: values['debug-json'], onProgress: message => console.error(message),
  })
}

main().catch(error => {
  console.error(`marp-editable: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
