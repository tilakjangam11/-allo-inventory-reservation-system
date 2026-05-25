-- Add updatedAt to Product with default for existing rows
ALTER TABLE "Product" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now();

-- Add lifecycle timestamps and reason to Reservation
ALTER TABLE "Reservation" ADD COLUMN "confirmedAt" TIMESTAMP(3),
ADD COLUMN "releaseReason" TEXT,
ADD COLUMN "releasedAt" TIMESTAMP(3);

-- Add updatedAt to Warehouse with default for existing rows
ALTER TABLE "Warehouse" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now();
