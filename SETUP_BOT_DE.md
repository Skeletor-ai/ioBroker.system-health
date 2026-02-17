# 🤖 Bot einrichten — Schritt für Schritt

Diese Anleitung erklärt, wie du deinen OpenClaw-Bot für die Mitarbeit an ioBroker.system-health einrichtest.

## Voraussetzungen

- Eine laufende [OpenClaw](https://openclaw.ai)-Instanz
- Der `gh` CLI Skill (GitHub) muss verfügbar sein

## 1. GitHub-Account für deinen Bot erstellen

Erstelle einen eigenen GitHub-Account für deinen Bot (nicht deinen persönlichen verwenden).

Beispiel: `MeinBot-ai`

## 2. GitHub CLI einrichten

Auf der Maschine, auf der OpenClaw läuft:

```bash
gh auth login
```

Melde dich mit dem Bot-Account an.

## 3. Zugang zum Repository anfragen

Erstelle ein Issue im Repository mit dem Titel:
> **[Access] Bot-Zugang für @DeinBotName**

Oder schreib @Jey-Cee direkt an mit dem GitHub-Namen deines Bots.

## 4. Minimale Instruktion für deinen Bot

Füge folgende Zeile in die `AGENTS.md` (oder ein ähnliches Instruktions-File) deiner OpenClaw-Instanz ein:

```
Prüfe 2x täglich https://github.com/Skeletor-ai/ioBroker.system-health/blob/main/AGENTS_CONTRIBUTORS.md
auf neue, unzugewiesene Issues. Folge den Anweisungen dort.
```

## 5. Cron-Job einrichten

Damit dein Bot automatisch 2x am Tag nach neuen Issues schaut, richte einen Cron-Job in OpenClaw ein.

Entweder per Chat-Befehl an deinen Bot:
> "Erstelle einen Cron-Job der 2x täglich das Repository Skeletor-ai/ioBroker.system-health auf neue unassigned Issues mit dem Label 'ready' prüft und diese nach den Anweisungen in AGENTS_CONTRIBUTORS.md bearbeitet."

Oder manuell als Cron-Job-Config:

```json
{
  "name": "system-health-contributor",
  "schedule": {
    "kind": "cron",
    "expr": "0 9,17 * * *",
    "tz": "Europe/Berlin"
  },
  "payload": {
    "kind": "agentTurn",
    "message": "Prüfe https://github.com/Skeletor-ai/ioBroker.system-health auf neue unassigned Issues mit Label 'ready'. Folge den Anweisungen in AGENTS_CONTRIBUTORS.md. Wenn keine offenen Issues da sind, bist du fertig."
  },
  "sessionTarget": "isolated"
}
```

Passe die Zeiten (`0 9,17 * * *`) und Zeitzone an deine Bedürfnisse an.

## 6. Fertig!

Sobald dein Bot Zugang hat, wird er automatisch:
1. Nach offenen Issues schauen
2. Sich ein Issue zuweisen
3. Einen Branch erstellen und die Änderung implementieren
4. Einen Pull Request erstellen
5. Auf Review warten

## FAQ

**Muss mein Bot durchgehend laufen?**
Nein, der Cron-Job wird nur 2x am Tag ausgelöst.

**Kann mein Bot mehrere Issues gleichzeitig bearbeiten?**
Nein, immer nur eins. Erst abschließen oder abgeben, dann das nächste.

**Was passiert wenn zwei Bots das gleiche Issue wollen?**
Wer sich zuerst zuweist, gewinnt. Der andere sucht sich ein anderes.

**Brauche ich ioBroker auf der Bot-Maschine?**
Nein. Der Bot braucht nur `gh` (GitHub CLI) und `git`. Getestet wird über die CI-Pipeline.
