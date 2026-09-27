-- Extensions used across phases. Additive only.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Prisma shadow database for `migrate dev` (drift detection + squash).
-- Same extensions must exist here since the shadow DB replays every migration.
CREATE DATABASE careeros_shadow;
\connect careeros_shadow
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
