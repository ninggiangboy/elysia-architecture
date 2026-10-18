CREATE TABLE "identity"."invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identity"."mfa_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "mfa_challenges_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."password_resets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"requested_ip" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "password_resets_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "recovery_codes_user_code_unique" UNIQUE("user_id","code_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."sign_in_failures" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"method" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity"."signups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"code_hash" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"email_proven_at" timestamp with time zone,
	"method" text NOT NULL,
	"password_hash" text,
	"display_name" text,
	"terms_version" text,
	"locale" text NOT NULL,
	"oauth_provider" text,
	"oauth_provider_user_id" text,
	"oauth_email" text,
	"requested_ip" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "signups_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."totp_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"secret_ciphertext" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_step" bigint,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."magic_links" ADD COLUMN "code_hash" text;--> statement-breakpoint
ALTER TABLE "identity"."magic_links" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "password_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "terms_version" text;--> statement-breakpoint
ALTER TABLE "identity"."users" ADD COLUMN "terms_accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "identity"."invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."totp_credentials" ADD CONSTRAINT "totp_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "identity"."invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "invitations_inviter_created_idx" ON "identity"."invitations" USING btree ("invited_by","created_at");--> statement-breakpoint
CREATE INDEX "mfa_challenges_expires_idx" ON "identity"."mfa_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "password_resets_email_created_idx" ON "identity"."password_resets" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "password_resets_ip_created_idx" ON "identity"."password_resets" USING btree ("requested_ip","created_at");--> statement-breakpoint
CREATE INDEX "sign_in_failures_email_created_idx" ON "identity"."sign_in_failures" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "sign_in_failures_ip_created_idx" ON "identity"."sign_in_failures" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "signups_email_created_idx" ON "identity"."signups" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "signups_ip_created_idx" ON "identity"."signups" USING btree ("requested_ip","created_at");--> statement-breakpoint
CREATE INDEX "signups_expires_idx" ON "identity"."signups" USING btree ("expires_at");