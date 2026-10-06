"use client"

import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

export default function ChurnError({ reset }: { reset: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Churn tracker could not load</AlertTitle>
      <AlertDescription>
        Churn data is unavailable. Please try again or ask the team to check the
        tracker setup.{" "}
        <Button variant="outline" size="sm" onClick={reset}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}
