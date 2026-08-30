/**
 * Assets-only PWA Worker. Cloudflare Workers Builds requires an explicit
 * entry-point in some dashboard configurations; requests are served from dist/.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
