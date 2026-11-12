CREATE TYPE "public"."post_kind" AS ENUM('team', 'guest');--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "kind" "post_kind" DEFAULT 'team' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "guest_name" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "guest_email" text;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "guest_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "guest_note" text;--> statement-breakpoint
CREATE INDEX "posts_kind_idx" ON "posts" USING btree ("kind");--> statement-breakpoint
ALTER TABLE "authors" DROP COLUMN "is_guest";