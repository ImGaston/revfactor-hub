import { redirect } from "next/navigation"

import { BreadcrumbSetter } from "@/components/layout/breadcrumb-context"
import { hasPermission } from "@/lib/permissions.server"
import { OnboardingStudy } from "./onboarding-study"

export default async function OnboardingStudyPage() {
  const canUseStudio = await hasPermission("agent_studio", "view")
  if (!canUseStudio) redirect("/")

  return (
    <>
      <BreadcrumbSetter segment="onboarding-study" label="Onboarding study" />
      <OnboardingStudy />
    </>
  )
}
