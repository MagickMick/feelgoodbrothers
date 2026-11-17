CREATE TABLE IF NOT EXISTS "seed_markers" (
	"key" text PRIMARY KEY NOT NULL,
	"seeded_at" timestamp with time zone DEFAULT now() NOT NULL
);
