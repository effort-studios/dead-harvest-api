-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Save" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "day" INTEGER NOT NULL DEFAULT 1,
    "money" INTEGER NOT NULL DEFAULT 100,
    "grid" JSONB NOT NULL,
    "inventory" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Save_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Save_playerId_key" ON "Save"("playerId");

-- AddForeignKey
ALTER TABLE "Save" ADD CONSTRAINT "Save_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
