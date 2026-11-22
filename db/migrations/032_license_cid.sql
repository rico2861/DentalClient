-- Instance web partagée : relie une licence (son identifiant de clinique « cid »,
-- émis par BackendDental) à la clinique provisionnée dans la base partagée.
-- Permet la connexion du propriétaire par « licence + OTP » : licence → cid → clinique → propriétaire.
alter table clinics add column if not exists license_cid text;
create unique index if not exists uq_clinic_license_cid on clinics(license_cid) where license_cid is not null;
