-- Kontroller efter kluster-006. Bara läsning. Varje rad ska ha ok = true.
select 'anon: inga rättigheter på arbetsstalle_storlek' as kontroll,
  not (has_table_privilege('anon', 'public.arbetsstalle_storlek', 'select')
    or has_table_privilege('anon', 'public.arbetsstalle_storlek', 'insert,update,delete,truncate,references,trigger,maintain')) as ok
union all
select 'authenticated: inga rättigheter på arbetsstalle_storlek',
  not (has_table_privilege('authenticated', 'public.arbetsstalle_storlek', 'select')
    or has_table_privilege('authenticated', 'public.arbetsstalle_storlek', 'insert,update,delete,truncate,references,trigger,maintain'))
union all
select 'foretag_publik: rättigheterna oförändrade',
  (select relacl::text from pg_class where oid = 'public.foretag_publik'::regclass)
    = '{postgres=arwdDxtm/postgres,anon=rm/postgres,authenticated=m/postgres,service_role=Dxtm/postgres}'
union all
select 'foretag_publik: aeant_per_stalle är sista kolumnen',
  (select attname from pg_attribute where attrelid = 'public.foretag_publik'::regclass and attnum > 0
   order by attnum desc limit 1) = 'aeant_per_stalle'
union all
select 'enskild firma: orgnr är null',
  not exists (select 1 from public.foretag_publik where ar_enskild_firma and orgnr is not null)
union all
select 'enskild firma: ett arbetsställe (aeant_per_stalle = aeant)',
  not exists (select 1 from public.foretag_publik where ar_enskild_firma and aeant_per_stalle is distinct from aeant)
union all
select 'joinen tappar eller dubblar inga rader',
  (select count(*) from public.foretag_publik) = (select count(*) from public.aesamtable)
union all
select 'arbetsstalle_storlek bär inget orgnr',
  not exists (select 1 from pg_attribute where attrelid = 'public.arbetsstalle_storlek'::regclass
              and attname in ('peorgnr', 'orgnr') and not attisdropped);
