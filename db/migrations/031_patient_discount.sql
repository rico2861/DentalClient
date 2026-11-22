-- Remise par patient : pourcentage (0–100) appliqué automatiquement à tous ses actes.
-- La plage est validée côté application. Colonne ajoutée avec 0 par défaut (rétro-compatible).
alter table patients add column if not exists discount_percent numeric(5,2) not null default 0;
