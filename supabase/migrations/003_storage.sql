-- =============================================================================
--  Migration 003 — stockage des photos produit
-- =============================================================================
--  À exécuter dans : Dashboard Supabase > SQL Editor > New query > Run.
--  Ré-exécutable sans danger.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  Le bucket
-- -----------------------------------------------------------------------------
--  `public = true` : les images sont lisibles par URL directe, sans jeton.
--
--  C'est NÉCESSAIRE ici — Higgsfield doit pouvoir télécharger la photo depuis
--  ses propres serveurs pour l'animer. Une URL signée expirerait en plein
--  milieu d'une génération.
--
--  Ce qui reste protégé : personne ne peut DÉPOSER ni SUPPRIMER une image
--  ailleurs que dans son propre dossier (voir les politiques plus bas). Les
--  noms de fichiers sont aléatoires, donc les URL ne se devinent pas.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  10485760, -- 10 Mo par fichier
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- -----------------------------------------------------------------------------
--  Les politiques d'accès
-- -----------------------------------------------------------------------------
--  Convention de rangement :  product-images/<user_id>/<project_id>/<fichier>
--
--  `storage.foldername(name)` découpe le chemin ; son premier élément est donc
--  l'identifiant du propriétaire. On le compare à l'utilisateur connecté :
--  impossible d'écrire dans le dossier de quelqu'un d'autre.

drop policy if exists "Lecture publique des photos produit" on storage.objects;
create policy "Lecture publique des photos produit"
  on storage.objects for select
  to public
  using (bucket_id = 'product-images');

drop policy if exists "Depot dans son propre dossier" on storage.objects;
create policy "Depot dans son propre dossier"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Modification de ses propres photos" on storage.objects;
create policy "Modification de ses propres photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Suppression de ses propres photos" on storage.objects;
create policy "Suppression de ses propres photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'product-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
