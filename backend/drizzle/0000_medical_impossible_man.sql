CREATE TABLE "tb_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"title" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tb_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tb_conversations" ADD CONSTRAINT "tb_conversations_user_id_tb_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."tb_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tb_messages" ADD CONSTRAINT "tb_messages_conversation_id_tb_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."tb_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tb_conversations_user_id_updated_at_idx" ON "tb_conversations" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "tb_messages_conversation_id_idx" ON "tb_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tb_users_username_idx" ON "tb_users" USING btree ("username");