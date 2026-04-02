"use client"

import { createContext, useContext, useState, useCallback, useEffect } from "react"

type BreadcrumbOverrides = Record<string, string>

const BreadcrumbContext = createContext<{
  overrides: BreadcrumbOverrides
  setOverride: (segment: string, label: string) => void
}>({
  overrides: {},
  setOverride: () => {},
})

export function BreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const [overrides, setOverrides] = useState<BreadcrumbOverrides>({})

  const setOverride = useCallback((segment: string, label: string) => {
    setOverrides((prev) => {
      if (prev[segment] === label) return prev
      return { ...prev, [segment]: label }
    })
  }, [])

  return (
    <BreadcrumbContext.Provider value={{ overrides, setOverride }}>
      {children}
    </BreadcrumbContext.Provider>
  )
}

export function useBreadcrumbOverrides() {
  return useContext(BreadcrumbContext)
}

export function BreadcrumbSetter({ segment, label }: { segment: string; label: string }) {
  const { setOverride } = useBreadcrumbOverrides()

  useEffect(() => {
    setOverride(segment, label)
  }, [segment, label, setOverride])

  return null
}
