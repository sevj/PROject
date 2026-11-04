# Feuille de route

Six chantiers choisis, dans l'ordre. Cocher au fur et à mesure.

Choix par défaut : nouvelles entrées de menu (Ressources, Ports, Journal, Carte) regroupées sous « Outils » ; rien ne modifie un projet sans bouton explicite ; nouvelles migrations.

## 0. Socle commun
- [ ] Parseur compose étendu : ports, réseaux, volumes, depends_on.
- [ ] API Docker étendue : stats, réseaux, volumes, `system df`.
- [ ] Table générique d'analyses en cache (résultats datés).

## 1. Ressources (entrée de menu ; section dans l'onglet Docker pas encore faite)
- [x] `docker stats` CPU/mémoire toutes les 2 s tant que la page est ouverte.
- [x] Disque occupé : images, conteneurs, volumes, cache de build.
- [x] Boutons de nettoyage avec aperçu avant.
- [x] Les volumes ne sont jamais supprimés en masse : listés un par un, ceux des projets signalés, suppression avec confirmation explicite.

## 2. Ports (entrée de menu générale)
- [x] Ports publiés par Docker, ports déclarés dans compose (même projet arrêté), processus en écoute sur l'hôte (`ss`).
- [x] Détection des collisions, signalées en premier.

## 3. Onglet « Sécurité et dépendances » sur la fiche projet
- [ ] npm / pnpm / yarn / composer (cargo / go si installés) : paquets obsolètes + audit.
- [ ] Compteurs dans la liste, bouton « Analyser » manuel, résultats datés en cache.
- [ ] Question ouverte : lancer composer dans le conteneur PHP s'il n'est pas installé sur l'hôte.

## 4. Explorateur de bases + requêtes SQL
- [ ] Tables / colonnes / lignes paginées, éditeur SQL, historique par projet.
- [ ] Lecture seule garantie par la base (transaction READ ONLY), limites 1000 lignes et 15 s.
- [ ] MongoDB : collections + filtre JSON.
- Hors périmètre pour l'instant : écritures, comparaison de dumps.

## 5. Journal de travail automatique
- [ ] Sessions déduites des commits git (écart ≤ 30 min, marge 15 min, configurable).
- [ ] Échantillonneur d'activité fichiers optionnel, actif seulement quand l'app tourne.
- [ ] Vue hebdomadaire projet × jour, estimations présentées comme telles (skill `dataviz` pour les graphiques).

## 6. Carte visuelle
- [ ] React Flow, disposition en couches : projets / conteneurs / bases. Version simple d'abord, pour juger.

## Reste à faire hors chantiers
- Supprimer `src/app/projects/[id]/env-files.tsx` (orphelin), la ligne « Env files » de `project-facts.tsx` et les clés i18n `environment` / `noEnv`.
