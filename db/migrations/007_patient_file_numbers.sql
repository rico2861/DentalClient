-- N° de dossier : unique, aléatoire, attribué automatiquement à la création du patient (ex. DL-K7M2PX9R).
-- Alphabet sans caractères ambigus (ni 0/O, ni 1/I/L). Les dossiers existants gardent leur numéro.
create or replace function gen_file_number() returns text language plpgsql as $$
declare chars constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; n text; i int;
begin
  loop
    n := 'DL-';
    for i in 1..8 loop n := n || substr(chars, 1 + floor(random() * length(chars))::int, 1); end loop;
    exit when not exists (select 1 from patients where file_number = n);
  end loop;
  return n;
end $$;
alter table patients alter column file_number set default gen_file_number();
create unique index if not exists pat_file_number_unique on patients(file_number);
