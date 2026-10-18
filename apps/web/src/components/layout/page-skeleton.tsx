import { Skeleton } from '@kit/ui'

/** What a settings-style page (a header, then `sections` blocks like `Section`) looks like while it loads. */
export function PageSkeleton({ label, sections = 2 }: { label: string; sections?: number }) {
  return (
    <div role="status" className="flex flex-col gap-8" aria-busy="true" aria-label={label}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {Array.from({ length: sections }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: placeholders with no identity
        <div key={i} className="grid gap-4 border-t border-border pt-8 md:grid-cols-3 md:gap-10">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
          <Skeleton className="h-32 rounded-xl md:col-span-2" />
        </div>
      ))}
    </div>
  )
}
