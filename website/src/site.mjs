// @ts-check
/**
 * Site-wide constants, in one place.
 *
 * Plain .mjs rather than .ts because astro.config.mjs imports it too, and the
 * config is loaded before any TypeScript tooling is in play.
 */

export const SITE_URL = 'https://hallway.edspencer.net';
export const REPO_URL = 'https://github.com/edspencer/hallway';
export const TITLE = 'Hallway';
export const TAGLINE = 'The front door for everything you vibe-coded on a random port';

/**
 * The port Hallway's daemon serves its dashboard on by default.
 *
 * 4255 spells "HALL" on a phone keypad (D20 in docs/09-decisions.md). This is a
 * copy of DEFAULT_PORT in the app's server/port.ts, as on Local
 * Review's site: Cloudflare builds with website/ as its root, so it can't be
 * imported from there. MDX prose can import it; code blocks can't interpolate,
 * so Markdown pages write the number out.
 */
export const DEFAULT_PORT = 4255;
export const LOCAL_URL = `http://localhost:${DEFAULT_PORT}`;

/**
 * The published install command (Hallway 0.1.0, milestone v0, is on npm).
 * Shown by the landing page (copy.ts); getting-started/installation.md and
 * quickstart.md write it out in code blocks, so change those too if it changes.
 */
export const INSTALL_COMMAND = 'npm i -g hallway';

/**
 * PostHog, OFF unless a key is supplied at build time.
 *
 * Nothing analytics-related loads at all unless PUBLIC_POSTHOG_KEY is set in the
 * build environment (Cloudflare Pages → Settings → Variables). With it unset the
 * snippet below is never emitted, on the docs pages or the landing page.
 *
 * `api_host` is our own /ingest path, proxied to PostHog's US cloud by
 * functions/ingest/[[path]].ts, so requests are same-origin and survive tracker
 * blocklists. Change the region in one and you must change it in the other.
 *
 * @param {string | undefined} key
 * @returns {string | null} the inline script body, or null when analytics is off
 */
export function posthogSnippet(key) {
	if (!key) return null;
	// Verbatim from PostHog's install snippet (a minified stub that queues calls
	// until array.js loads). Vendor code: do not hand-maintain it.
	const stub = `!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group identify setPersonProperties setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags resetGroups onFeatureFlags addFeatureFlagsHandler onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);`;
	const config = {
		api_host: `${SITE_URL}/ingest`,
		ui_host: 'https://us.posthog.com',
		person_profiles: 'identified_only',
	};
	return `${stub}posthog.init(${JSON.stringify(key)},${JSON.stringify(config)});`;
}
