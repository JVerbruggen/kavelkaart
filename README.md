# Kavelkaart op GitHub Pages

Deze repo is direct klaar voor deployment op de standaard GitHub Pages URL.

## Standaard URL

Na deploy staat de site op:

https://<jouw-gebruikersnaam>.github.io/kavels/

## Wat al voor je is ingericht

- `index.html` op root (zodat de standaard URL direct werkt)
- `.nojekyll` (voorkomt Jekyll-interferentie)
- `.github/workflows/deploy-pages.yml` (automatische deploy bij push naar `main`)

## Eenmalig in GitHub klikken

1. Ga naar je repository op GitHub.
2. Open **Settings** -> **Pages**.
3. Kies bij **Build and deployment** als **Source**: **GitHub Actions**.
4. Klaar. Elke push naar `main` deployt automatisch.

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
