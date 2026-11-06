-- Commit the enum addition before any later migration or statement uses the new value.
ALTER TYPE "DeliveryConfirmationSource" ADD VALUE 'DISTRIBUTOR_CONFIRMED';
