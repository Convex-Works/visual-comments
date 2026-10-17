// Limits shared by the browser and the server.

/** Per image. A proxy in front of the server must allow request bodies this large. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_IMAGES = 6;
/** No SVG: it can carry script. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_BODY = 5000;
/** Context entries a thread keeps, and the length of each value. */
export const MAX_CONTEXT = 20;
export const MAX_CONTEXT_VALUE = 200;
