CREATE TABLE `vision_files` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`file_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_owner_id` ON `vision_files` (`owner`,`file_id`);--> statement-breakpoint
CREATE TABLE `vision_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner` text NOT NULL,
	`event_id` text NOT NULL,
	`kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`payload` text NOT NULL,
	`hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`received_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_owner_id` ON `vision_events` (`owner`,`event_id`);--> statement-breakpoint
CREATE INDEX `event_owner_seq` ON `vision_events` (`owner`,`seq`);--> statement-breakpoint
CREATE TABLE `vision_locks` (
	`owner` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `vision_postings` (
	`key` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`record_id` text NOT NULL,
	`kind` text NOT NULL,
	`hash` text NOT NULL,
	`status` text NOT NULL,
	`result` text,
	`updated_at` integer NOT NULL
);
