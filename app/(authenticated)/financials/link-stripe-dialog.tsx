"use client"

import { useState } from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { linkStripeCustomer } from "./actions"

type ClientRef = { id: string; name: string; email: string | null; stripe_customer_id: string | null }

export function LinkStripeDialog({
  open,
  onOpenChange,
  stripeCustomerId,
  stripeCustomerEmail,
  stripeCustomerName,
  clients,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  stripeCustomerId: string
  stripeCustomerEmail: string | null
  stripeCustomerName: string | null
  clients: ClientRef[]
}) {
  const [selectedClientId, setSelectedClientId] = useState<string>("")
  const [comboboxOpen, setComboboxOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const selectedClient = clients.find((c) => c.id === selectedClientId)

  async function handleLink() {
    if (!selectedClientId) return
    setSaving(true)
    const result = await linkStripeCustomer(selectedClientId, stripeCustomerId)
    setSaving(false)
    if (result.error) {
      toast.error(result.error)
    } else {
      toast.success(`Linked ${selectedClient?.name ?? "client"} to Stripe customer`)
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link Stripe Customer</DialogTitle>
          <DialogDescription>
            Associate this Stripe customer with a Hub client.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Stripe customer info */}
          <div className="rounded-md border bg-muted/30 p-3 space-y-1">
            <p className="text-sm font-medium">{stripeCustomerName ?? "Unknown"}</p>
            <p className="text-sm text-muted-foreground">{stripeCustomerEmail ?? "No email"}</p>
            <p className="text-xs text-muted-foreground font-mono">{stripeCustomerId}</p>
          </div>

          {/* Client selector */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Select Hub Client</label>
            <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={comboboxOpen}
                  className="w-full justify-between"
                >
                  {selectedClient?.name ?? "Select a client..."}
                  <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[360px] p-0" align="start">
                <Command>
                  <CommandInput placeholder="Search clients..." />
                  <CommandList>
                    <CommandEmpty>No clients found.</CommandEmpty>
                    <CommandGroup>
                      {clients.map((client) => (
                        <CommandItem
                          key={client.id}
                          value={`${client.name} ${client.email ?? ""}`}
                          onSelect={() => {
                            setSelectedClientId(client.id)
                            setComboboxOpen(false)
                          }}
                        >
                          <Check
                            className={cn("mr-2 size-4", selectedClientId === client.id ? "opacity-100" : "opacity-0")}
                          />
                          <div>
                            <p className="text-sm">{client.name}</p>
                            {client.email && (
                              <p className="text-xs text-muted-foreground">{client.email}</p>
                            )}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleLink} disabled={!selectedClientId || saving}>
            {saving ? "Linking..." : "Link"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
