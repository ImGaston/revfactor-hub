"use client"

import { useState } from "react"
import { Check, ChevronsUpDown, type LucideIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type MultiSelectOption = {
  value: string
  label: string
  count?: number
}

// Faceted multi-select filter: a combobox trigger that opens a checklist.
// Empty `selected` means "no filter" (every row passes) — the trigger then
// shows `placeholder`. The popover stays open while toggling so several values
// can be picked in one go; "Clear" at the bottom resets to empty.
export function MultiSelectFilter({
  placeholder,
  title,
  icon: Icon,
  options,
  selected,
  onChange,
  searchable = false,
  searchPlaceholder = "Search…",
  emptyLabel = "No results.",
  className,
  contentClassName,
}: {
  // Trigger text when nothing is selected ("All origins")
  placeholder: string
  // Short noun used when several values are selected ("Origins" → "Origins · 3")
  title: string
  icon?: LucideIcon
  options: MultiSelectOption[]
  selected: string[]
  onChange: (values: string[]) => void
  searchable?: boolean
  searchPlaceholder?: string
  emptyLabel?: string
  className?: string
  contentClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const selectedSet = new Set(selected)

  function toggle(value: string) {
    const next = new Set(selectedSet)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    // Keep option order so the label is stable regardless of click order
    onChange(options.filter((o) => next.has(o.value)).map((o) => o.value))
  }

  const single =
    selected.length === 1
      ? options.find((o) => o.value === selected[0])?.label
      : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between font-normal", className)}
        >
          <div className="flex min-w-0 items-center gap-2">
            {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
            <span className="truncate">
              {selected.length === 0
                ? placeholder
                : selected.length === 1
                  ? (single ?? placeholder)
                  : title}
            </span>
            {selected.length > 1 && (
              <Badge variant="secondary" className="h-4 px-1.5 text-[11px]">
                {selected.length}
              </Badge>
            )}
          </div>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-[240px] p-0", contentClassName)} align="start">
        <Command>
          {searchable && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const checked = selectedSet.has(o.value)
                return (
                  <CommandItem
                    key={o.value}
                    // cmdk filters on `value`; use the label so search works
                    value={o.label}
                    onSelect={() => toggle(o.value)}
                    className="[&>svg:last-child]:hidden"
                  >
                    <div
                      aria-hidden
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-foreground/30 bg-input/50 [&_svg]:invisible"
                      )}
                    >
                      <Check className="size-3" />
                    </div>
                    <span className="truncate">{o.label}</span>
                    {o.count !== undefined && (
                      <span className="ml-auto text-xs font-normal tabular-nums text-muted-foreground">
                        {o.count}
                      </span>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.length > 0 && (
              <>
                {/* forceMount/alwaysRender keep the action visible while a
                    search term filters the list above it */}
                <CommandSeparator alwaysRender />
                <CommandGroup forceMount>
                  <CommandItem
                    value="__clear__"
                    forceMount
                    onSelect={() => onChange([])}
                    className="justify-center text-muted-foreground [&>svg:last-child]:hidden"
                  >
                    Clear
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
