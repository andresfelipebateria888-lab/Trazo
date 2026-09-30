-- ============================================================
-- Trazo · Esquema de base de datos para Supabase
-- Ejecutar completo en: Supabase → SQL Editor → New query → Run
-- ============================================================

-- 1. Perfiles: un registro por cada cuenta, con su rol
create table if not exists public.perfiles (
  id      uuid primary key references auth.users(id) on delete cascade,
  email   text,
  nombre  text,
  rol     text not null default 'usuario' check (rol in ('usuario','creador')),
  creado  timestamptz not null default now()
);

-- Crea el perfil automáticamente cuando alguien se registra
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, email, nombre)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'nombre', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists al_crear_usuario on auth.users;
create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

-- ¿La persona conectada es creador?
create or replace function public.es_creador() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfiles where id = auth.uid() and rol = 'creador');
$$;

-- 2. Documentos: requisiciones, gestión, listas y registro de usuarios.
--    Cada fila es un documento identificado por su ruta, por ejemplo:
--    reqs/REQ-2026-001, gestion/REQ-2026-061, data/users/<uid>/REQ-2026-061
create table if not exists public.documentos (
  path        text primary key,
  coleccion   text not null,
  dueno       uuid,
  data        jsonb not null default '{}'::jsonb,
  actualizado timestamptz not null default now()
);
create index if not exists documentos_coleccion on public.documentos (coleccion);

-- Calcula la colección y el dueño a partir de la ruta
create or replace function public.preparar_documento() returns trigger
language plpgsql as $$
declare partes text[];
begin
  partes := string_to_array(new.path, '/');
  new.coleccion := array_to_string(partes[1:array_length(partes,1)-1], '/');
  new.dueno := null;
  if new.path ~ '^data/users/[0-9a-f-]{36}/' then
    new.dueno := partes[3]::uuid;
  elsif new.path ~ '^usuarios/[0-9a-f-]{36}$' then
    new.dueno := partes[2]::uuid;
  end if;
  new.actualizado := now();
  return new;
end $$;

drop trigger if exists antes_de_guardar on public.documentos;
create trigger antes_de_guardar before insert or update on public.documentos
  for each row execute function public.preparar_documento();

-- 3. Reglas de acceso (Row Level Security)
alter table public.documentos enable row level security;
alter table public.perfiles  enable row level security;

drop policy if exists leer_documentos on public.documentos;
create policy leer_documentos on public.documentos for select to authenticated using (
  public.es_creador()
  or coleccion in ('config', 'gestion', 'meta')
  or dueno = auth.uid()
);

drop policy if exists crear_documentos on public.documentos;
create policy crear_documentos on public.documentos for insert to authenticated with check (
  public.es_creador() or dueno = auth.uid()
);

drop policy if exists editar_documentos on public.documentos;
create policy editar_documentos on public.documentos for update to authenticated
  using (public.es_creador() or dueno = auth.uid())
  with check (public.es_creador() or dueno = auth.uid());

drop policy if exists borrar_documentos on public.documentos;
create policy borrar_documentos on public.documentos for delete to authenticated using (
  public.es_creador()
);

drop policy if exists leer_perfiles on public.perfiles;
create policy leer_perfiles on public.perfiles for select to authenticated using (
  id = auth.uid() or public.es_creador()
);

drop policy if exists editar_mi_perfil on public.perfiles;
create policy editar_mi_perfil on public.perfiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid() and rol = (select p.rol from public.perfiles p where p.id = auth.uid()));

-- 4. Consecutivo de requisiciones (REQ-AAAA-NNN) sin choques entre usuarios
create or replace function public.siguiente_numero() returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.documentos (path, data) values ('meta/contador', '{"ultimo": 60}')
    on conflict (path) do nothing;
  update public.documentos
     set data = jsonb_set(data, '{ultimo}', to_jsonb(coalesce((data->>'ultimo')::int, 60) + 1))
   where path = 'meta/contador'
   returning (data->>'ultimo')::int into n;
  return n;
end $$;
revoke all on function public.siguiente_numero() from public, anon;
grant execute on function public.siguiente_numero() to authenticated;

-- 5. Cambios en vivo (la bandeja se actualiza sola)
alter table public.documentos replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.documentos;
exception when duplicate_object then null; end $$;

-- 6. Lista inicial de empresas
insert into public.documentos (path, data) values ('config/listas', '{"empresas": [
  "Masser", "Banasan", "Masser Solutions",
  "ASESORIAS Y SERVICIOS TECNICOS Y PORTUARIOS S.A.S.", "MAS SERSOLUTIONS S.A.S.",
  "TODOAGRO INDUSTRIAL S.A.S", "OPERADOR LOGISTICO TAYRONA SAS", "SIERRAGRO S.A.S.",
  "MANEJO INTEGRAL DE AMBIENTES SANOS S.A.S."]}')
on conflict (path) do nothing;

-- 7. Dar rol de creador (ejecutar DESPUÉS de crear la cuenta en Authentication → Users)
-- update public.perfiles set rol = 'creador' where email = 'compras@massersolutions.com';
