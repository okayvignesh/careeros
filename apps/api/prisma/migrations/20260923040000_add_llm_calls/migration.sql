-- CreateTable
CREATE TABLE "llm_calls" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "callKind" TEXT NOT NULL,
    "promptTokens" INTEGER,
    "completionTokens" INTEGER,
    "totalTokens" INTEGER,
    "costUsd" DECIMAL(10,6),
    "latencyMs" INTEGER NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_calls_userId_timestamp_idx" ON "llm_calls"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "llm_calls_timestamp_idx" ON "llm_calls"("timestamp");

-- AddForeignKey
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
