import { access, mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { marpCli } from '@marp-team/marp-cli'
import { cosmiconfig } from 'cosmiconfig'
import { detectBrowserPath } from '../native-pptx/browser'
import { generateNativePptx } from '../native-pptx'

export interface ExportMarkdownOptions {
  inputPath: string
  outputPath?: string
  browserPath?: string
  engine?: 'chrome' | 'firefox'
  configPath?: string
  themePaths?: string[]
  themeDirectories?: string[]
  marpEnginePath?: string
  html?: boolean
  debugJsonPath?: string
  onProgress?: (message: string) => void
}

async function discoverConfig(startDirectory: string): Promise<string | undefined> {
  const explorer = cosmiconfig('marp', { searchStrategy: 'none' })
  let directory = startDirectory
  while (true) {
    const found = await explorer.search(directory)
    if (found && !found.isEmpty) return found.filepath
    const parent = path.dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/** Convert a saved Markdown deck without a VS Code runtime. */
export async function exportMarkdown(options: ExportMarkdownOptions): Promise<string> {
  const inputPath = path.resolve(options.inputPath)
  if (!/\.md$/i.test(inputPath)) throw new Error('Input must be a .md file.')
  await access(inputPath, constants.R_OK)
  const outputPath = path.resolve(options.outputPath ?? inputPath.replace(/\.md$/i, '.pptx'))
  if (!/\.pptx$/i.test(outputPath)) throw new Error('Output must be a .pptx file.')
  const engine = options.engine ?? 'chrome'
  const explicitBrowser = options.browserPath ?? (engine === 'firefox' ? process.env.FIREFOX_PATH : process.env.CHROME_PATH)
  if (explicitBrowser) await access(path.resolve(explicitBrowser), constants.X_OK)
  let browserPath = engine === 'chrome'
    ? detectBrowserPath('auto', explicitBrowser && path.resolve(explicitBrowser))
    : explicitBrowser && path.resolve(explicitBrowser)
  if (!browserPath && engine === 'firefox') {
    const executable = process.platform === 'win32' ? 'firefox.exe' : 'firefox'
    const candidates = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, executable))
    candidates.push('/usr/bin/firefox', '/usr/bin/firefox-esr', '/Applications/Firefox.app/Contents/MacOS/firefox')
    for (const directory of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']]) {
      if (directory) candidates.push(path.join(directory, 'Mozilla Firefox', 'firefox.exe'))
    }
    for (const candidate of candidates) {
      try { await access(candidate, constants.X_OK); browserPath = candidate; break } catch { /* next */ }
    }
  }
  if (!browserPath && engine === 'chrome' && process.platform === 'linux') {
    for (const candidate of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']) {
      try { await access(candidate, constants.X_OK); browserPath = candidate; break } catch { /* next */ }
    }
  }
  if (!browserPath) throw new Error(`Browser not found. Pass --browser or set ${engine === 'firefox' ? 'FIREFOX_PATH' : 'CHROME_PATH'}.`)
  if (options.configPath) await access(path.resolve(options.configPath), constants.R_OK)
  // Marp discovery starts at process.cwd(); resolve from the deck without chdir.
  const configPath = options.configPath
    ? path.resolve(options.configPath)
    : await discoverConfig(path.dirname(inputPath))
  const themePaths = [...new Set([
    ...(options.themePaths ?? []), ...(options.themeDirectories ?? []),
  ].map(theme => path.resolve(theme)))]
  for (const directory of options.themeDirectories ?? []) {
    const resolved = path.resolve(directory)
    if (!(await stat(resolved)).isDirectory()) throw new Error(`Theme directory is not a directory: ${resolved}`)
  }
  for (const theme of themePaths) await access(theme, constants.R_OK)
  const marpEnginePath = options.marpEnginePath && path.resolve(options.marpEnginePath)
  if (marpEnginePath) {
    if (!/\.(?:js|cjs|mjs)$/i.test(marpEnginePath)) throw new Error('Custom Marp engine must be a .js, .cjs, or .mjs file.')
    if (!(await stat(marpEnginePath)).isFile()) throw new Error(`Custom Marp engine is not a file: ${marpEnginePath}`)
    await access(marpEnginePath, constants.R_OK)
  }
  const debugJsonPath = options.debugJsonPath && path.resolve(options.debugJsonPath)
  if (debugJsonPath && [inputPath, outputPath, configPath, marpEnginePath, ...themePaths].includes(debugJsonPath)) {
    throw new Error('Debug JSON path must differ from input, output, config, custom engine, and themes.')
  }

  const id = randomUUID()
  // Marp resolves relative media against the HTML output directory.
  const htmlPath = path.join(path.dirname(inputPath), `.marp-editable-pptx-${id}.html`)
  const outputTmpPath = path.join(path.dirname(outputPath), `.marp-editable-pptx-${id}.pptx`)
  try {
    options.onProgress?.('Rendering Markdown to HTML')
    const args = [inputPath, '-o', htmlPath, '--allow-local-files', '--no-watch', '--no-server', '--no-preview']
    if (configPath) args.push('--config', configPath)
    else args.push('--no-config')
    if (options.html !== undefined) args.push(options.html ? '--html' : '--no-html')
    if (marpEnginePath) args.push('--engine', marpEnginePath)
    if (themePaths.length) args.push('--theme-set', ...themePaths)
    const exitCode = await marpCli(args, {})
    if (exitCode !== 0) throw new Error(`Marp CLI exited with code ${exitCode}`)
    options.onProgress?.('Extracting slide layout and building editable PPTX')
    if (debugJsonPath) await mkdir(path.dirname(debugJsonPath), { recursive: true })
    const buffer = await generateNativePptx({ htmlPath, browserPath, engine, debugJsonPath })
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputTmpPath, buffer)
    await rename(outputTmpPath, outputPath)
    options.onProgress?.(`Written: ${outputPath} (${Math.round(buffer.length / 1024)} KB)`)
    return outputPath
  } finally {
    await Promise.all([htmlPath, outputTmpPath].map(file => unlink(file).catch(() => undefined)))
  }
}
