import { readSelection, selectionPathFrom, writeSelection } from "./selection-state.js"

const PICKER_MODE = "skill-picker"

export const SkillPickerTuiPlugin = async (api, options = {}) => {
  const selectionPath = selectionPathFrom(options)
  let skills = []
  let disabled = new Set()
  let selected
  let active = false
  let releaseMode
  let dialogGeneration = 0

  // This handle stays unfiltered so the manager can re-enable every skill.
  const listAllSkills = api.client.app.skills.bind(api.client.app)
  api.client.app.skills = async (...args) => {
    const response = await listAllSkills(...args)
    const currentDisabled = await readSelection(selectionPath)
    if (!Array.isArray(response.data) || currentDisabled.size === 0) return response
    return { ...response, data: response.data.filter((skill) => !currentDisabled.has(skill.name)) }
  }

  const skillOptions = () => skills.map((skill) => {
    const enabled = !disabled.has(skill.name)
    return {
      title: `${enabled ? "[x]" : "[ ]"} ${skill.name}`,
      value: skill.name,
      description: `${enabled ? "enabled" : "disabled"} - ${skill.description ?? "No description"}`,
      category: "Skills",
    }
  })

  const renderPicker = () => {
    const generation = ++dialogGeneration
    active = false
    releaseMode?.()
    releaseMode = undefined
    api.ui.dialog.replace(
      () => api.ui.DialogSelect({
        title: "Skill access",
        placeholder: "Filter skills...",
        options: skillOptions(),
        current: selected,
        onMove: (option) => { selected = option.value },
        onSelect: (option) => { selected = option.value; void toggleSelected() },
      }),
      () => {
        if (generation !== dialogGeneration) return
        active = false
        releaseMode?.()
        releaseMode = undefined
      },
    )
    api.ui.dialog.setSize("large")
    active = true
    releaseMode = api.mode.push(PICKER_MODE)
  }

  const toggleSelected = async () => {
    if (!active || !selected) return
    if (disabled.has(selected)) disabled.delete(selected)
    else disabled.add(selected)
    try {
      await writeSelection(disabled, selectionPath)
      api.ui.toast({ variant: "success", message: `${selected} ${disabled.has(selected) ? "disabled" : "enabled"} for the next model request.` })
      renderPicker()
    } catch (error) {
      api.ui.toast({ variant: "error", message: `Could not update skill access: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  const openPicker = async () => {
    try {
      const result = await listAllSkills({}, { throwOnError: true })
      skills = [...(result.data ?? [])].sort((left, right) => left.name.localeCompare(right.name))
      disabled = await readSelection(selectionPath)
      selected = skills.find((skill) => skill.name === selected)?.name ?? skills[0]?.name
      renderPicker()
    } catch (error) {
      api.ui.toast({ variant: "error", message: `Could not list skills: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  api.keymap.registerLayer({
    commands: [{ name: "skills.manage", title: "Manage skills", category: "Skills", namespace: "palette", slashName: "manage-skills", suggested: true, run: () => void openPicker() }],
    bindings: [],
  })
  api.keymap.registerLayer({
    mode: PICKER_MODE,
    commands: [{ name: "skills.toggle_selected", title: "Toggle selected skill", category: "Skills", hidden: true, run: () => void toggleSelected() }],
    bindings: [{ key: "space", cmd: "skills.toggle_selected", desc: "Enable or disable selected skill" }],
  })
}

export default {
  id: "opencode-skill-picker.tui",
  tui: SkillPickerTuiPlugin,
}
