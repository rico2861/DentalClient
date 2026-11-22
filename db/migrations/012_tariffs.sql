-- Grille des tarifs des soins (prix vide = « à déterminer » par le médecin selon le cas).
create table if not exists tariffs(id uuid primary key default gen_random_uuid(), clinic_id uuid not null references clinics(id),
 name text not null, category text, price numeric(14,2) check (price is null or price>=0), currency char(3) not null default 'HTG' check (currency in ('HTG','USD')),
 note text, sort int not null default 100, active boolean not null default true, created_at timestamptz default now(), updated_at timestamptz default now());
create index if not exists tariffs_clinic_idx on tariffs(clinic_id, active, sort);
-- tarifs de départ de la clinique
insert into tariffs(clinic_id,name,category,price,currency,sort)
select c.id, t.name, t.cat, t.price, t.cur, t.sort from clinics c cross join (values
  ('Prophylaxie', 'Prévention', 3000::numeric, 'HTG', 10),
  ('Restauration', 'Soins conservateurs', 2000::numeric, 'HTG', 20),
  ('Extraction simple', 'Chirurgie', 2000::numeric, 'HTG', 30),
  ('Extraction chirurgicale', 'Chirurgie', null::numeric, 'HTG', 40),
  ('Traitement orthodontique (braces)', 'Orthodontie', 150::numeric, 'USD', 50),
  ('Endodontie', 'Soins conservateurs', null::numeric, 'HTG', 60),
  ('Prothèse', 'Prothèses', null::numeric, 'HTG', 70)) as t(name, cat, price, cur, sort)
where not exists (select 1 from tariffs x where x.clinic_id = c.id);
