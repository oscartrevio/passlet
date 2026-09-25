"use client";

import {
	type LegacyAnimationControls,
	useAnimationControls,
	useReducedMotion,
} from "motion/react";
import { type MouseEvent, useEffect, useRef, useState } from "react";

// Tap the pass and it tips toward your finger and wobbles, a little harder
// each time. Keep tapping and it flips over to show its back; tap the back
// to flip it home. Same shape as the Lisse heading easter egg
// (github.com/JaceThings/Lisse, LisseDetach.tsx): a tap counter that resets
// when idle and a wobble whose strength grows with the count.
const THRESHOLD = 8;
const IDLE_RESET_MS = 1500;

const WOBBLE_MAX_ROT_DEG = 3;
const WOBBLE_MAX_TRANS_PX = 4;
const PRESS_TILT_DEG = 10;
const WOBBLE_DURATION_S = 0.4;

const FLIP_SPRING = { type: "spring", stiffness: 160, damping: 19 } as const;
const FLIP_LIFT_S = 0.6;

export function usePassEasterEgg({
	wobble,
	playSound,
}: {
	wobble: LegacyAnimationControls;
	playSound: (name: string) => void;
}) {
	const reduced = useReducedMotion();
	const flip = useAnimationControls();
	const [flipped, setFlipped] = useState(false);
	const countRef = useRef(0);
	const resetTimerRef = useRef<number>(undefined);

	useEffect(() => () => clearTimeout(resetTimerRef.current), []);

	const turn = (toBack: boolean) => {
		clearTimeout(resetTimerRef.current);
		countRef.current = 0;
		setFlipped(toBack);
		playSound(toBack ? "expand" : "collapse");
		flip.start({
			rotateY: toBack ? 180 : 0,
			scale: [1, 1.06, 1],
			transition: {
				rotateY: FLIP_SPRING,
				scale: { duration: FLIP_LIFT_S, ease: "easeInOut" },
			},
		});
	};

	const handleTap = (e: MouseEvent<HTMLElement>) => {
		// The name field (and its label) is for typing, not tapping.
		const inField =
			e.target instanceof Element && e.target.closest("input, label");
		if (reduced || inField) {
			return;
		}
		if (flipped) {
			turn(false);
			return;
		}

		const next = countRef.current + 1;
		countRef.current = next;
		clearTimeout(resetTimerRef.current);
		resetTimerRef.current = window.setTimeout(() => {
			countRef.current = 0;
		}, IDLE_RESET_MS);

		if (next >= THRESHOLD) {
			turn(true);
			return;
		}

		// Tip the pass toward the tap point, as if pressing on a real card,
		// and shake it harder as the count climbs.
		const box = e.currentTarget.getBoundingClientRect();
		const dx = (e.clientX - box.left) / box.width - 0.5;
		const dy = (e.clientY - box.top) / box.height - 0.5;
		// Eased 0→1 strength: the first taps are gentle, the last ones shake.
		const t = (next / THRESHOLD) ** 0.6;
		const angle = 0.5 + (WOBBLE_MAX_ROT_DEG - 0.5) * t;
		const shift = 0.5 + (WOBBLE_MAX_TRANS_PX - 0.5) * t;
		playSound("tap");
		wobble.start({
			rotateX: [0, -dy * PRESS_TILT_DEG, 0],
			rotateY: [0, dx * PRESS_TILT_DEG, 0],
			rotate: [0, angle, -angle, angle * 0.6, 0],
			x: [0, shift, -shift, 0],
			transition: { duration: WOBBLE_DURATION_S, ease: "easeOut" },
		});
	};

	return { flip, flipped, handleTap };
}
