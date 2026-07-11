/// <reference types="astro/client" />

interface Env {
  CACHE: import('@cloudflare/workers-types').KVNamespace;
  SESSION: import('@cloudflare/workers-types').KVNamespace;
  DB: import('@cloudflare/workers-types').D1Database;
}

declare namespace App {
  interface Locals {
    runtime: {
      env: Env;
      cf: any;
      caches: any;
      ctx: any;
    };
  }
}
