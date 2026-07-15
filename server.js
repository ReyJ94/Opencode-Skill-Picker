import { readSelection, selectionPathFrom } from "./selection-state.js"

export function filterAvailableSkills(system, disabled = new Set()) {
  if (!Array.isArray(system) || !disabled || typeof disabled.size !== "number" || disabled.size === 0) return
  const skillBlock = /<available_skills>\n([\s\S]*?)<\/available_skills>/g
  const skillEntry = /  <skill>\n    <name>([^<]+)<\/name>[\s\S]*?  <\/skill>\n?/g

  for (let index = 0; index < system.length; index += 1) {
    system[index] = system[index].replace(skillBlock, (block) => {
      const enabledEntries = [...block.matchAll(skillEntry)]
        .filter((match) => !disabled.has(match[1]))
        .map((match) => match[0].trimEnd())
      if (enabledEntries.length === 0) return "No skills are enabled for this session."
      return ["<available_skills>", ...enabledEntries, "</available_skills>"].join("\n")
    })
  }
}

export function createSkillPickerServerPlugin(options = {}) {
  const selectionPath = selectionPathFrom(options)
  return async () => ({
    "experimental.chat.system.transform": async (_input, output) => {
      filterAvailableSkills(output.system, await readSelection(selectionPath))
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "skill" || !(await readSelection(selectionPath)).has(output.args?.name)) return
      output.args.name = "__disabled_by_skill_picker__"
    },
  })
}

export async function SkillPickerServerPlugin(input, options = {}) {
  return createSkillPickerServerPlugin(options)(input)
}

export default {
  id: "opencode-skill-picker.server",
  server: SkillPickerServerPlugin,
}
