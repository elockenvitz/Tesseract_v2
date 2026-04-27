-- Add the missing notification_type used by share-simulation flow.
-- The client code in simulation-share-service.ts has been inserting
-- notifications with type='simulation_shared' since the share feature
-- launched, but the enum was never updated — so every insert silently
-- failed (caught in a .catch). Recipients have been getting nothing.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'simulation_shared';
