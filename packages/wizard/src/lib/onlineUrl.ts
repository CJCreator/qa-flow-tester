/**
 * The shared online copy (the full app on a free host), when one is published. Set VITE_ONLINE_APP_URL
 * when building; without it the page doesn't offer it. Kept apart from workflow.ts, which bundles the
 * workflow template, so the landing page doesn't carry it.
 */
export const ONLINE_APP_URL: string | null = (import.meta.env.VITE_ONLINE_APP_URL as string | undefined)?.trim() || null;
