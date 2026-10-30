interface Env {
  AUTH: Fetcher;
}

export default {
  async fetch(_request: Request, env: Env) {
    const upstream = await env.AUTH.fetch("https://auth.invalid/");
    return new Response(await upstream.text());
  },
};
