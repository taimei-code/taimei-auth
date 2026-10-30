interface Env {
  M6_SECRET: string;
}

export default {
  async fetch(_request: Request, env: Env) {
    return new Response(`secret-length ${env.M6_SECRET.length}`);
  },
};
