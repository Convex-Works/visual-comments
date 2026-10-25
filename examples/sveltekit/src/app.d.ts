declare global {
	namespace App {
		interface Locals {
			/** Set by the sign-in; the comments write as this person. */
			user?: import('@convex-works/sign-in').User | null;
		}
	}
}

export {};
