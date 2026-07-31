-- =============================================================================
--  Table `projects` — une ligne = une demande de génération vidéo
-- =============================================================================
--  À exécuter dans : Dashboard Supabase > SQL Editor > New query > Run.
--  Ce script est ré-exécutable sans danger (« if not exists » / « drop policy »).
-- =============================================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),

  -- Le propriétaire. `on delete cascade` : si le compte est supprimé,
  -- ses projets partent avec lui (obligation RGPD, et ça évite les orphelins).
  user_id uuid not null references auth.users (id) on delete cascade,

  -- Ce que l'utilisateur fournit
  competitor_video_url text not null,
  product_name text not null,
  product_description text,
  product_image_url text,

  -- Avancement de la génération
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),

  -- Rempli par Higgsfield une fois la vidéo prête
  generated_video_url text,

  created_at timestamptz not null default now()
);

-- Le dashboard listera « mes projets, du plus récent au plus ancien » :
-- cet index évite un scan complet de la table quand elle grossira.
create index if not exists projects_user_id_created_at_idx
  on public.projects (user_id, created_at desc);


-- =============================================================================
--  Row Level Security (RLS)
-- =============================================================================
--  ⚠️ Étape NON optionnelle. La clé « anon » est publique (elle est dans le JS
--  envoyé au navigateur). Sans RLS, n'importe qui pourrait lire la table
--  entière. Avec RLS, Postgres filtre chaque requête selon l'utilisateur
--  connecté : `auth.uid()` renvoie l'id de la personne authentifiée.
-- =============================================================================

alter table public.projects enable row level security;

drop policy if exists "Les utilisateurs lisent leurs projets" on public.projects;
create policy "Les utilisateurs lisent leurs projets"
  on public.projects for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Les utilisateurs créent leurs projets" on public.projects;
create policy "Les utilisateurs créent leurs projets"
  on public.projects for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Les utilisateurs modifient leurs projets" on public.projects;
create policy "Les utilisateurs modifient leurs projets"
  on public.projects for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Les utilisateurs suppriment leurs projets" on public.projects;
create policy "Les utilisateurs suppriment leurs projets"
  on public.projects for delete
  to authenticated
  using ((select auth.uid()) = user_id);
