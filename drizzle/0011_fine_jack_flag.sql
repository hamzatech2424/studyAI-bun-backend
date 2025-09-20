ALTER TABLE "users" RENAME COLUMN "full_name" TO "first_name";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_name" varchar(255);