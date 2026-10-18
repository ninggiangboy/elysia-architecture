CREATE SCHEMA "realtime";
--> statement-breakpoint
CREATE TABLE "realtime"."events" (
	"seq" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "realtime"."events_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "events_user_seq_idx" ON "realtime"."events" USING btree ("user_id","seq");--> statement-breakpoint
CREATE INDEX "events_created_at_idx" ON "realtime"."events" USING btree ("created_at");