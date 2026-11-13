# Het land van Kaboeko

Game gebouwd met [Phaser 4](https://phaser.io), [Vite](https://vite.dev) en TypeScript.

## Vereisten

- [Node.js](https://nodejs.org) 20.19+ of 22.12+ (inclusief npm)

## Installeren

```bash
npm install
```

## Starten

| Commando          | Wat het doet                                                  |
| ----------------- | ------------------------------------------------------------- |
| `npm run dev`     | Start de dev-server op http://localhost:8080 (met hot reload) |
| `npm run build`   | Controleert de types en maakt een productie-build in `dist/`  |
| `npm run preview` | Serveert de productie-build uit `dist/` lokaal                |

## Mappenstructuur

```
index.html          HTML-pagina waarin de game draait
public/assets/      Afbeeldingen, geluid en andere bestanden (worden 1-op-1 gekopieerd)
src/main.ts         Game-configuratie (schaalt mee met het scherm)
src/config.ts       Gamegrootte (1920x1080) en instellingen voor scherpe weergave
src/scenes/         Phaser-scenes
```

## Scherpe weergave (Retina)

De game wordt intern op 2× resolutie getekend (3840x2160), zodat alles scherp
blijft op Retina-schermen. In je scenes werk je gewoon met 1920x1080:

- Roep `setupCamera(this)` aan als eerste regel in de `create()` van elke scene.
- Gebruik `GAME_WIDTH` / `GAME_HEIGHT` uit `config.ts` in plaats van `this.scale.width`.
- Geef tekst `resolution: RENDER_SCALE` mee in de stijl.
- Gebruik `pointer.worldX` / `pointer.worldY` voor muis- en touchposities.
