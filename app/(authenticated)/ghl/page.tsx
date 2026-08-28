import { redirect } from "next/navigation"
import { Cable, ArrowLeftRight, Webhook } from "lucide-react"

import { hasPermission } from "@/lib/permissions.server"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

export default async function GhlPage() {
  if (!(await hasPermission("ghl", "view"))) redirect("/")

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GHL</h1>
        <p className="text-sm text-muted-foreground">
          Connection between GoHighLevel and the Hub.
        </p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Cable className="size-5 text-muted-foreground" />
            <CardTitle>GoHighLevel connection</CardTitle>
          </div>
          <CardDescription>
            This section will bridge GoHighLevel and the Hub. Scope is being
            defined — the sales pipeline now lives in GoHighLevel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-center gap-2">
              <ArrowLeftRight className="size-4" />
              Sync state between GHL and the Hub (contacts, opportunities,
              onboarding).
            </li>
            <li className="flex items-center gap-2">
              <Webhook className="size-4" />
              Monitor the GHL webhooks the Hub already receives (onboarding
              checkout / signup).
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
