"use client"

import { ClientStepperCard } from "./client-stepper-card"
import { ResourceCard } from "./resource-card"
import type {
  OnboardingTemplate,
  OnboardingProgress,
  OnboardingResource,
} from "@/lib/types"

type ClientRow = {
  id: string
  name: string
  email: string | null
  status: string
}

type Props = {
  clients: ClientRow[]
  templates: OnboardingTemplate[]
  progress: OnboardingProgress[]
  resources: OnboardingResource[]
}

export function OnboardingView({
  clients,
  templates,
  progress,
  resources,
}: Props) {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Onboarding</h1>
        <p className="mt-1 text-muted-foreground">
          {clients.length === 0
            ? "No clients currently onboarding."
            : `${clients.length} client${clients.length === 1 ? "" : "s"} in onboarding`}
        </p>
      </div>

      {/* Client stepper cards */}
      {clients.length > 0 && templates.length > 0 && (
        <div className="space-y-4">
          {clients.map((client) => {
            const clientProgress = progress.filter(
              (p) => p.client_id === client.id
            )
            return (
              <ClientStepperCard
                key={client.id}
                client={client}
                templates={templates}
                progress={clientProgress}
              />
            )
          })}
        </div>
      )}

      {clients.length > 0 && templates.length === 0 && (
        <div className="rounded-md border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No onboarding steps configured. Go to Settings &rarr; Onboarding to
            create steps.
          </p>
        </div>
      )}

      {/* Resources */}
      {resources.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Resources</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {resources.map((resource) => (
              <ResourceCard key={resource.id} resource={resource} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
