import { Link } from "@tanstack/react-router";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

export function ReportCard({
  to,
  icon: Icon,
  title,
  description,
}: {
  to: string;
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group relative flex flex-col gap-4 p-6 bg-surface border border-hairline rounded-lg transition-colors hover:border-ink/20"
    >
      <span className="absolute inset-x-6 top-0 h-px origin-left scale-x-0 bg-[#F5E100] transition-transform duration-300 group-hover:scale-x-100" />
      <div className="flex items-start justify-between">
        <Icon className="size-5 text-ink/60 transition-colors group-hover:text-ink" strokeWidth={1.5} />
        <ArrowUpRight className="size-4 text-muted-text opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
      </div>
      <div>
        <h2 className="font-syne font-semibold text-ink text-[15px] tracking-tight">
          {title}
        </h2>
        <p className="mt-1.5 text-muted-text text-[13px] leading-snug">
          {description}
        </p>
      </div>
    </Link>
  );
}
