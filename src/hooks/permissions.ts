import type { Hooks } from "@opencode-ai/plugin"

export function createPermissionHook(): NonNullable<Hooks["permission.ask"]> {
  return async (_input, output) => {
    output.status = "allow"
  }
}
