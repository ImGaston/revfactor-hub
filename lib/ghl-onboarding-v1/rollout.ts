/** Pilot enrollment is an exact server-side contact allowlist, never a URL flag. */
export function assertRolloutContact(
  contactId: string,
  env: Record<string, string | undefined> = process.env
) {
  const mode = env.GHL_V1_ROLLOUT_MODE ?? "pilot"
  if (mode === "live") return
  if (mode !== "pilot") throw new Error("rollout_configuration_invalid")
  const allowed = (env.GHL_V1_PILOT_CONTACT_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  if (!allowed.length || !allowed.includes(contactId))
    throw new Error("pilot_contact_not_allowed")
}
