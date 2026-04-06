"use client"

import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { OnboardingResource } from "@/lib/types"

type Props = {
  resource: OnboardingResource
}

export function ResourceCard({ resource }: Props) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="text-2xl mb-1">{resource.icon}</div>
        <CardTitle className="text-sm">{resource.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex-1 flex flex-col justify-between gap-3">
        {resource.description && (
          <p className="text-xs text-muted-foreground">
            {resource.description}
          </p>
        )}
        {resource.url && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 w-fit"
            asChild
          >
            <a href={resource.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-3" />
              Open
            </a>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
