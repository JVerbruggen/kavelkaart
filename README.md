# Kavelkaart op GitHub Pages

Deze repo is direct klaar voor deployment op de standaard GitHub Pages URL.

## Standaard URL

Na deploy staat de site op:

https://<jouw-gebruikersnaam>.github.io/<repo-naam>/

Voor deze repo is dat:

https://jverbruggen.github.io/kavelkaart/

## Wat al voor je is ingericht

- `index.html` op root (zodat de standaard URL direct werkt)
- `.nojekyll` (voorkomt Jekyll-interferentie)
- `.github/workflows/deploy-pages.yml` (automatische deploy bij push naar `main`)

## Eenmalig in GitHub klikken

Voor deze repository is dit nodig omdat de workflow-token geen rechten heeft om zelf een Pages-site aan te maken.

1. Ga naar je repository op GitHub.
2. Open **Settings** -> **Actions** -> **General**.
3. Zet **Workflow permissions** op **Read and write permissions** en sla op.
4. Open **Settings** -> **Pages**.
5. Kies bij **Build and deployment** als **Source**: **GitHub Actions**.
6. Herstart daarna de workflow-run.

## Deploy triggeren

Als je al naar `main` gepusht hebt, draait de workflow meteen.
Zo niet:

```bash
git add .
git commit -m "Configure GitHub Pages deployment"
git push origin main
```

## Lokaal testen

```bash
npx http-server -p 8080
```

Open daarna:

http://127.0.0.1:8080/

De root URL stuurt automatisch door naar de kaartpagina.
