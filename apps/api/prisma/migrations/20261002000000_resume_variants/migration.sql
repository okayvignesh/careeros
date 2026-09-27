-- Job-tailored resume variants. Content is structured JSON (summary + sections
-- + bullets with factRefs). `jobId` is nullable so a variant survives its
-- originating job row. `factRefs` on the top-level row is the union of every
-- bullet's cited fact IDs — cheap grounded-audit surface.

CREATE TABLE "resume_variants" (
    "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"       UUID           NOT NULL,
    "jobId"        UUID,
    "roleTarget"   TEXT           NOT NULL,
    "templateId"   TEXT           NOT NULL DEFAULT 'ats-first',
    "contentJson"  JSONB          NOT NULL,
    "factRefs"     TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "parentId"     UUID,
    "createdAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "resume_variants_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "resume_variants_user_created_idx"
    ON "resume_variants" ("userId", "createdAt" DESC);

CREATE INDEX "resume_variants_jobId_idx"
    ON "resume_variants" ("jobId");
