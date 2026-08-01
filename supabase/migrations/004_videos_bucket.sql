-- =============================================================================
--  Migration 004 — stockage des vidéos générées
-- =============================================================================
--  À exécuter dans : Dashboard Supabase > SQL Editor > New query > Run.
--  Ré-exécutable sans danger.
-- =============================================================================

--  Bucket distinct de `product-images` : les types de fichiers acceptés et la
--  taille limite n'ont rien à voir. Une vidéo de 18 s pèse ~3 Mo, mais une pub
--  plus longue en 1080p peut en peser 50.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'generated-videos',
  'generated-videos',
  true,
  209715200, -- 200 Mo
  array['video/mp4']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- -----------------------------------------------------------------------------
--  Les politiques d'accès
-- -----------------------------------------------------------------------------
--  Rangement : generated-videos/<user_id>/<project_id>.mp4
--
--  Lecture publique : le client doit pouvoir partager sa vidéo, et le lecteur
--  du navigateur y accède sans jeton. Les noms contiennent un identifiant
--  aléatoire, donc les URL ne se devinent pas.

drop policy if exists "Lecture publique des videos generees" on storage.objects;
create policy "Lecture publique des videos generees"
  on storage.objects for select
  to public
  using (bucket_id = 'generated-videos');

drop policy if exists "Depot des videos dans son dossier" on storage.objects;
create policy "Depot des videos dans son dossier"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'generated-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Remplacement de ses videos" on storage.objects;
create policy "Remplacement de ses videos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'generated-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Suppression de ses videos" on storage.objects;
create policy "Suppression de ses videos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'generated-videos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
