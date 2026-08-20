import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "relative overflow-hidden rounded-2xl bg-foreground/6 after:absolute after:inset-0 after:-translate-x-full after:animate-[shimmer_1.6s_var(--ease-smooth)_infinite] after:bg-gradient-to-r after:from-transparent after:via-foreground/10 after:to-transparent motion-reduce:animate-pulse motion-reduce:after:hidden",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
