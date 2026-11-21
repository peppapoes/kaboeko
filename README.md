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
src/config.ts       Gamegrootte (1920x1280, verhouding 3:2) en instellingen voor scherpe weergave
src/scenes/         Phaser-scenes
src/input/          Muis en controller (ESP32), voor alle scenes
docs/               Demovideo's en andere documentatie (komt niet mee online)
hardware/           Arduino-sketch van de controller (komt niet mee online)
```

## Scherpe weergave (Retina)

De game wordt intern op 2× resolutie getekend (3840x2560), zodat alles scherp
blijft op Retina-schermen. In je scenes werk je gewoon met 1920x1280:

- Roep `setupCamera(this)` aan als eerste regel in de `create()` van elke scene.
- Gebruik `GAME_WIDTH` / `GAME_HEIGHT` uit `config.ts` in plaats van `this.scale.width`.
- Geef tekst `resolution: RENDER_SCALE` mee in de stijl.
- Gebruik `pointer.worldX` / `pointer.worldY` voor muis- en touchposities.

## Controller (ESP32 + MPU-6050)

Speler 1 kan de cursor besturen door een controller te kantelen (Web Serial,
alleen in **Chrome of Edge**). Zonder controller werkt alles gewoon met de muis.
Code: `src/input/` — instellingen in `src/input/controllerConfig.ts`.
De Arduino-sketch staat in `hardware/kaboeko_mpu6050/`.

- **Verbinden:** klik rechtsboven op *Connect controller* en kies de poort.
  Daarna verbindt de game vanzelf opnieuw bij het laden of opnieuw insteken.
  Sluit de Serial Monitor van de Arduino IDE, anders is de poort bezet.
- **Toetsen:** `C` = huidige stand wordt "recht" (kalibreren), `T` = wisselen
  tussen muis en controller, `D` = debugpaneel, `Spatie` = knop van speler 1.
- **Genrescherm:** twee handjes. Speler 1 = controller (+ spatie om te kiezen),
  speler 2 = muis (gewoon klikken).
- **Overal anders:** één cursor. Met controller volgt die de controller en
  telt een trackpadklik op de plek van de controllercursor.
- **Richting klopt niet?** Zet in `controllerConfig.ts` `INVERT_X`, `INVERT_Y`
  of `SWAP_AXES` op `true`. Snelheid: `MAX_SPEED`, gevoeligheid: `DEAD_ZONE` en `MAX_ANGLE`.
