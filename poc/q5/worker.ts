import { DurableObject } from "cloudflare:workers";

export class First extends DurableObject {
  async fetch(): Promise<Response> {
    return new Response("first");
  }
}

export class Second extends DurableObject {
  async fetch(): Promise<Response> {
    return new Response("second");
  }
}

export default {
  async fetch(): Promise<Response> {
    return new Response("poc");
  },
};
