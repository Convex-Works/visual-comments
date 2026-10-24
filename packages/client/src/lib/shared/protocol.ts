// How a site's server talks to the comment server.

/** The header with who is signed in on the site: their `Viewer` as base64url-encoded JSON. */
export const USER_HEADER = 'visual-comments-user';

/** The header with an agent's token, passed on by the site's server instead of `USER_HEADER`. */
export const AGENT_HEADER = 'visual-comments-agent';

/** Agent tokens start with this, so the site's server can tell them from other bearer tokens. */
export const AGENT_TOKEN_PREFIX = 'vca_';
