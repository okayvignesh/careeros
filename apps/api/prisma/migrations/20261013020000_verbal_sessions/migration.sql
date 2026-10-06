-- P2 verbal-defense sessions: whisper.cpp transcription + LLM grading.
--
-- One row per spoken answer. `prompt` snapshots the question text so an
-- ad-hoc prompt needs no question_bank row; `questionId` links the bank row
-- when one exists. Audio is stored in MinIO at `audioKey` (key scoped
-- `verbal/{userId}/{sessionId}/...`), `transcript` holds the whisper output,
-- and `attemptId` links the graded Attempt once scored.
--
-- Status machine: created -> transcribed -> graded | failed | unavailable.
-- `unavailable` is the honest state when WHISPER_URL is blank (speech profile
-- off); `failed` is a configured-but-errored transcription.

CREATE TABLE "verbal_sessions" (
    "id"             UUID           NOT NULL DEFAULT gen_random_uuid(),
    "userId"         UUID           NOT NULL,
    "questionId"     UUID,
    "prompt"         TEXT           NOT NULL,
    "skillIds"       TEXT[]         NOT NULL DEFAULT ARRAY[]::TEXT[],
    "difficulty"     TEXT           NOT NULL DEFAULT 'medium',
    "status"         TEXT           NOT NULL DEFAULT 'created',
    "audioKey"       TEXT,
    "audioMime"      TEXT,
    "language"       TEXT,
    "transcript"     TEXT,
    "transcriptJson" JSONB,
    "score"          DECIMAL(4,3),
    "reasoning"      TEXT,
    "gradingJson"    JSONB,
    "attemptId"      UUID,
    "durationMs"     INTEGER,
    "error"          TEXT,
    "createdAt"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMPTZ(6) NOT NULL,
    "transcribedAt"  TIMESTAMPTZ(6),
    "gradedAt"       TIMESTAMPTZ(6),

    CONSTRAINT "verbal_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "verbal_sessions_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "verbal_sessions_questionId_fkey"
        FOREIGN KEY ("questionId") REFERENCES "question_bank"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "verbal_sessions_userId_createdAt_idx"
    ON "verbal_sessions" ("userId", "createdAt");

CREATE INDEX "verbal_sessions_status_idx"
    ON "verbal_sessions" ("status");
