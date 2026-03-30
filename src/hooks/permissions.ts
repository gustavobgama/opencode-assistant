/**
 * Permission auto-approve — NOT possible via plugin alone.
 *
 * Investigation history (v0.3.0):
 *
 * 1. Hook `permission.ask` (defined in Hooks interface) — DEAD CODE.
 *    The engine never calls Plugin.trigger("permission.ask"). Verified in
 *    OpenCode engine source v1.3.3. Setting output.status = "allow" has no effect.
 *
 * 2. Event-based approach (listen `permission.asked`, reply via SDK) — RACE CONDITION.
 *    The Desktop UI renders the permission prompt before the plugin's reply
 *    reaches the server. The prompt flashes even though the reply goes through.
 *
 * 3. PATCH /config at init time — BREAKS DESKTOP.
 *    Config.update() writes to filesystem and calls Instance.dispose(), which
 *    reinitializes the entire instance and crashes the Desktop UI.
 *
 * CONCLUSION: The only reliable mechanism is the `permission` field in
 * opencode.json, which is evaluated synchronously by the engine before any
 * tool execution. This must be configured statically by the user.
 *
 * The plugin's role is to document this requirement and instruct the user
 * to add the permission block to their opencode.json.
 */

// No-op export kept for documentation and traceability to DES-2 / REQ-4..5
