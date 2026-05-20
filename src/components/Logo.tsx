import Image from "next/image";

/**
 * Two logo variants — both use the official SVG so they render crisp at any size.
 *
 * <Logo full />     → "WE LABEL WINE / NOT PEOPLE" stamp + "TULIP WINERY" wordmark.
 *                     Use on auth screens and large hero spots.
 * <Logo />          → compact wordmark (text-only, no stamp). Use in headers.
 */
export default function Logo({
  full = false,
  className = "",
  size = full ? 120 : 28,
}: {
  full?: boolean;
  className?: string;
  size?: number;
}) {
  if (full) {
    return (
      <Image
        src="/brand/tulip-full.svg"
        alt="Tulip Winery"
        width={size}
        height={size}
        priority
        className={className}
      />
    );
  }
  return (
    <div className={`inline-flex items-baseline gap-2 ${className}`}>
      <span className="font-serif text-2xl font-medium tracking-tight text-tulip-ink leading-none">
        TULIP
      </span>
      <span className="brandmark text-[10px] text-tulip-muted">
        Winery · CRM
      </span>
    </div>
  );
}
