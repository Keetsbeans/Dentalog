CREATE TABLE `clinic_images` (
	`clinic_id` text NOT NULL,
	`key` text NOT NULL,
	`content_type` text NOT NULL,
	`data` blob NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`clinic_id`) REFERENCES `clinics`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinic_images_pk` ON `clinic_images` (`clinic_id`,`key`);