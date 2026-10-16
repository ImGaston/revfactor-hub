import { redirect } from "next/navigation"

// Agent Studio (runs, playground, coach) was folded into RevAI on 2026-10-16.
export default function AgentStudioRedirect() {
  redirect("/revai")
}
