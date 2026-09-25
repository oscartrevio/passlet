"use client";

import {
	type LegacyAnimationControls,
	useAnimationControls,
	useReducedMotion,
} from "motion/react";
import { type MouseEvent, useEffect, useRef, useState } from "react";

// Tap the pass and it tips toward your finger like a real card. Keep going and
// it starts to wobble, harder each time, until it flips over to show its back;
// tap the back to flip it home. Same shape and numbers as the Lisse heading
// easter egg (github.com/JaceThings/Lisse, LisseDetach.tsx): 22 taps, a wobble
// from tap 8, and a counter that decays when you stop tapping.
const THRESHOLD = 22;
const WOBBLE_START = 8;
const IDLE_GRACE_MS = 1500;
const DECAY_INTERVAL_MS = 800;
const HARD_RESET_MS = 8000;

const WOBBLE_MAX_ROT_DEG = 2.5;
const WOBBLE_MAX_TRANS_PX = 3;
const PRESS_TILT_DEG = 8;
const WOBBLE_DURATION_S = 0.4;

const FLIP_SPRING = { type: "spring", stiffness: 160, damping: 19 } as const;
const FLIP_LIFT_S = 0.6;
// Once flipped, the back ignores taps until you have stopped tapping for this
// long. Each ignored tap restarts the wait, so spamming through the flip can
// never flip it straight back; the next deliberate tap does.
const QUIET_BEFORE_FLIP_BACK_MS = 700;

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
	const decayTimerRef = useRef<number>(undefined);
	const resetTimerRef = useRef<number>(undefined);
	const quietTimerRef = useRef<number>(undefined);
	const canFlipBackRef = useRef(false);

	const stopDecay = () => {
		clearTimeout(decayTimerRef.current);
		clearTimeout(resetTimerRef.current);
	};

	useEffect(
		() => () => {
			clearTimeout(decayTimerRef.current);
			clearTimeout(resetTimerRef.current);
			clearTimeout(quietTimerRef.current);
		},
		[]
	);

	const waitForQuiet = () => {
		canFlipBackRef.current = false;
		clearTimeout(quietTimerRef.current);
		quietTimerRef.current = window.setTimeout(() => {
			canFlipBackRef.current = true;
		}, QUIET_BEFORE_FLIP_BACK_MS);
	};

	// After 1.5 s idle the count drops by one every 0.8 s, and after 8 s it
	// starts over, so a short pause keeps your progress but walking away doesn't.
	const scheduleDecay = () => {
		stopDecay();
		const tickDown = () => {
			countRef.current = Math.max(0, countRef.current - 1);
			if (countRef.current > 0) {
				decayTimerRef.current = window.setTimeout(tickDown, DECAY_INTERVAL_MS);
			}
		};
		decayTimerRef.current = window.setTimeout(tickDown, IDLE_GRACE_MS);
		resetTimerRef.current = window.setTimeout(() => {
			countRef.current = 0;
			stopDecay();
		}, HARD_RESET_MS);
	};

	const turn = (toBack: boolean) => {
		stopDecay();
		countRef.current = 0;
		setFlipped(toBack);
		if (toBack) {
			waitForQuiet();
		}
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
			if (canFlipBackRef.current) {
				turn(false);
			} else {
				waitForQuiet();
			}
			return;
		}

		const next = countRef.current + 1;
		countRef.current = next;
		scheduleDecay();

		if (next >= THRESHOLD) {
			turn(true);
			return;
		}

		// Every tap tips the pass toward the tap point, as if pressing on a real
		// card. From WOBBLE_START it also shakes, harder as the count climbs.
		const box = e.currentTarget.getBoundingClientRect();
		const dx = (e.clientX - box.left) / box.width - 0.5;
		const dy = (e.clientY - box.top) / box.height - 0.5;
		// Shake strength eases in from 0 at WOBBLE_START to 1 at THRESHOLD.
		const shaking = next >= WOBBLE_START;
		const t = ((next - WOBBLE_START) / (THRESHOLD - WOBBLE_START)) ** 0.6;
		const angle = shaking ? 0.4 + (WOBBLE_MAX_ROT_DEG - 0.4) * t : 0;
		const shift = shaking ? 0.3 + (WOBBLE_MAX_TRANS_PX - 0.3) * t : 0;
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
