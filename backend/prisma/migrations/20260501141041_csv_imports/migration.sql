-- CreateEnum
CREATE TYPE "CsvImportStatus" AS ENUM ('preview', 'committed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "csv_imports" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "uploaded_by" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "invalid_rows" INTEGER NOT NULL DEFAULT 0,
    "committed_rows" INTEGER NOT NULL DEFAULT 0,
    "status" "CsvImportStatus" NOT NULL DEFAULT 'preview',
    "preview_summary_json" JSONB,
    "error_report_json" JSONB,
    "committed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csv_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "csv_imports_tenant_id_created_at_idx" ON "csv_imports"("tenant_id", "created_at");
