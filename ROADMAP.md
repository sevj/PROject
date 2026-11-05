# Feuille de route

Six chantiers choisis, dans l'ordre. Cocher au fur et à mesure.

Choix par défaut : nouvelles entrées de menu (Ressources, Ports, Journal, Carte) regroupées sous « Outils » ; rien ne modifie un projet sans bouton explicite ; nouvelles migrations.

## 0. Socle commun
- [ ] Parseur compose étendu : ports, réseaux, volumes, depends_on.
- [ ] API Docker étendue : stats, réseaux, volumes, `system df`.
- [ ] Table générique d'analyses en cache (résultats datés).

## 1. Ressources (entrée de menu + section dans l'onglet Docker)
- [x] `docker stats` CPU/mémoire toutes les 2 s tant que la page est ouverte.
- [x] Disque occupé : images, conteneurs, volumes, cache de build.
- [x] Boutons de nettoyage avec aperçu avant.
- [x] Les volumes ne sont jamais supprimés en masse : listés un par un, ceux des projets signalés, suppression avec confirmation explicite.

## 2. Ports (entrée de menu générale)
- [x] Ports publiés par Docker, ports déclarés dans compose (même projet arrêté), processus en écoute sur l'hôte (`ss`).
- [x] Détection des collisions, signalées en premier.

## 3. Onglet « Sécurité et dépendances » sur la fiche projet
- [x] npm / pnpm / yarn / composer : paquets obsolètes + audit. (cargo / go : pas faits, non installés ici ; yarn non testé sur un vrai projet.)
- [x] Compteurs dans la liste, bouton « Analyser » manuel, résultats datés en cache.
- [x] composer : sur la machine, sinon dans un conteneur du projet qui tourne et qui l'a (plugins et scripts désactivés).

## 4. Explorateur de bases + requêtes SQL
- [x] Tables / colonnes / lignes paginées, éditeur SQL, historique par projet.
- [x] Lecture seule garantie par la base (session READ ONLY) + contrôle du texte, limites 1000 lignes et 15 s.
- [x] MongoDB : collections + filtre JSON.
- Hors périmètre pour l'instant : écritures, comparaison de dumps.

## 5. Journal de travail automatique
- [x] Sessions déduites des commits git (écart ≤ 30 min, marge 15 min, configurable) et de l'activité de Claude Code.
- [x] Échantillonneur d'activité fichiers optionnel (désactivé par défaut), actif seulement quand l'app tourne.
- [x] Vue hebdomadaire projet × jour, estimations présentées comme telles.

## 6. Carte visuelle
- [x] React Flow, disposition en couches : projets / services / bases (flèches depends_on). Version simple, pour juger.

## Reste à faire hors chantiers
- Fait : `env-files.tsx` orphelin et clés `environment` / `noEnv` supprimés. La ligne « .env files » de `project-facts.tsx` est gardée : elle sert encore dans le panneau latéral de la liste.

## 7. Explorateur de bases : suite (retenu)
- [x] EXPLAIN visuel (PostgreSQL, MySQL, MariaDB ; SQLite avec son explorateur) : plan d'exécution en arbre avec coût, lignes estimées/réelles et nœuds lents mis en évidence (PostgreSQL `EXPLAIN (FORMAT JSON)`, MySQL/MariaDB `EXPLAIN FORMAT=JSON`, SQLite `EXPLAIN QUERY PLAN`). Lecture seule : pas d'`ANALYZE` sur une requête qui écrit.
- [x] SQLite : fichiers `.db`/`.sqlite` détectés dans le projet, ouverts en lecture seule.
- [x] Redis : clés paginées (`SCAN`), type et TTL, valeur affichée selon le type, commandes de lecture uniquement. (aucun champ de commande libre ; scripts de lecture fixes, non essayés sur un vrai Redis)
- [ ] À voir ensuite : schéma et relations entre tables (clés étrangères), comparaison de deux dumps.

## Idées Git (à documenter, pas décidé de les faire)
Les actions Git restent volontairement limitées (voir README). À rediscuter avant tout développement :
- Diff, log, historique d'un fichier, blame.
- Commit, push, merge, rebase, actions sur les stashes.
- État des PR et de la CI (GitHub/GitLab) avec lien direct.
- Alertes : travail non poussé, branches obsolètes, dépôt sale depuis longtemps.
- Worktrees, submodules, tags et releases.

## Autres idées (liste du 2026-11-05, non retenues pour l'instant)
Logs de conteneur en direct, erreurs Docker avec délai d'expiration, démarrage automatique de l'app, alertes sur l'accueil, recherche globale, export du journal, notifications, sauvegarde/export de la configuration, dépendances cargo/go/pip, comparaison `.env.example`/`.env`, budgets Claude.
