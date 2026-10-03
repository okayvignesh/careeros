-- D.3 (Wave D / P3.5): the desktop agent reports its OS at pair/complete
-- (`process.platform`: darwin | win32 | linux) so Settings -> Devices can
-- show platform next to each paired device. Nullable: devices paired before
-- this column render as "Unknown" rather than being backfilled with a guess.
ALTER TABLE "agent_devices" ADD COLUMN "platform" TEXT;
