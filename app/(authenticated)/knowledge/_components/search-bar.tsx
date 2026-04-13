"use client"

import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"

type SearchBarProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

export function SearchBar({
  value,
  onChange,
  placeholder = "Search articles...",
}: SearchBarProps) {
  const [local, setLocal] = useState(value)
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setLocal(value)
  }, [value])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setLocal(v)
    clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => onChange(v), 300)
  }

  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        className="pl-9"
      />
    </div>
  )
}
