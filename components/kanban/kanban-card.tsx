"use client"

import { Archive, CheckCircle2, ChevronRight, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

type KanbanCardProps = {
  title: string
  description?: string | null
  badges?: { label: string; variant?: "default" | "secondary" | "outline"; color?: string }[]
  subtitle?: string | null
  meta?: { icon: React.ReactNode; label: string }[]
  accentColor?: string
  columns: { id: string; label: string }[]
  currentColumn: string
  onMoveToColumn: (columnId: string) => void
  onClick?: () => void
  onArchive?: () => void
  archiveLabel?: string
  onComplete?: () => void
  onDelete?: () => void
  statusIndicator?: React.ReactNode
}

export function KanbanCard({
  title,
  description,
  badges,
  subtitle,
  meta,
  accentColor,
  columns,
  currentColumn,
  onMoveToColumn,
  onClick,
  onArchive,
  archiveLabel = "Archive",
  onComplete,
  onDelete,
  statusIndicator,
}: KanbanCardProps) {
  const otherColumns = columns.filter((c) => c.id !== currentColumn)

  return (
    <div
      className="group w-full min-w-0 max-w-full overflow-hidden rounded-md border-l-[3px] border border-l-transparent bg-card p-3 text-sm shadow-sm transition-colors hover:bg-accent/30 cursor-grab active:cursor-grabbing [overflow-wrap:anywhere]"
      style={{ borderLeftColor: accentColor ?? "hsl(var(--border))" }}
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {statusIndicator}
          <p className="font-medium leading-tight break-words min-w-0">{title}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            {otherColumns.map((col) => (
              <DropdownMenuItem
                key={col.id}
                onClick={() => onMoveToColumn(col.id)}
              >
                Move to {col.label}
              </DropdownMenuItem>
            ))}
            {(onArchive || onComplete || onDelete) && <DropdownMenuSeparator />}
            {onComplete && (
              <DropdownMenuItem onClick={onComplete}>
                <CheckCircle2 className="mr-2 size-3.5" />
                Mark Complete
              </DropdownMenuItem>
            )}
            {onArchive && (
              <DropdownMenuItem onClick={onArchive}>
                <Archive className="mr-2 size-3.5" />
                {archiveLabel}
              </DropdownMenuItem>
            )}
            {onDelete && (
              <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                <Trash2 className="mr-2 size-3.5" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {description && (
        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground break-words">
          {description}
        </p>
      )}
      {subtitle && (
        <p className="mt-1.5 text-xs text-muted-foreground">{subtitle}</p>
      )}
      {(badges && badges.length > 0) || (meta && meta.length > 0) ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {badges?.map((b) => (
            <Badge
              key={b.label}
              variant={b.variant ?? "secondary"}
              className="text-[10px]"
              style={b.color ? { backgroundColor: b.color, color: "white", borderColor: b.color } : undefined}
            >
              {b.label}
            </Badge>
          ))}
          {meta?.map((m) => (
            <span key={m.label} className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
              {m.icon}
              {m.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
