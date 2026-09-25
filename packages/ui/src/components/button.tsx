import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cn } from "@passlet/ui/lib/utils";

function Button({ className, ...props }: ButtonPrimitive.Props) {
	return (
		<ButtonPrimitive
			className={cn(
				"inline-flex h-9 shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-full bg-(--gray-a12) px-4 font-medium text-sm text-white outline-none transition-[opacity,scale,color] duration-150 ease-out hover:opacity-90 focus-visible:outline-2 focus-visible:outline-(--gray-a8) focus-visible:outline-offset-2 active:scale-[0.96] aria-disabled:cursor-default aria-disabled:text-white/50 aria-disabled:hover:opacity-100 aria-disabled:active:scale-100 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
				className
			)}
			data-slot="button"
			{...props}
		/>
	);
}

export { Button };
