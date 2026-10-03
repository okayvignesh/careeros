-- Extensions used across phases. Additive only.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";

-- GlitchTip error tracking (compose profile obs/ops) gets its own database so
-- its Django migrations never touch Career OS tables. Created for fresh
-- volumes only; an existing install can add it with:
--   docker compose exec postgres createdb -U "$POSTGRES_USER" glitchtip
CREATE DATABASE glitchtip;
\connect glitchtip
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
