import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@passlet/ui/lib/utils";

function Button({ className, ...props }: ButtonPrimitive.Props) {
	return (
		<ButtonPrimitive
			className={cn(
				"inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent bg-primary bg-clip-padding px-2.5 font-medium text-primary-foreground text-sm outline-none transition-colors select-none hover:bg-primary/80 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-slot="button"
			{...props}
		/>
	);
}

export { Button };
