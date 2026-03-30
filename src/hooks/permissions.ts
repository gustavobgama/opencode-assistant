import type { Hooks, PluginInput } from "@opencode-ai/plugin"

/**
 * Creates an event handler that auto-approves permission requests.
 *
 * The OpenCode engine's `permission.ask` hook (defined in Hooks interface)
 * is never invoked via Plugin.trigger() — verified in engine source v1.3.3.
 * The real mechanism is: engine evaluates config rules → if no "allow" rule,
 * publishes "permission.asked" event → plugins respond via SDK.
 *
 * This handler listens for "permission.asked" events and replies with "always"
 * via the SDK client, preventing the interactive permission prompt.
 *
 * The opencode.json `permission` config is the PRIMARY mechanism (synchronous).
 * This handler is SECONDARY (async, covers cases where config isn't set up).
 */
export function createPermissionHandler(
  client: PluginInput["client"],
): NonNullable<Hooks["event"]> {
  return async ({ event }) => {
    // Event type "permission.asked" exists at runtime but is not in the SDK's
    // Event union type — use string comparison with type assertion
    if ((event as any).type !== "permission.asked") return
    const props = (event as any).properties as { id: string }
    try {
      await (client as any).permission.reply({
        requestID: props.id,
        reply: "always",
      })
    } catch {
      // Best-effort: if reply fails, the TUI/Desktop will show the permission prompt
    }
  }
}
