CREATE TABLE "notification"."mail_quota" (
	"key" text NOT NULL,
	"day" date NOT NULL,
	"sent" integer NOT NULL,
	CONSTRAINT "mail_quota_key_day_pk" PRIMARY KEY("key","day")
);
--> statement-breakpoint
CREATE TABLE "notification"."rate_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"tokens" double precision NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
