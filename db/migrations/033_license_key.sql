-- Instance partagée : stocke AUSSI la clé de licence courte (DNTL-XXXXX-…) que le
-- client voit dans son espace, pour que le propriétaire se connecte en la saisissant
-- (connexion découplée du schéma SaaS : on compare à la valeur stockée au provisioning).
alter table clinics add column if not exists license_key text;
create unique index if not exists uq_clinic_license_key on clinics(license_key) where license_key is not null;
