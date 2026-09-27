-- Phase 2 slice 1: walking-skeleton assessment loop. Knowledge-question runner
-- shares these tables with all future assessment types; slices 2+ add columns as
-- needed (starter_code, hidden_tests, rubric_id, session_id, audio_url, ...).

CREATE TABLE "question_bank" (
    "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
    "kind"        TEXT           NOT NULL,
    "skillIds"    TEXT[]         NOT NULL,
    "difficulty"  TEXT           NOT NULL,
    "prompt"      TEXT           NOT NULL,
    "keyPoints"   TEXT[]         NOT NULL,
    "answerHint"  TEXT,
    "promptHash"  TEXT           NOT NULL,
    "flagged"     BOOLEAN        NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_bank_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "question_bank_promptHash_key" ON "question_bank" ("promptHash");
CREATE INDEX "question_bank_kind_difficulty_idx" ON "question_bank" ("kind", "difficulty");

CREATE TABLE "attempts" (
    "id"          UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"      UUID           NOT NULL,
    "questionId"  UUID,
    "kind"        TEXT           NOT NULL,
    "score"       DECIMAL(4,3)   NOT NULL,
    "reasoning"   TEXT,
    "answerJson"  JSONB,
    "gradingJson" JSONB,
    "durationMs"  INTEGER,
    "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attempts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attempts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "attempts_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "question_bank"("id") ON DELETE SET NULL
);
CREATE INDEX "attempts_userId_createdAt_idx" ON "attempts" ("userId", "createdAt" DESC);

CREATE TABLE "xp_events" (
    "id"        UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"    UUID           NOT NULL,
    "attemptId" UUID,
    "reason"    TEXT           NOT NULL,
    "xp"        INTEGER        NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "xp_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "xp_events_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "attempts"("id") ON DELETE SET NULL
);
CREATE INDEX "xp_events_userId_createdAt_idx" ON "xp_events" ("userId", "createdAt" DESC);

CREATE TABLE "streaks" (
    "userId"          UUID           NOT NULL,
    "currentDays"     INTEGER        NOT NULL DEFAULT 0,
    "longestDays"     INTEGER        NOT NULL DEFAULT 0,
    "lastAttemptDate" DATE,
    "graceRemaining"  INTEGER        NOT NULL DEFAULT 2,
    "graceResetsAt"   DATE           NOT NULL,
    "updatedAt"       TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "streaks_pkey" PRIMARY KEY ("userId"),
    CONSTRAINT "streaks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
