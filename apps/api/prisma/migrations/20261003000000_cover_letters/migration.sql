-- Job-tailored cover letters. Same shape as resume_variants (grounded, cited,
-- fact-checked) but per-paragraph. Content wrapper `{content, audit}` matches
-- the slice-20 resume storage convention.

CREATE TABLE "cover_letters" (
    "id"           UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"       UUID           NOT NULL,
    "jobId"        UUID,
    "roleTarget"   TEXT           NOT NULL,
    "templateId"   TEXT           NOT NULL DEFAULT 'standard',
    "contentJson"  JSONB          NOT NULL,
    "factRefs"     TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "parentId"     UUID,
    "createdAt"    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cover_letters_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cover_letters_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE INDEX "cover_letters_user_created_idx"
    ON "cover_letters" ("userId", "createdAt" DESC);

CREATE INDEX "cover_letters_jobId_idx"
    ON "cover_letters" ("jobId");
