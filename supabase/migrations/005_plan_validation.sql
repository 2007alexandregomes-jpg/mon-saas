-- =============================================================================
--  Migration 005 — validation du plan par le client
-- =============================================================================
--  À exécuter dans : Dashboard Supabase > SQL Editor > New query > Run.
--  Ré-exécutable sans danger.
-- =============================================================================
--
--  Le traitement se déroule désormais en deux temps :
--
--    ① analyse    — télécharger, découper en plans, faire décider Claude.
--                   Gratuit hors coût d'analyse (~0,15 $).
--    ⏸ validation — le client voit chaque plan, son traitement proposé et le
--                   devis. Il corrige ce qu'il veut, puis lance.
--    ② exécution  — les éditions payantes partent, la vidéo est montée.
--
--  Cette pause existe parce que le tri automatique n'est pas stable : d'une
--  exécution à l'autre, le même plan peut être édité, fabriqué ou écarté. Faire
--  trancher le client transforme cette variabilité en contrôle.
-- =============================================================================


-- -----------------------------------------------------------------------------
--  1. Ce que le client choisit au départ
-- -----------------------------------------------------------------------------

alter table public.projects
  -- Remplace les cartons de marque du concurrent. NULL = les retirer.
  add column if not exists brand_name text,
  -- Remplacer aussi les personnes filmées par d'autres.
  add column if not exists replace_people boolean not null default true;


-- -----------------------------------------------------------------------------
--  2. Le plan, et ce qu'il coûte
-- -----------------------------------------------------------------------------

alter table public.projects
  -- Un objet par plan : bornes, aperçu, traitement, consigne, résultat.
  -- jsonb plutôt qu'une table dédiée : ces plans n'ont de sens qu'à
  -- l'intérieur de leur projet et n'existent jamais seuls.
  add column if not exists shot_plan jsonb,
  -- Format de la vidéo de référence, que la copie doit reproduire.
  add column if not exists source_format jsonb,
  add column if not exists plan_cost_usd numeric(10, 4),
  add column if not exists edit_cost_usd numeric(10, 4);


-- -----------------------------------------------------------------------------
--  3. Les nouveaux statuts
-- -----------------------------------------------------------------------------
--
--    pending → planning → awaiting_approval → generating → completed
--                  ↘             ↓                 ↘
--                   failed    canceled          failed / nsfw

alter table public.projects drop constraint if exists projects_status_check;

alter table public.projects
  add constraint projects_status_check
  check (
    status in (
      'pending',            -- créé, rien n'a démarré
      'planning',           -- téléchargement, découpage, analyse
      'awaiting_approval',  -- le plan attend la validation du client
      'analyzing',          -- conservé : anciens projets
      'generating',         -- les éditions tournent
      'completed',
      'failed',
      'nsfw',
      'canceled'
    )
  );


-- -----------------------------------------------------------------------------
--  4. L'index des projets en cours suit les nouveaux statuts
-- -----------------------------------------------------------------------------

drop index if exists projects_active_idx;

create index if not exists projects_active_idx
  on public.projects (status, created_at)
  where status in ('pending', 'planning', 'awaiting_approval', 'analyzing', 'generating');
