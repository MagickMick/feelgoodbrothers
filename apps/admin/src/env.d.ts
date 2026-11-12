/// <reference path="../.astro/types.d.ts" />

declare namespace App {
  interface Locals {
    user: import("@fgb/core/schema").AdminUser | null;
  }
}
