import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

const STATE_VERSION = 1

export function resolveSelectionPath(options = {}, environment = {}) {
  if (typeof options.selectionPath === "string") return options.selectionPath
  if (typeof environment.selectionPath === "string") return environment.selectionPath
  const dataHome = environment.xdgDataHome
  if (typeof dataHome === "string" && dataHome) return join(dataHome, "opencode-skill-picker", "selection.json")
  return join(environment.home ?? homedir(), ".local", "share", "opencode-skill-picker", "selection.json")
}

function normalizeDisabled(disabled) {
  return [...new Set([...disabled].filter((name) => typeof name === "string"))].sort()
}

export async function readSelection(path) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"))
    if (state?.version !== STATE_VERSION || !Array.isArray(state.disabled)) return new Set()
    return new Set(state.disabled.filter((name) => typeof name === "string"))
  } catch {
    return new Set()
  }
}

export async function writeSelection(disabled, path) {
  const directory = dirname(path)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const content = `${JSON.stringify({ version: STATE_VERSION, disabled: normalizeDisabled(disabled) }, null, 2)}\n`
  const temporaryPath = join(directory, `.${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`)

  try {
    await writeFile(temporaryPath, content, { mode: 0o600 })
    await rename(temporaryPath, path)
    try {
      await chmod(path, 0o600)
    } catch {
      // Some filesystems do not support POSIX permissions.
    }
  } finally {
    try {
      await unlink(temporaryPath)
    } catch {
      // The temporary file was renamed or already removed.
    }
  }
}

export function selectionPathFrom(options = {}) {
  return resolveSelectionPath(options, {
    selectionPath: process.env.OPENCODE_SKILL_SELECTION_PATH,
    xdgDataHome: process.env.XDG_DATA_HOME,
    home: process.env.HOME,
  })
}
