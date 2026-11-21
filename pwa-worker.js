/**
 * Assets-only PWA Worker. Cloudflare Workers Builds requires an explicit
 * entry-point in some dashboard configurations; requests are served from dist/.
 */
const HOSTED_PWA_ORIGIN = 'https://sns-providers.sunpotflower4460.workers.dev';
const HOSTED_API_ORIGIN = 'https://social-mission-api.sunpotflower4460.workers.dev';
const LOCAL_ONLY_CONNECT = "connect-src 'self';";

export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    if (new URL(request.url).origin !== HOSTED_PWA_ORIGIN
      || !response.ok || !response.headers.get('content-type')?.includes('text/html')) return response;

    return new HTMLRewriter()
      .on('meta[http-equiv="Content-Security-Policy"]', {
        element(element) {
          const policy = element.getAttribute('content');
          if (!policy?.includes(LOCAL_ONLY_CONNECT)) return;
          element.setAttribute('content', policy.replace(LOCAL_ONLY_CONNECT, `connect-src 'self' ${HOSTED_API_ORIGIN};`));
          element.after(`<meta name="social-mission-api-origin" content="${HOSTED_API_ORIGIN}">`, { html: true });
        },
      })
      .transform(response);
  },
};
