/**
 * Host half of the local sidebar-notes bundle.
 *
 * The notepad lives entirely in the browser half (client.js): the sidebar icon,
 * the Markdown panel and its local persistence are all Client-side. This Host
 * half exists so the bundle owns a regular row in the profile's plugin layer —
 * it registers no services, tools or events.
 */
export const name = 'sidebar-notes'

export function apply() {}
