# Host Match

Il mercato Airbnb di Milano in un colpo d'occhio, per gli host:

- **Dove sono**: mappa di tutti gli annunci, filtrabile per tipo (casa intera, stanza privata, condivisa, hotel), con i numeri di ogni quartiere.
- **Quanto chiedere**: scegli quartiere, tipo, ospiti e camere e ottieni prezzo consigliato, fascia tipica, notti prenotate e incasso annuo stimato, confrontandoti con gli annunci simili.
- **Cosa offrire**: quali servizi sono indispensabili nella zona e quali fanno chiedere di più, a parità di ospiti.
- **La zona**: locali, parchi, metro e tram del quartiere confrontati con il resto di Milano, con consigli su cosa scrivere nell'annuncio.
- **Previsione di guadagno**: incasso lordo e netto (commissioni, tasse, pulizie, gestione, spese fisse) mese per mese.
- **Quartiere per quartiere**: tabella ordinabile con annunci, quota di case intere, prezzo mediano e notti prenotate.
- **Chi siamo** e contatti (i contatti nel file `index.html` sono ancora un segnaposto).

Sito statico (HTML, CSS, JavaScript + Leaflet), pubblicato con GitHub Pages.

## Aggiornare i dati

1. In una cartella scarica da [Inside Airbnb](https://insideairbnb.com/get-the-data/) i file di Milano `listings.csv.gz` (sezione *data*), `reviews.csv` e `neighbourhoods.geojson` (sezione *visualisations*).
2. Nella stessa cartella salva come `osm.json` il risultato di questa query [Overpass](https://overpass-turbo.eu/):

   ```
   [out:json][timeout:240];(node["amenity"~"^(bar|restaurant|cafe|pub|fast_food)$"](45.38,9.03,45.54,9.28);nwr["leisure"~"^(park|garden)$"]["access"!="private"](45.38,9.03,45.54,9.28);node["station"="subway"](45.38,9.03,45.54,9.28);node["railway"="tram_stop"](45.38,9.03,45.54,9.28););out center tags;
   ```

3. Esegui, indicando la cartella e la data della rilevazione:

   ```bash
   python3 scripts/build_data.py <cartella> 2026-09-19
   ```

4. Fai commit e push di `data/`.

## Fonti

- Annunci: [Inside Airbnb](https://insideairbnb.com/), licenza [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- Locali, parchi e trasporti: © [OpenStreetMap](https://www.openstreetmap.org/copyright), licenza ODbL.

Host Match non è affiliato ad Airbnb.
