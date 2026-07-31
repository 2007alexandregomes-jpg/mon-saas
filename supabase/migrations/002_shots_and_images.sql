-- =============================================================================
--  Migration 002 — plusieurs photos produit, découpage en plans, statuts
-- =============================================================================
--  À exécuter dans : Dashboard Supabase > SQL Editor > New query > Run.
--  Ré-exécutable sans danger.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Plusieurs photos produit au lieu d'une seule
-- -----------------------------------------------------------------------------
--  Le client dépose les photos de sa fiche produit (face, trois-quarts, macro…).
--  Chaque plan de la vidéo utilisera celle dont le cadrage est le plus proche.

alter table public.projects
  add column if not exists product_image_urls text[] not null default '{}';

-- Reprend l'ancienne colonne unique pour ne perdre aucun projet existant.
update public.projects
   set product_image_urls = array[product_image_url]
 where product_image_url is not null
   and cardinality(product_image_urls) = 0;


-- -----------------------------------------------------------------------------
--  2. Le résultat de l'analyse
-- -----------------------------------------------------------------------------

alter table public.projects
  -- Ce qu'on a compris de la vidéo de référence
  add column if not exists reference_transcript text,
  add column if not exists reference_format jsonb,
  add column if not exists style jsonb,
  add column if not exists original_script jsonb,
  -- Ce qu'on en a tiré pour le client
  add column if not exists adapted_script jsonb,
  add column if not exists visual_signature text,
  -- Le découpage : un objet par plan (durée, description, image, mouvement,
  -- et plus tard l'URL du clip généré). jsonb plutôt qu'une table dédiée :
  -- les plans n'ont de sens qu'à l'intérieur de leur projet.
  add column if not exists shots jsonb,
  add column if not exists notes text,
  -- Traçabilité des coûts, pour savoir ce que chaque projet a réellement coûté
  add column if not exists analysis_cost_usd numeric(10, 4),
  add column if not exists generation_credits integer,
  -- Message affiché au client quand ça échoue
  add column if not exists error_message text,
  add column if not exists updated_at timestamptz not null default now();


-- -----------------------------------------------------------------------------
--  3. Les statuts
-- -----------------------------------------------------------------------------
--  Le parcours réel comporte deux longues étapes distinctes, et Higgsfield peut
--  refuser un contenu (nsfw) ou annuler une génération (canceled).
--
--    pending → analyzing → generating → completed
--                  ↘           ↘
--                   failed / nsfw / canceled

alter table public.projects drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (
    status in (
      'pending',      -- en file d'attente
      'analyzing',    -- téléchargement + transcription + analyse Claude
      'generating',   -- génération des plans chez Higgsfield
      'completed',    -- vidéo prête
      'failed',       -- erreur technique
      'nsfw',         -- contenu refusé par Higgsfield
      'canceled'      -- annulé
    )
  );


-- -----------------------------------------------------------------------------
--  4. `updated_at` tenu à jour automatiquement
-- -----------------------------------------------------------------------------
--  Sans ça il faudrait y penser à chaque écriture — et on l'oublierait.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
-- `search_path` figé : sans ça, un objet malveillant placé dans un autre schéma
-- pourrait détourner l'exécution de la fonction.
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row
  execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
--  5. Retrouver rapidement les projets en cours
-- -----------------------------------------------------------------------------
--  Index partiel : il n'indexe QUE les lignes en cours de traitement, donc il
--  reste minuscule même avec des millions de projets terminés.

create index if not exists projects_active_idx
  on public.projects (status, created_at)
  where status in ('pending', 'analyzing', 'generating');
