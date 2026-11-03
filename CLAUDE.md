@AGENTS.md

## Skiffer CRM: deploya aldrig härifrån

`scripts/deploy-crm.sh` (Skiffer CRM, crm.skiffergroup.se) får bara köras från
`~/Projects/skiffer-crm` eller dess egna worktrees — aldrig från en session i
det här repot, och aldrig från en klon eller worktree av CRM:et som en session
här har skapat. Behöver CRM:et ändras: beskriv ändringen och lämna den till
en CRM-session. Skriptet vägrar köras utanför CRM-repot, och bara en deploy
åt gången (låset `~/.skiffer/deploy-crm.lock`). Bakgrund: 3 nov 2026 deployade
en åkeriguiden-session CRM:et från en egen worktree samtidigt som en
CRM-session, och de två deployernas prov krockade i den delade mock-sajten.
