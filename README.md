# Host Match

Il mercato Airbnb di Milano in un colpo d'occhio, per gli host:

- **Dove sono**: mappa di tutti gli annunci, filtrabile per tipo (casa intera, stanza privata, condivisa, hotel), con i numeri di ogni quartiere.
- **Quanto chiedere**: scegli quartiere, tipo, ospiti e camere e ottieni prezzo consigliato, fascia tipica, notti prenotate e incasso annuo stimato, confrontandoti con gli annunci simili.
- **Quartiere per quartiere**: tabella ordinabile con annunci, quota di case intere, prezzo mediano e notti prenotate.

Sito statico (HTML, CSS, JavaScript + Leaflet), pubblicato con GitHub Pages.

## Aggiornare i dati

1. Scarica da [Inside Airbnb](https://insideairbnb.com/get-the-data/) i file di Milano `listings.csv.gz` (sezione *data*) e `neighbourhoods.geojson`.
2. Esegui, indicando la data della rilevazione:

   ```bash
   python3 scripts/build_data.py listings.csv.gz neighbourhoods.geojson 2026-09-19
   ```

3. Fai commit e push di `data/`.

## Fonte

Dati [Inside Airbnb](https://insideairbnb.com/), licenza [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Host Match non è affiliato ad Airbnb.
