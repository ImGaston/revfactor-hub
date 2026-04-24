"use client"

import { useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { createClientFromStripeCustomer } from "./actions"

export function CreateClientFromStripeDialog({
  open,
  onOpenChange,
  stripeCustomerId,
  defaultName,
  defaultEmail,
  assemblyConfigured,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stripeCustomerId: string
  defaultName: string
  defaultEmail: string
  assemblyConfigured: boolean
}) {
  const [name, setName] = useState(defaultName)
  const [email, setEmail] = useState(defaultEmail)
  const [alsoAssembly, setAlsoAssembly] = useState(assemblyConfigured)
  const [saving, setSaving] = useState(false)

  async function handleCreate() {
    if (!name.trim() || !email.trim()) {
      toast.error("Name and email are required")
      return
    }
    setSaving(true)
    const result = await createClientFromStripeCustomer({
      stripeCustomerId,
      name: name.trim(),
      email: email.trim(),
      alsoCreateAssembly: alsoAssembly,
    })
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(
        alsoAssembly && result.assemblyClientId
          ? "Client created in Hub + Assembly"
          : "Client created in Hub",
      )
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Client from Stripe</DialogTitle>
          <DialogDescription>
            Creates a Hub client (status: onboarding) and links this Stripe customer to it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <p className="text-xs text-muted-foreground">Stripe customer ID</p>
            <p className="text-xs font-mono">{stripeCustomerId}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client-name">Name</Label>
            <Input
              id="client-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Client name"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client-email">Email</Label>
            <Input
              id="client-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@domain.com"
            />
          </div>

          <div className="flex items-start gap-2 pt-2">
            <Checkbox
              id="also-assembly"
              checked={alsoAssembly}
              onCheckedChange={(v) => setAlsoAssembly(v === true)}
              disabled={!assemblyConfigured}
            />
            <div className="grid gap-0.5">
              <Label
                htmlFor="also-assembly"
                className={!assemblyConfigured ? "text-muted-foreground" : ""}
              >
                Also create in Assembly
              </Label>
              <p className="text-xs text-muted-foreground">
                {assemblyConfigured
                  ? "Sends a portal invite to the client and links the Hub record."
                  : "Assembly is not configured."}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={saving || !name.trim() || !email.trim()}>
            {saving ? "Creating..." : "Create Client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
