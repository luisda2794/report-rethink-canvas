import { Link } from "@tanstack/react-router";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

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
    <Link to={to} className="group block">
      <Card
        className={cn(
          "shadow-none flex flex-col gap-4 p-6 transition-colors",
          "hover:border-primary/50",
        )}
      >
        <div className="flex items-start justify-between">
          <Icon className="size-5 text-muted-foreground transition-colors group-hover:text-primary" strokeWidth={1.5} />
          <ArrowUpRight className="size-4 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" />
        </div>
        <div>
          <h2 className="font-semibold text-[15px] tracking-tight">
            {title}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground leading-snug">
            {description}
          </p>
        </div>
      </Card>
    </Link>
  );
}
