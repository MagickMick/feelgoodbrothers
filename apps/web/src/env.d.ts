/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare namespace App {
  interface Locals {
    /**
     * Set by pages whose translated URL can't be derived from the path
     * (blog posts, categories, authors). Used by the language switcher and hreflang tags.
     * A locale that is missing means "no translation available".
     */
    alternates?: Partial<Record<"en" | "nl", string>>;
  }
}
