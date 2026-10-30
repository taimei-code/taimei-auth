export default {
  async fetch(request, env) {
    const res = await env.AUTH.fetch("https://auth/");
    return new Response("app -> " + (await res.text()));
  },
};
