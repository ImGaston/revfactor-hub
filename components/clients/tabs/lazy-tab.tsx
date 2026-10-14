"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertCircle } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type LoadResult<T> = { data: T; error?: undefined } | { data?: undefined; error: string }

type State<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T }

/**
 * Loads a tab's data once, when the tab first mounts (the Financials Planning
 * pattern). `reload` refetches after a save.
 */
export function useLazyTabData<T>(load: () => Promise<LoadResult<T>>) {
  const [state, setState] = useState<State<T>>({ status: "loading" })
  const loadRef = useRef(load)
  useEffect(() => {
    loadRef.current = load
  }, [load])

  const run = useCallback(async () => {
    try {
      const result = await loadRef.current()
      if (result.error !== undefined) setState({ status: "error", error: result.error })
      else setState({ status: "ready", data: result.data as T })
    } catch {
      setState({ status: "error", error: "Couldn't load this tab. Try again." })
    }
  }, [])

  useEffect(() => {
    void run()
  }, [run])

  const reload = useCallback(() => {
    setState({ status: "loading" })
    void run()
  }, [run])

  /** Refetch in the background, keeping the current data on screen. */
  const refresh = useCallback(() => {
    void run()
  }, [run])

  return { state, reload, refresh }
}

export function TabError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertCircle className="size-4" />
      <AlertTitle>Couldn&apos;t load this tab</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{error}</span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </AlertDescription>
    </Alert>
  )
}

export function TabSkeleton({ variant = "list" }: { variant?: "list" | "cards" | "timeline" }) {
  if (variant === "timeline") {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
        <div className="space-y-3">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </div>
    )
  }
  if (variant === "cards") {
    return (
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Skeleton className="h-[420px] rounded-xl" />
        <div className="space-y-3">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <Skeleton className="h-9 w-64 rounded-full" />
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-10 rounded-md" />
      ))}
    </div>
  )
}
