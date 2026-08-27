import { cn } from "../../../lib/utils";
import type { IntelligenceOverlapDto } from "../../../../shared/ipc/schemas";

type Risk = IntelligenceOverlapDto["risk"];

const styles: Record<Risk, string> = {
	high: "bg-red-500/10 text-red-400",
	medium: "bg-amber-500/10 text-amber-400",
	low: "bg-sky-500/10 text-sky-400",
};

export const RiskBadge = ({
	risk,
	className,
}: {
	risk: Risk;
	className?: string;
}) => (
	<span
		className={cn(
			"inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider",
			styles[risk],
			className,
		)}
	>
		{risk[0].toUpperCase() + risk.slice(1)}
	</span>
);
