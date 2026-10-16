CREATE SCHEMA "notification";
--> statement-breakpoint
CREATE TABLE "notification"."inbox" (
	"message_id" uuid NOT NULL,
	"handler" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_message_id_handler_pk" PRIMARY KEY("message_id","handler")
);
