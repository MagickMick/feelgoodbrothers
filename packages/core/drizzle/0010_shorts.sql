CREATE TABLE "shorts" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_id" integer NOT NULL,
	"locale" "locale" NOT NULL,
	"storyboard" jsonb NOT NULL,
	"assets" jsonb NOT NULL,
	"error" text,
	"busy_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shorts" ADD CONSTRAINT "shorts_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shorts_post_idx" ON "shorts" USING btree ("post_id");