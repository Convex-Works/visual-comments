import { clamp, MAGNET, targetAt, type CommentTarget } from './target.js';
import { clientToDoc, docBoxToSurface, fromClient, type Surface } from './surfaces.js';
import type { Box } from './target.js';

/** Where the pointer is aiming in comment mode. */
export interface Aim {
	surface: string;
	/** Where a pin would go, in surface pixels: the pointer, moved onto the target if it is pulled to one. */
	x: number;
	y: number;
	/** The pointer itself, in surface pixels. */
	point: { x: number; y: number };
	/** In the surface's document. */
	target?: CommentTarget;
	/** The target's box in surface pixels when it was aimed at. */
	targetBox?: Box;
}

/** Where a pin goes for a pointer at a client point. With `free`, or without a document, it stays at the pointer. */
export function aimAt(surface: Surface, x: number, y: number, free: boolean): Aim {
	const point = fromClient(surface, x, y);
	const plain = { surface: surface.id, x: point.x, y: point.y, point };
	if (free || !surface.doc) return plain;
	const d = clientToDoc(surface, x, y);
	const target = targetAt(surface.doc, d.x, d.y, MAGNET / surface.docScale, surface.search);
	if (!target) return plain;
	const box = docBoxToSurface(surface, target.box);
	return {
		...plain,
		x: clamp(point.x, box.x + 1, box.x + box.width - 1),
		y: clamp(point.y, box.y + 1, box.y + box.height - 1),
		target,
		targetBox: box
	};
}
