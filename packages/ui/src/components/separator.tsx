"use client";

import { Separator as SeparatorPrimitive } from "@base-ui/react/separator";

import { cn } from "@passlet/ui/lib/utils";

function Separator({
	className,
	orientation = "horizontal",
	...props
}: SeparatorPrimitive.Props) {
	return (
		<SeparatorPrimitive
			className={cn(
				"shrink-0 bg-(--gray-a4) data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
				className
			)}
			data-slot="separator"
			orientation={orientation}
			{...props}
		/>
	);
}

export { Separator };
