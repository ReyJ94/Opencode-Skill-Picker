import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import skillPickerServer, { filterAvailableSkills, createSkillPickerServerPlugin } from "../server.js"
import { resolveSelectionPath, readSelection, writeSelection } from "../selection-state.js"
import { SkillPickerTuiPlugin } from "../tui.js"

test("selection state defaults to a portable XDG data location", () => {
  assert.equal(
    resolveSelectionPath({}, { home: "/home/example", xdgDataHome: "/data" }),
    "/data/opencode-skill-picker/selection.json",
  )
})

test("selection path precedence is option, environment, XDG, then home", () => {
  const environment = { home: "/home/example", xdgDataHome: "/data", selectionPath: "/environment.json" }
  assert.equal(resolveSelectionPath({ selectionPath: "/option.json" }, environment), "/option.json")
  assert.equal(resolveSelectionPath({}, environment), "/environment.json")
  assert.equal(resolveSelectionPath({}, { home: "/home/example", xdgDataHome: "/data" }), "/data/opencode-skill-picker/selection.json")
  assert.equal(resolveSelectionPath({}, { home: "/home/example" }), "/home/example/.local/share/opencode-skill-picker/selection.json")
})

test("selection state ignores missing, malformed, and unsupported-version files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "skill-picker-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "selection.json")

  assert.deepEqual(await readSelection(path), new Set())
  await writeFile(path, "{not json")
  assert.deepEqual(await readSelection(path), new Set())
  await writeFile(path, JSON.stringify({ version: 2, disabled: ["one"] }))
  assert.deepEqual(await readSelection(path), new Set())
  await writeFile(path, JSON.stringify({ version: 1, disabled: ["one", 2, "two"] }))
  assert.deepEqual(await readSelection(path), new Set(["one", "two"]))
})

test("selection state atomically round-trips normalized version-one data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "skill-picker-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "nested", "selection.json")

  await writeSelection(new Set(["zeta", "alpha", "zeta"]), path)
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), { version: 1, disabled: ["alpha", "zeta"] })
  assert.deepEqual(await readSelection(path), new Set(["alpha", "zeta"]))
  if (process.platform !== "win32") assert.equal((await stat(path)).mode & 0o077, 0)
})

test("server removes disabled skills from system prompts and denies their tool execution", async () => {
  const system = ["before\n<available_skills>\n  <skill>\n    <name>enabled</name>\n  </skill>\n  <skill>\n    <name>disabled</name>\n  </skill>\n</available_skills>\nafter"]
  filterAvailableSkills(system, new Set(["disabled"]))
  assert.match(system[0], /<name>enabled<\/name>/)
  assert.doesNotMatch(system[0], /<name>disabled<\/name>/)

  const directory = await mkdtemp(join(tmpdir(), "skill-picker-test-"))
  const path = join(directory, "selection.json")
  await writeSelection(new Set(["disabled"]), path)
  const hooks = await createSkillPickerServerPlugin({ selectionPath: path })()
  const output = { args: { name: "disabled" } }
  await hooks["tool.execute.before"]({ tool: "skill" }, output)
  assert.equal(output.args.name, "__disabled_by_skill_picker__")
  await rm(directory, { recursive: true, force: true })
})

test("default server entrypoint applies its invocation selectionPath", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "skill-picker-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "selection.json")
  await writeSelection(new Set(["disabled"]), path)
  const hooks = await skillPickerServer.server({}, { selectionPath: path })
  const system = ["<available_skills>\n  <skill>\n    <name>enabled</name>\n  </skill>\n  <skill>\n    <name>disabled</name>\n  </skill>\n</available_skills>"]
  await hooks["experimental.chat.system.transform"]({}, { system })
  assert.doesNotMatch(system[0], /<name>disabled<\/name>/)
  const output = { args: { name: "disabled" } }
  await hooks["tool.execute.before"]({ tool: "skill" }, output)
  assert.equal(output.args.name, "__disabled_by_skill_picker__")
})

test("TUI registers /manage-skills, filters the native skill list, and toggles dialog state", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "skill-picker-test-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "selection.json")
  const layers = []
  const dialogs = []
  const toasts = []
  let resolveDialog
  const dialogReady = new Promise((resolve) => { resolveDialog = resolve })
  let resolveToggle
  const toggleComplete = new Promise((resolve) => { resolveToggle = resolve })
  const allSkills = [{ name: "alpha", description: "A" }, { name: "beta", description: "B" }]
  const api = {
    client: { app: { skills: async () => ({ data: allSkills }) } },
    keymap: { registerLayer: (layer) => layers.push(layer) },
    mode: { push: () => () => {} },
    ui: {
      DialogSelect: (options) => options,
      dialog: { replace: (render, onClose) => { dialogs.push({ render, onClose }); resolveDialog() }, setSize: () => {} },
      toast: (toast) => { toasts.push(toast); if (toast.variant === "success") resolveToggle() },
    },
  }

  await SkillPickerTuiPlugin(api, { selectionPath: path })
  const manage = layers[0].commands.find((command) => command.slashName === "manage-skills")
  assert.ok(manage)
  await manage.run()
  await dialogReady
  const picker = dialogs.at(-1).render()
  assert.equal(picker.title, "Skill access")
  picker.onSelect({ value: "alpha" })
  await toggleComplete
  assert.deepEqual(await readSelection(path), new Set(["alpha"]))
  assert.deepEqual((await api.client.app.skills()).data, [{ name: "beta", description: "B" }])
  assert.equal(toasts.at(-1).variant, "success")
})
