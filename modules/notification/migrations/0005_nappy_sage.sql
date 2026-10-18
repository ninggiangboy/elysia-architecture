CREATE TABLE "notification"."inbox_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification"."notifications" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "notification"."notifications" SET "notified_at" = "created_at";--> statement-breakpoint
ALTER TABLE "notification"."notifications" ALTER COLUMN "notified_at" SET NOT NULL;