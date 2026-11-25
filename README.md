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

Speler 1 kan de cursor besturen met een controller (Web Serial, alleen in
**Chrome of Edge**). Zonder controller werkt alles gewoon met de muis.
Code: `src/input/` — instellingen in `src/input/controllerConfig.ts`.
De Arduino-sketch staat in `hardware/kaboeko_mpu6050/`.

- **Verbinden:** klik rechtsboven op *Connect controller* en kies de poort.
  Daarna verbindt de game vanzelf opnieuw bij het laden of opnieuw insteken.
  Sluit de Serial Monitor van de Arduino IDE, anders is de poort bezet.
- **Toetsen:** `C` = huidige stand wordt het midden (kalibreren), `T` = wisselen
  tussen muis en controller, `D` = debugpaneel, `R` = min/max in het
  debugpaneel resetten, `Spatie` = knop van speler 1.
- **Genrescherm:** twee handjes. Speler 1 = controller (+ spatie om te kiezen),
  speler 2 = muis (gewoon klikken).
- **Fantasiescherm:** de titel *Fantasie* en de twee bewegende props verdwijnen
  vanzelf. Daarna verschijnen de spelersuitleg en het houten bord met het
  speldoel. De handjes blijven zichtbaar tot de intro wordt aangeklikt. Daarna
  heeft speler 1 (controller) de paraplu en speler 2 (muis) de toverstaf. De
  controllerknop (of spatie) klapt de paraplu open of dicht.
  De heks gooit vliegende apen en gifflesjes; een rode cirkel toont waar ze
  landen. Houdt speler 1 daar de open paraplu, dan kaatst de aanval terug naar
  de heks. Mist de paraplu, dan krijgt de heks wat leven terug. Speler 2 trekt met de toverstaf de stippellijn van een spreuk na
  (geel = start); dan vuurt de spreuk op de heks. Zolang de paraplu open is,
  kan speler 2 geen spreuk doen ("Wacht! De paraplu is open"). Elke treffer laat haar
  levensbalk zakken. Bij nul verdwijnt de heks in rook, komt het
  fantasieboek tevoorschijn. Een knop of klik opent het boek (zoals bij geschiedenis).
  **Testen zonder controller:** speler 1 speelt dan met het toetsenbord:
  `WASD` (of de pijltjes) beweegt de paraplu, `Spatie`/`Enter` is de knop
  (paraplu open/dicht, verder naar de volgende stap). Speler 2 blijft op de
  muis/trackpad. Tijdens het spel opent `D` dan dus niet het debugpaneel.
  Spreuken staan in `src/scenes/fantasySpells.ts`, moeilijkheid bovenaan
  `FantasyScene.ts` (`ATTACK`, `SPELL`, `DAMAGE`).
- **Overal anders:** één cursor. Met controller volgt die de controller en
  telt een trackpadklik op de plek van de controllercursor.

### Wijzen of kantelen (`CONTROL_MODE`)

- `'point'` (standaard): zoals een Wii-afstandsbediening. Waar je naar wijst,
  staat de cursor. Boven/onder komt van een kantelhoek (`PITCH_AXIS`),
  links/rechts van het draaien (`z`, de gyroscoop).
- `'rate'`: zoals een joystick. Hoe schuiner je kantelt, hoe sneller de cursor
  beweegt. De instellingen daarvoor staan onder `RATE`.

Bij het begin van elke minigame verschijnt "Wijs naar de ster!". Houd de
controller 1 seconde stil op de ster: dat wordt het midden. Omdat `z` langzaam
verloopt, gebeurt dat bij elke minigame opnieuw (en altijd met `C`).

**Afstemmen met kinderen:** druk `D` en kijk naar `pitch` en `yaw`, met de
min/max sinds de laatste `R`. Laat kinderen naar de randen wijzen en zet
`YAW_RANGE` (links/rechts) en `PITCH_RANGE` (boven/onder) op die waarden.

### Richting klopt niet?

In `controllerConfig.ts`, onder `POINT`:

```ts
POINT: {
  PITCH_AXIS: 'x' as 'x' | 'y', // boven/onder reageert niet? zet op 'y'
  INVERT_PITCH: false,          // boven/onder omgekeerd? zet op true
  INVERT_YAW: true,             // links/rechts omgekeerd? omzetten
  YAW_RANGE: 45,
  PITCH_RANGE: 35,
  ...
},
```

`INVERT_YAW` staat op `true`, omdat links en rechts met de echte controller
gespiegeld waren. Zo werkt het in `src/input/InputManager.ts`. Eerst wordt
berekend hoeveel graden de controller van het midden af staat, en als
`INVERT_YAW` aan staat, wordt het teken omgedraaid:

```ts
private relativeAngles(state: PlayerState) {
  const P = CFG.POINT;
  const axis = P.PITCH_AXIS;
  const pitch = state[axis] - (axis === 'x' ? state.neutralX : state.neutralY);
  const yaw = wrapDegrees(state.z - state.neutralZ);   // z = draaien links/rechts
  return {
    pitch: P.INVERT_PITCH ? -pitch : pitch,
    yaw: P.INVERT_YAW ? -yaw : yaw,                    // hier wordt het omgedraaid
  };
}
```

Daarna wordt de hoek een plek op het scherm (in `pointTarget`). Een positieve
`yaw` betekent: de cursor gaat naar rechts.

```ts
x: GAME_WIDTH / 2 + (yaw / P.YAW_RANGE) * (GAME_WIDTH / 2),
```

**Waarom het omgekeerd was:** de MPU-6050 telt `z` omhoog als je de controller
naar links draait, terwijl de formule een positieve waarde verwacht als je naar
rechts draait. Met `INVERT_YAW: true` wordt `yaw` eerst negatief gemaakt, zodat
de cursor met je arm meegaat.

Welk teken goed is, hangt af van hoe de sensor in de controller ligt. Wordt de
sensor later anders ingebouwd, zet dan gewoon `INVERT_YAW` of `INVERT_PITCH`
weer om, zonder de code aan te passen.

In `'rate'`-modus gebruik je onder `RATE` de instellingen `INVERT_X`,
`INVERT_Y` en `SWAP_AXES`. Snelheid: `MAX_SPEED`, gevoeligheid: `DEAD_ZONE` en `MAX_ANGLE`.
